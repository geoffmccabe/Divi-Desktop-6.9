// What the room actually puts on the wire, weighed.
//
// Run: sh scripts/run-rebels-wire-tests.sh
//
// Not an estimate: a real room, real seats, real fighters, real triggers
// held down, and the real strings it sends. The budgets below are the thing
// that keeps a change from quietly doubling the payload. A snapshot that
// grows is a snapshot somebody has to pay for twenty times a second, times
// every player in the room.

import * as THREE from "three";
import { RebelsRoom } from "../src/room";
import { R } from "../../../ui/src/wallet/rebels/orbitWorld";
import { setDropRandomForTests, setDragonRandomForTests, spawnFleet } from "../../../ui/src/wallet/rebels/rebelsCombat";

setDropRandomForTests(() => 0.99);
setDragonRandomForTests(() => 0.99);

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
  /** Total bytes of state messages, and how many there were. */
  states() { return this.sent.filter((s) => s.startsWith('{"t":"s"')); }
  last(t: string) { return [...this.sent].reverse().map((s) => JSON.parse(s)).find((m) => m.t === t); }
}

const storage = {
  map: new Map<string, unknown>(),
  async get(k: string) { return this.map.get(k); },
  async put(k: string, v: unknown) { this.map.set(k, v); },
  async delete(k: string) { return this.map.delete(k); },
  async list() { return new Map(); },
};
const env = {
  ROOM: null,
  LEDGER: { idFromName: () => "id", get: () => ({ fetch: async () => Response.json({ divi: 0 }) }) },
} as never;

/** A room with `players` seats, `fleets` swarms in the air, everyone firing. */
function busyRoom(players: number, fleets: number, wings: number) {
  storage.map.clear();
  const room = new RebelsRoom({ storage } as never, env) as any;
  room.setDropsForTests(null, () => 0.99);
  const socks: FakeSocket[] = [];
  for (let i = 0; i < players; i++) {
    const ws = new FakeSocket();
    room.seat(ws as never);
    const id = ws.last("hi").id as string;
    /* Spread them over the sky, each with their own tower. */
    const a = (i / players) * Math.PI * 2;
    const home: [number, number, number] = [Math.cos(a) * (R + 6), Math.sin(a) * (R + 6), 0];
    ws.deliver(JSON.stringify({
      t: "join", node: `n${i}`, name: `Pilot ${i}`, home,
      gear: ["mini"], reach: 4, drones: wings ? [0, 0, wings, 0, 0, 0, 0] : undefined,
    }));
    socks.push(ws);
    void id;
  }
  for (let f = 0; f < fleets; f++) {
    const seat = [...room.seats.values()][f % players];
    spawnFleet(room.combat, 1 + (f % 5), seat.body.pos, seat.body.fwd, { count: 12 });
  }
  return { room, socks };
}

function weigh(players: number, fleets: number, wings: number, ticks = 24) {
  const { room, socks } = busyRoom(players, fleets, wings);
  for (const s of socks) s.sent.length = 0;
  for (let t = 0; t < ticks; t++) {
    /* Everyone holds the trigger, and everyone is moving. */
    for (const ws of socks) {
      const seat = [...room.seats.values()].find((s: any) => s.ws === ws)!;
      const p = seat.body.pos;
      ws.deliver(JSON.stringify({ t: "tf", p: [p.x, p.y, p.z], f: [0, 1, 0] }));
      ws.deliver(JSON.stringify({ t: "fire", k: "main", p: [p.x, p.y, p.z], f: [0, 1, 0], u: [0, 0, 1] }));
    }
    room.now += 1 / 20;
    room.step();
  }
  const states = socks[0].states();
  const bytes = states.reduce((n, s) => n + s.length, 0) / Math.max(1, states.length);
  const enemies = room.combat.enemies.length;
  const rounds = room.combat.bullets.length;
  room.stop();
  return { bytes: Math.round(bytes), enemies, rounds };
}

/* ---- the budgets ----
   Bytes in ONE state message, which every player is sent twenty times a
   second. Multiply by twenty for each player's kilobytes a second, and by
   the number of players again for what leaves the room. */
{
  const solo = weigh(1, 2, 0);
  ok("one player in a fight stays small", solo.bytes < 3000,
     `${solo.bytes} bytes, ${solo.enemies} fighters, ${solo.rounds} rounds in the air`);

  const eight = weigh(8, 6, 0);
  ok("eight players stay under six kilobytes", eight.bytes < 6000,
     `${eight.bytes} bytes, ${eight.enemies} fighters, ${eight.rounds} rounds`);

  const twoDozen = weigh(24, 12, 0);
  ok("two dozen players stay under twelve kilobytes", twoDozen.bytes < 12000,
     `${twoDozen.bytes} bytes, ${twoDozen.enemies} fighters, ${twoDozen.rounds} rounds`);

  const withWings = weigh(24, 12, 3);
  ok("and with three wingmen each, under sixteen", withWings.bytes < 16000,
     `${withWings.bytes} bytes`);

  /* The point of the whole exercise: rounds are no longer on the wire. */
  const heavy = weigh(24, 20, 3, 40);
  ok("a sky full of rounds does not appear in the snapshot",
     heavy.rounds > 200 && heavy.bytes < 20000,
     `${heavy.rounds} rounds in the air, ${heavy.bytes} bytes on the wire`);
  ok("which is what it would have cost to send them",
     heavy.rounds * 45 > heavy.bytes, `${heavy.rounds} rounds is about ${heavy.rounds * 45} bytes of positions`);
}

console.log(out.join("\n"));
console.log(`\n${out.length - failures} passed, ${failures} failed`);
if (failures > 0) process.exit(1);
