// The wire, byte for byte.
//
// Run: sh scripts/run-rebels-wire-golden-tests.sh
//
// A fixed scenario (seeded randomness, a fixed clock) with every kind of row the
// room sends: players, enemies, shots, spent rounds, coins, torpedoes, wreckage,
// beams, loot (a private item drop included) and wingmen. The state messages it
// produces are compared, character for character, with a recording made BEFORE
// the game and the room were moved onto one shared message codec
// (ui/src/wallet/rebels/rebelsWire.ts, 2026-Sep-15).
//
// Why it matters: installed apps and open web pages decode these messages with
// the code they were built with. A server that sends the same bytes can be
// redeployed under any of them. If this test fails, either the change was a
// mistake or the wire format genuinely changed, and then every client has to
// change with it: record again only on purpose (WIRE_GOLDEN_RECORD=1).

import * as THREE from "three";
import { readFileSync, writeFileSync } from "node:fs";

/* ---- determinism: a seeded random and a fixed clock ---- */
let seed = 0x5eed1234;
Math.random = () => {
  seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
Date.now = () => 1789000000000;

const { RebelsRoom } = await import("../src/room");
const { R } = await import("../../../ui/src/wallet/rebels/orbitWorld");
const C = await import("../../../ui/src/wallet/rebels/rebelsCombat");
C.setDropRandomForTests(() => 0.99);
C.setDragonRandomForTests(() => 0.99);

const out: string[] = [];
let failures = 0;
function ok(name: string, cond: boolean, extra = "") {
  if (!cond) failures++;
  out.push(`${cond ? "PASS" : "FAIL"} ${name}${extra ? `  [${extra}]` : ""}`);
}

class FakeSocket {
  sent: string[] = [];
  handlers: Record<string, Array<(e: any) => void>> = {};
  addEventListener(k: string, fn: (e: any) => void) { (this.handlers[k] ??= []).push(fn); }
  send(s: string) { this.sent.push(s); }
  close() {}
  deliver(text: string) { for (const fn of this.handlers.message ?? []) fn({ data: text }); }
}
const storage = {
  map: new Map<string, unknown>(),
  async get(k: string) { return this.map.get(k); },
  async put(k: string, v: unknown) { this.map.set(k, v); },
  async delete(k: string) { return this.map.delete(k); },
  async list() { return new Map(); },
};
const env = { ROOM: null, LEDGER: { idFromName: () => "id", get: () => ({ fetch: async () => Response.json({ divi: 0 }) }) } } as never;

const room = new RebelsRoom({ storage } as never, env) as any;
room.setDropsForTests(null, () => 0.99);
const socks: FakeSocket[] = [];
for (let i = 0; i < 3; i++) {
  const ws = new FakeSocket();
  room.seat(ws as never);
  const a = (i / 3) * 0.6;
  ws.deliver(JSON.stringify({
    t: "join", node: `n${i}`, name: `Pilot ${i}`, home: [Math.cos(a) * (R + 6), Math.sin(a) * (R + 6), 0],
    gear: ["mini", "beam1"], reach: 4, drones: i === 0 ? [0, 2, 1, 0, 0, 0, 0] : undefined,
  }));
  ws.deliver(JSON.stringify({ t: "fly" }));
  socks.push(ws);
}
const seats = [...room.seats.values()] as any[];
C.spawnFleet(room.combat, 2, seats[0].body.pos, seats[0].body.fwd, { count: 6 });

const states: string[] = [];
const take = () => { for (const ws of socks) { for (const s of ws.sent) if (s.startsWith('{"t":"s"')) states.push(s); ws.sent.length = 0; } };

for (let t = 0; t < 12; t++) {
  socks.forEach((ws, i) => {
    const p = seats[i].body.pos;
    ws.deliver(JSON.stringify({ t: "tf", p: [p.x, p.y + 0.3 * t, p.z], f: [0, 1, 0] }));
    ws.deliver(JSON.stringify({ t: "fire", k: t % 3 === 0 ? "mini" : "main", p: [p.x, p.y, p.z], f: [0, 1, 0], u: [0, 0, 1] }));
  });
  room.now += 1 / 20;
  room.step();
}
take();

/* Every other kind of row, placed by hand where every seat can see it. */
const at = seats[0].body.pos.clone();
const c = room.combat;
c.coins.push({ pos: at.clone().add(new THREE.Vector3(1.234, 2.345, 3.456)), vel: new THREE.Vector3(), spin: 0, value: 1 });
c.torpedoes.push({ pos: at.clone().add(new THREE.Vector3(-4.44, 1.11, 0.55)), vel: new THREE.Vector3(12.345, -6.789, 0.123), life: 2, owner: seats[1].id });
c.junk.push({ pos: at.clone().add(new THREE.Vector3(2.2, -3.3, 1.1)), vel: new THREE.Vector3(), spin: new THREE.Vector3(), rot: new THREE.Vector3(0.12345, 1.23456, -2.34567), life: 3, kind: "wingL" });
c.junk.push({ pos: at.clone().add(new THREE.Vector3(2.9, -3.1, 1.4)), vel: new THREE.Vector3(), spin: new THREE.Vector3(), rot: new THREE.Vector3(0.5, 0.25, 0.125), life: 3, kind: "body" });
c.beams.push({ pos: at.clone(), fwd: new THREE.Vector3(0.12345, 0.98765, -0.0999).normalize(), key: "beam1", life: 0.4567 });
C.dropGem(c, 3, at.clone().add(new THREE.Vector3(5.55, 0, 0)), "gem-shared-1");
C.dropItem(c, "strafe2", 2, at.clone().add(new THREE.Vector3(0, 5.55, 0)), "gem-private-1", seats[1].id);
C.pushBullet(c, { pos: at.clone(), vel: new THREE.Vector3(0, 240, 0), life: 1.23456, hostile: true, orb: true } as any);
/* Two rounds that stopped early, as the simulation records them. */
c.spent.push(4242, 4343);
c.fresh.length && room.broadcastState();
take();

/* The room keeps its own twenty-a-second clock; stop it so the test can end. */
room.stop();

const current = JSON.stringify(states);
/* The runner works from ui/, and the test runs from a temporary bundle, so the
   recording is found from the working directory rather than from this file. */
const GOLDEN = `${process.cwd()}/../contrib/rebels-room/test/golden/wire-state-v1.json`;
if (process.env.WIRE_GOLDEN_RECORD === "1") {
  writeFileSync(GOLDEN, current + "\n");
  out.push(`RECORDED ${states.length} state messages, ${current.length} bytes`);
} else {
  const golden = readFileSync(GOLDEN, "utf8").trim();
  const kinds = ["P", "E", "F", "X", "C", "T", "J", "W", "G", "M"];
  const seen = kinds.filter((k) => states.some((s) => s.includes(`"${k}":[`)));
  ok("the scenario covers every kind of row", seen.length === kinds.length, `missing: ${kinds.filter((k) => !seen.includes(k)).join(",")}`);
  ok("a private item drop is in it", states.some((s) => s.includes('"strafe2"')));
  ok(`the room's state messages are byte-identical to the recording (${states.length} messages)`, current === golden,
     current === golden ? "" : `first difference at character ${[...current].findIndex((ch, i) => ch !== golden[i])}`);
}

console.log(out.join("\n"));
console.log(`\n${out.filter((l) => l.startsWith("PASS") || l.startsWith("RECORDED")).length} passed, ${failures} failed`);
process.exit(failures > 0 ? 1 : 0);
