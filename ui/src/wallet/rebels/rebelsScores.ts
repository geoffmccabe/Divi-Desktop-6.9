// The leaderboards.
//
// Two tables, both a hundred entries deep. BEST is the highest single run
// anyone has managed; TOTAL is everything they have ever scored added up, so
// somebody who plays a lot gets on that one by playing a lot rather than by
// having one lucky sortie.
//
// They live in Supabase, in the project the wallet already uses, so the tables
// are the network's and not this machine's. localStorage is kept as well, but
// only as a cache: it is what the modal shows in the instant before the network
// answers, and what it falls back to offline.
//
// A run is filed through a database function rather than by writing the row,
// because merging is the whole point: `best` may only climb and `total` may only
// add. A client that could write the row directly could set its own best to
// anything, and two runs finishing at once would lose one of them. Direct writes
// are refused by policy; the function is the only way in.

import { accountRead, accountCall } from "./rebelsAccount";
import { platform } from "./platform/current";

const KEY = "dd69.rebels.scores";
const KEEP = 100;


export interface ScoreRow {
  /** Node name if its owner set one, otherwise the address and country. */
  name: string;
  best: number;
  total: number;
  games: number;
  /** Seven counts, one per ship tier, from tier one upward. */
  tierKills: number[];
  at: number;
}

export const TIER_COUNT = 7;
const noKills = () => new Array(TIER_COUNT).fill(0) as number[];

interface Table { rows: ScoreRow[] }

function read(): Table {
  try {
    const raw = platform().storage.getItem(KEY);
    if (!raw) return { rows: [] };
    const v = JSON.parse(raw) as Table;
    return Array.isArray(v?.rows) ? v : { rows: [] };
  } catch {
    return { rows: [] };
  }
}

function write(t: Table): void {
  try {
    platform().storage.setItem(KEY, JSON.stringify(t));
  } catch {
    /* Out of storage or blocked. A leaderboard is not worth an error. */
  }
}

/**
 * Who the player is: the name others see, and the key the player's saved rows
 * are filed under. Answered by the door the game runs behind (the app door reads
 * the node's chosen name; see platform/app/identity.ts).
 */
export function playerName(): string {
  return platform().identity.name();
}

/**
 * File a finished run, locally and to the network.
 *
 * The local write happens first and always, so the tables are right even with
 * no connection. The network call is fire and forget: a leaderboard is not
 * worth interrupting a game over.
 */
export function recordScore(
  points: number,
  tierKills: number[] = noKills(),
  name = playerName(),
): ScoreRow {
  const kills = tierKills.reduce((a, b) => a + b, 0);
  if (points > 0 || kills > 0) {
    accountCall("rebels_submit", {
      p_name: name,
      p_points: Math.round(points),
      p_tier_kills: tierKills.slice(0, TIER_COUNT).map((n) => Math.max(0, Math.round(n))),
    }).catch(() => { /* offline; the local copy still has it */ });
  }
  return recordLocal(points, tierKills, name);
}

function recordLocal(points: number, tierKills: number[], name: string): ScoreRow {
  const t = read();
  let row = t.rows.find((r) => r.name === name);
  if (!row) {
    row = { name, best: 0, total: 0, games: 0, tierKills: noKills(), at: Date.now() };
    t.rows.push(row);
  }
  if (!Array.isArray(row.tierKills) || row.tierKills.length !== TIER_COUNT) {
    row.tierKills = noKills();
  }
  row.best = Math.max(row.best, points);
  row.total += points;
  row.games += 1;
  for (let i = 0; i < TIER_COUNT; i++) row.tierKills[i] += tierKills[i] ?? 0;
  row.at = Date.now();

  /* Trimmed against BOTH tables, so a row that is top-hundred on either one
     survives. Keeping only the top hundred by total would quietly delete the
     holder of the best single run. */
  const keep = new Set<ScoreRow>();
  for (const r of [...t.rows].sort((a, b) => b.best - a.best).slice(0, KEEP)) keep.add(r);
  for (const r of [...t.rows].sort((a, b) => b.total - a.total).slice(0, KEEP)) keep.add(r);
  t.rows = t.rows.filter((r) => keep.has(r));
  write(t);
  return row;
}

export function topByBest(limit = KEEP): ScoreRow[] {
  return [...read().rows].sort((a, b) => b.best - a.best || a.name.localeCompare(b.name)).slice(0, limit);
}

export function topByTotal(limit = KEEP): ScoreRow[] {
  return [...read().rows].sort((a, b) => b.total - a.total || a.name.localeCompare(b.name)).slice(0, limit);
}

/**
 * The tables as the network has them.
 *
 * One row per player on both, so a good player takes the top place and not the
 * top twenty however many runs they file.
 */
export async function fetchTop(by: "best" | "total", limit = KEEP): Promise<ScoreRow[] | null> {
  try {
    const res = await accountRead(
      "rebels_scores" +
      `?select=name,best,total,games,tier_kills,updated_at&order=${by}.desc&limit=${limit}`,
    );
    if (!res.ok) return null;
    const rows = (await res.json()) as Array<{
      name: string; best: number; total: number; games: number;
      tier_kills: number[] | null; updated_at: string;
    }>;
    return rows.map((r) => ({
      name: r.name,
      best: r.best,
      total: r.total,
      games: r.games,
      tierKills: Array.isArray(r.tier_kills) && r.tier_kills.length === TIER_COUNT
        ? r.tier_kills : noKills(),
      at: Date.parse(r.updated_at) || 0,
    }));
  } catch {
    return null;
  }
}

/**
 * This player's own lifetime row, so the tier tallies can start from what they
 * have already done rather than from zero every time the game opens.
 *
 * Falls back to the local copy, which is what an offline session sees.
 */
export async function myTotals(name = playerName()): Promise<ScoreRow> {
  const local = topByTotal(1000).find((r) => r.name === name)
    ?? { name, best: 0, total: 0, games: 0, tierKills: noKills(), at: 0 };
  try {
    const res = await accountRead(
      "rebels_scores" +
      `?name_key=eq.${encodeURIComponent(name.toLowerCase())}` +
      "&select=name,best,total,games,tier_kills,updated_at&limit=1",
    );
    if (!res.ok) return local;
    const rows = (await res.json()) as Array<{
      name: string; best: number; total: number; games: number;
      tier_kills: number[] | null; updated_at: string;
    }>;
    const r = rows[0];
    if (!r) return local;
    return {
      name: r.name, best: r.best, total: r.total, games: r.games,
      tierKills: Array.isArray(r.tier_kills) && r.tier_kills.length === TIER_COUNT
        ? r.tier_kills : noKills(),
      at: Date.parse(r.updated_at) || 0,
    };
  } catch {
    return local;
  }
}

/* ------------------------------------------------------------------ DIVI ---
   Coins flown into in orbit. Kept locally for now and deliberately NOT sent
   anywhere: a client that can tell a server how much DIVI it has earned is a
   client that can tell it anything. This becomes a server-side number when the
   room does, which is the same reason the payout waits for it. */

const DIVI_KEY = "dd69.rebels.divi";

export function totalDivi(): number {
  try {
    const n = parseFloat(platform().storage.getItem(DIVI_KEY) || "0");
    return Number.isFinite(n) ? n : 0;
  } catch {
    return 0;
  }
}

/**
 * Take DIVI back off the balance, for something bought with it.
 *
 * Never below nothing, and it returns what was actually taken so a caller
 * cannot hand out more than was paid for. Deliberately separate from addDivi
 * with a negative number: the one that removes money should have to be called
 * on purpose.
 */
export function spendDivi(amount: number): number {
  if (!(amount > 0)) return 0;
  const have = totalDivi();
  const take = Math.min(have, amount);
  try {
    platform().storage.setItem(DIVI_KEY, (have - take).toFixed(4));
  } catch {
    /* storage blocked; the number is still right for this session */
  }
  return take;
}

export function addDivi(amount: number): number {
  if (!(amount > 0)) return totalDivi();
  const next = totalDivi() + amount;
  try {
    platform().storage.setItem(DIVI_KEY, next.toFixed(4));
  } catch {
    /* storage blocked; the number is still right for this session */
  }
  return next;
}
