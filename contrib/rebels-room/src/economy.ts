// The money side of a room: banking a run, and asking the ledger about a purse.
//
// Moved out of room.ts (2026-Sep-15). Kills and DIVI are reported to a single
// ledger object that spans every room, since a player may fly in several over a
// week and the payout is one running total. The room is the only thing that ever
// writes to it; London does the paying.

/** The parts of a seat that are banked. */
export interface Bankable {
  account: string;
  node: string;
  name: string;
  kills: number;
  divi: number;
  score: number;
  flocks: number;
  gems: number[];
  items: Record<string, number>;
}

/** How the room reaches the ledger (the LEDGER Durable Object binding). */
export interface LedgerBinding {
  idFromName(name: string): unknown;
  get(id: unknown): { fetch(input: string, init?: RequestInit): Promise<Response> };
}

function ledger(binding: LedgerBinding) {
  return binding.get(binding.idFromName("v1"));
}

/** Report what this seat has earned since it last banked, and zero it. On a
 *  failure it is put back rather than lost: the next flush carries it. */
export async function bankRun(binding: LedgerBinding, s: Bankable): Promise<void> {
  const anyGems = s.gems.some((n) => n > 0);
  const anyItems = Object.keys(s.items).length > 0;
  if (!(s.account || s.node) || (s.kills === 0 && s.divi === 0 && s.score === 0 && s.flocks === 0 && !anyGems && !anyItems)) return;
  const kills = s.kills, divi = s.divi, score = s.score, flocks = s.flocks, gems = s.gems.slice(), items = s.items;
  s.kills = 0; s.divi = 0; s.score = 0; s.flocks = 0; s.gems = [0, 0, 0, 0, 0, 0, 0]; s.items = {};
  try {
    await ledger(binding).fetch("https://ledger/credit", {
      method: "POST",
      body: JSON.stringify({ node: s.account || s.node, name: s.name, kills, divi, score, flocks, gems, items }),
    });
  } catch {
    s.kills += kills; s.divi += divi; s.score += score; s.flocks += flocks;
    for (let i = 0; i < 7; i++) s.gems[i] += gems[i] ?? 0;
    for (const [k, n] of Object.entries(items)) s.items[k] = (s.items[k] ?? 0) + n;
  }
}

/** Ask the ledger to pay this account to `to`. The ledger's answer is the purse
 *  to show; when it does not answer, a purse that says so. */
export async function requestCashOut(binding: LedgerBinding, account: string, to: string): Promise<Record<string, unknown>> {
  try {
    const r = await ledger(binding).fetch("https://ledger/request", {
      method: "POST",
      body: JSON.stringify({ node: account, to }),
    });
    return await r.json() as Record<string, unknown>;
  } catch {
    return {
      divi: 0, claimable: 0, paid: 0, pending: null, last: null,
      why: "the ledger did not answer; try again in a moment",
    };
  }
}

/** What the ledger holds for this account, or null when it did not answer. */
export async function readPurse(binding: LedgerBinding, account: string): Promise<Record<string, unknown> | null> {
  try {
    const r = await ledger(binding).fetch(`https://ledger/purse?node=${encodeURIComponent(account)}`);
    const purse = await r.json() as Record<string, unknown>;
    return typeof purse.divi === "number" ? purse : null;
  } catch {
    return null;
  }
}
