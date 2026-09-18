// Building each player's state message: what the room sends every tick.
//
// Moved out of room.ts (2026-Sep-15) so the room's file is the simulation and the
// messages it answers, and this is the picture it paints for each player. The
// rows are packed by the shared codec (ui/src/wallet/rebels/rebelsWire.ts) and
// each seat is sent only what its own eyes reach (rebelsView.ts ranges, with the
// "stay in view a fifth further out" memory kept on the seat).
//
// The bytes are exactly what they were: contrib/rebels-room/test/wireGolden
// compares them with a recording.

import * as THREE from "three";
import { takeSpentBullets, takeFreshBullets, type Gem, type Bullet, type CombatState } from "../../../ui/src/wallet/rebels/rebelsCombat";
import { VIEW, inRange } from "../../../ui/src/wallet/rebels/rebelsView";
import {
  packPlayer, packEnemy, packShot, packCoin, packTorpedo, packJunk, packBeam, packGem, packWing, type WingRow,
} from "../../../ui/src/wallet/rebels/rebelsWire";

/** The parts of a seat the picture needs. */
export interface BroadcastSeat {
  id: string;
  joined: boolean;
  dead: boolean;
  body: { pos: THREE.Vector3; fwd: THREE.Vector3; guard?: boolean };
  shield: number;
  wings: Array<{ slot: number; tier: number; hull: number; hullMax: number; pos: THREE.Vector3 }>;
  sawShips: Set<string | number>;
  sawEnemies: Set<string | number>;
}

/**
 * One state message per seat, as [seat, the text to send]. Takes this tick's
 * fired and stopped rounds out of the combat state, as the room always did.
 */
export function stateMessages<S extends BroadcastSeat>(combat: CombatState, seats: S[], tick: number): Array<[S, string]> {
  const messages: Array<[S, string]> = [];

  const c = combat;
  /* A dropped item in its private minute goes only to its owner: nobody
     else is told it exists. Everything else is one string for everyone. */
  const shared: Gem[] = [];
  const mine = new Map<string, Gem[]>();
  for (const g of c.gems) {
    if (g.item && (g.hidden ?? 0) > 0) {
      const list = mine.get(g.owner ?? "") ?? [];
      list.push(g);
      mine.set(g.owner ?? "", list);
    } else shared.push(g);
  }
  const gemWire = (g: Gem) => packGem(g.pos, g.tier, g.spin, g.id,
    g.item ? { key: g.item, owner: g.owner, hidden: g.hidden } : undefined);
  /* The wingmen, whose and where. They point where their owner points, so
     the cockpit takes the heading from the ship they belong to. */
  const wings: WingRow[] = [];
  for (const s of seats) {
    if (!s.joined || s.dead) continue;
    for (const wing of s.wings) {
      if (wing.hull <= 0) continue;
      wings.push(packWing(s.id, wing.slot, wing.pos, wing.hull, wing.hullMax, wing.tier));
    }
  }
  /* ---- THE SHOT, NOT THE ROUND ----
     Everything fired since the last tick, and everything that stopped
     early. A round flies itself in every cockpit from here on, with this
     same simulation file; the server still decides every hit and says
     which rounds stopped. */
  const fired: Bullet[] = takeFreshBullets(c);
  const stopped: number[] = takeSpentBullets(c);
  /* ---- ONE ROW PER THING, BUILT ONCE ----
     The rounding and the shaping happen here, not once per player: with two
     dozen seats that would be two dozen times the work for the same answer.
     Each row is kept beside the point it is at, and each seat then takes
     only the rows its own eyes reach. */
  interface Row<T> { at: THREE.Vector3; row: T; only?: string; always?: true; key?: string | number }
  /**
   * Something already in view is kept in view a fifth further out.
   *
   * Without it, anything hovering at the edge of a range is sent on one
   * tick and not the next, and a ship or a fighter at that distance
   * flickers in and out. The seat remembers what it was told about last
   * tick, which is all the memory this needs.
   */
  const KEEP = 1.2;
  const sticky = <T>(rows: Array<Row<T>>, eye: THREE.Vector3, range: number, held: Set<string | number>) => {
    const out: T[] = [];
    const seen = new Set<string | number>();
    for (const r of rows) {
      const key = r.key;
      const near = inRange(eye, r.at, range)
        || (key !== undefined && held.has(key) && inRange(eye, r.at, range * KEEP));
      if (r.always || near) {
        out.push(r.row);
        if (key !== undefined) seen.add(key);
      }
    }
    return { out, seen };
  };
  const pick = <T>(rows: Array<Row<T>>, eye: THREE.Vector3, range: number, id: string): T[] => {
    const out: T[] = [];
    for (const r of rows) {
      if (r.only && r.only !== id) continue;
      if (r.always || r.only === id || inRange(eye, r.at, range)) out.push(r.row);
    }
    return out;
  };

  const players: Array<Row<unknown>> = [];
  for (const s of seats) {
    if (!s.joined) continue;
    players.push({
      at: s.body.pos,
      key: s.id,
      row: packPlayer(s.id, s.body.pos, s.body.fwd, !!s.body.guard, s.shield),
    });
  }
  const enemies: Array<Row<unknown>> = c.enemies.map((e) => ({
    at: e.pos,
    key: e.id ?? undefined,
    /* The dragon is an apparition the size of a house and it is there for
       ten seconds a minute at most: everybody sees it, wherever they are. */
    ...(e.dragon ? { always: true as const } : {}),
    /* A drone is drawn as a sphere, a fighter as a hull: the cockpit has
       to be told which. And WHICH enemy, so its hull model follows it. */
    row: packEnemy(e.pos, e.fwd, e.cls.tier, e.shield, e.cls.shieldMax, e, e.id),
  }));
  const shots: Array<Row<unknown>> = fired.map((b) => ({
    at: b.pos,
    /* Your own rounds always reach you, however far the shot was taken
       from: you pulled the trigger and the flash has already gone off. */
    ...(b.owner ? { only: undefined } : {}),
    row: packShot(b.id, b.pos, b.vel, b, b.life),
    owner: b.owner,
  } as Row<unknown> & { owner?: string }));
  const coins: Array<Row<unknown>> = c.coins.map((k) => ({
    at: k.pos, row: packCoin(k.pos),
  }));
  const torps: Array<Row<unknown>> = c.torpedoes.map((t) => ({
    at: t.pos,
    row: packTorpedo(t.pos, t.vel),
  }));
  const junk: Array<Row<unknown>> = c.junk.map((j) => ({
    at: j.pos,
    row: packJunk(j.pos, j.rot, j.kind),
  }));
  const beams: Array<Row<unknown>> = c.beams.map((b) => ({
    at: b.pos,
    row: packBeam(b.pos, b.fwd, b.key, b.life),
  }));
  const gemRows: Array<Row<unknown>> = [
    ...shared.map((g) => ({ at: g.pos, row: gemWire(g) })),
    /* A dropped item in its private minute goes to its owner and to nobody
       else: not out of range, out of existence. */
    ...[...mine.entries()].flatMap(([owner, list]) =>
      list.map((g) => ({ at: g.pos, row: gemWire(g), only: owner }))),
  ];
  const wingRows: Array<Row<unknown>> = wings.map((w) => ({
    at: new THREE.Vector3(w[2], w[3], w[4]), row: w,
  }));

  /* ---- AND ONE MESSAGE PER PLAYER ----
     Which is the whole change: everybody used to be handed the same string
     describing the whole world, including fights on the far side of a
     planet they could not see. */
  for (const s of seats) {
    const eye = s.body.pos;
    const pickedP = sticky(players, eye, VIEW.ships, s.sawShips);
    const pickedE = sticky(enemies, eye, VIEW.enemies, s.sawEnemies);
    s.sawShips = pickedP.seen;
    s.sawEnemies = pickedE.seen;
    const state = {
      t: "s" as const,
      n: tick,
      w: c.wave?.n ?? 0,
      P: pickedP.out,
      E: pickedE.out,
      ...(() => {
        const f = shots.filter((r) => {
          const own = (r as Row<unknown> & { owner?: string }).owner === s.id;
          return own || inRange(eye, r.at, VIEW.shots);
        }).map((r) => r.row);
        return f.length ? { F: f } : {};
      })(),
      ...(stopped.length ? { X: stopped } : {}),
      C: pick(coins, eye, VIEW.loot, s.id),
      ...(() => { const t = pick(torps, eye, VIEW.torpedoes, s.id); return t.length ? { T: t } : {}; })(),
      ...(() => { const j = pick(junk, eye, VIEW.junk, s.id); return j.length ? { J: j } : {}; })(),
      ...(() => { const w = pick(wingRows, eye, VIEW.ships, s.id); return w.length ? { W: w } : {}; })(),
      ...(() => { const g = pick(gemRows, eye, VIEW.gems, s.id); return g.length ? { G: g } : {}; })(),
      ...(() => { const m = pick(beams, eye, VIEW.beams, s.id); return m.length ? { M: m } : {}; })(),
    };
    messages.push([s, JSON.stringify(state)]);
  }
  return messages;
}
