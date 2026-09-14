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
    /* Seated AND launched: the room only counts a seat as a player once
       LAUNCH has been pressed. */
    ws.deliver(JSON.stringify({ t: "fly" }));
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
  ok("one player in a fight stays small", solo.bytes < 2000,
     `${solo.bytes} bytes, ${solo.enemies} fighters, ${solo.rounds} rounds in the air`);

  const eight = weigh(8, 6, 0);
  ok("eight players stay under three kilobytes", eight.bytes < 3000,
     `${eight.bytes} bytes, ${eight.enemies} fighters, ${eight.rounds} rounds`);

  const twoDozen = weigh(24, 12, 0);
  ok("two dozen players stay under five kilobytes", twoDozen.bytes < 5000,
     `${twoDozen.bytes} bytes, ${twoDozen.enemies} fighters, ${twoDozen.rounds} rounds`);

  const withWings = weigh(24, 12, 3);
  ok("and with three wingmen each, under eleven", withWings.bytes < 11000,
     `${withWings.bytes} bytes`);

  /* The point of the whole exercise: rounds are no longer on the wire. */
  const heavy = weigh(24, 20, 3, 40);
  ok("a sky full of rounds does not appear in the snapshot",
     heavy.rounds > 200 && heavy.bytes < 12000,
     `${heavy.rounds} rounds in the air, ${heavy.bytes} bytes on the wire`);
  ok("which is what it would have cost to send them",
     heavy.rounds * 45 > heavy.bytes, `${heavy.rounds} rounds is about ${heavy.rounds * 45} bytes of positions`);
}

/* ---- AND A FIGHT YOU CANNOT SEE COSTS YOU NOTHING ----
   The other half of the point. One player at Earth, one out at a planet
   thousands of units away, each in their own fight. */
{
  storage.map.clear();
  const room = new RebelsRoom({ storage } as never, env) as any;
  room.setDropsForTests(null, () => 0.99);
  const here = new FakeSocket(), far = new FakeSocket();
  for (const [ws, node] of [[here, "here"], [far, "far"]] as const) {
    room.seat(ws as never);
    ws.deliver(JSON.stringify({ t: "join", node, name: node, home: [0, 0, R + 6], reach: 4 }));
    ws.deliver(JSON.stringify({ t: "fly" }));
  }
  const seats = [...room.seats.values()];
  seats[0].body.pos.set(0, 0, R + 20);
  /* Out past the third planet, which is a few thousand units away. */
  seats[1].body.pos.set(0, 0, 3000);
  spawnFleet(room.combat, 3, seats[0].body.pos, seats[0].body.fwd, { count: 20 });
  spawnFleet(room.combat, 3, seats[1].body.pos, seats[1].body.fwd, { count: 20 });
  here.sent.length = 0; far.sent.length = 0;
  room.now += 1 / 20;
  room.step();
  const a = JSON.parse(here.states()[0]);
  const b = JSON.parse(far.states()[0]);
  ok("each of them is sent about half the fighters", a.E.length > 5 && a.E.length < 30 && b.E.length > 5 && b.E.length < 30,
     `${a.E.length} and ${b.E.length} of ${room.combat.enemies.length}`);
  ok("and neither is sent the other's", (() => {
    const mineFar = a.E.some((e: number[]) => e[2] > 1000);
    const theirsNear = b.E.some((e: number[]) => e[2] < 1000);
    return !mineFar && !theirsNear;
  })());
  ok("nor the other ship", !a.P.some((p: unknown[]) => p[0] === seats[1].id) && !b.P.some((p: unknown[]) => p[0] === seats[0].id));
  ok("each message is a fraction of the pair of fights", here.states()[0].length < 2500 && far.states()[0].length < 2500,
     `${here.states()[0].length} and ${far.states()[0].length} bytes`);
  room.stop();
}

/* ---- YOU HEAR WHAT YOU CAN SEE ----
   A bang beyond the horizon used to be sent to everybody, so a player alone
   at a planet heard every explosion at Earth. */
{
  storage.map.clear();
  const room = new RebelsRoom({ storage } as never, env) as any;
  room.setDropsForTests(null, () => 0.99);
  const near = new FakeSocket(), far = new FakeSocket();
  for (const [ws, node] of [[near, "near"], [far, "far"]] as const) {
    room.seat(ws as never);
    ws.deliver(JSON.stringify({ t: "join", node, name: node, home: [0, 0, R + 6] }));
    ws.deliver(JSON.stringify({ t: "fly" }));
  }
  const seats = [...room.seats.values()];
  seats[0].body.pos.set(0, 0, R + 20);
  seats[1].body.pos.set(0, 0, 3000);
  const events = (ws: FakeSocket) => ws.sent
    .map((t) => JSON.parse(t))
    .filter((m) => m.t === "e")
    .flatMap((m) => m.v as Array<Record<string, unknown>>);

  near.sent.length = 0; far.sent.length = 0;
  room.combat.events.push({ kind: "enemyDown", at: seats[0].body.pos.clone(), power: 3, tier: 1, who: "" });
  room.step();
  ok("a bang nearby is heard", events(near).some((e) => e.k === "enemyDown"));
  ok("and the same bang three thousand units away is not", !events(far).some((e) => e.k === "enemyDown"));

  /* A wave arriving is everybody's business, wherever they are. */
  near.sent.length = 0; far.sent.length = 0;
  room.combat.events.push({ kind: "waveStart", at: seats[0].body.pos.clone(), power: 1, wave: 4 });
  room.combat.events.push({ kind: "dragon", at: seats[0].body.pos.clone(), power: 2 });
  room.step();
  ok("a wave arriving reaches everyone", events(far).some((e) => e.k === "waveStart"));
  ok("and so does the dragon", events(far).some((e) => e.k === "dragon"));

  /* And anything that happened to YOU reaches you, wherever you are. */
  near.sent.length = 0; far.sent.length = 0;
  /* Out where the far player is, which is where their pickup would happen. */
  room.combat.events.push({ kind: "gem", at: seats[1].body.pos.clone(), power: 1, tier: 2, who: seats[1].id });
  room.step();
  ok("your own pickup reaches you from across the world", events(far).some((e) => e.k === "gem"));
  ok("and is not somebody else's business", !events(near).some((e) => e.k === "gem"));
  room.stop();
}

/* ---- NOTHING FLICKERS AT THE EDGE ----
   Something already in view is kept in view a fifth further out, or a
   fighter hovering at the limit is sent on one tick and not the next. */
{
  storage.map.clear();
  const room = new RebelsRoom({ storage } as never, env) as any;
  room.setDropsForTests(null, () => 0.99);
  const ws = new FakeSocket();
  room.seat(ws as never);
  ws.deliver(JSON.stringify({ t: "join", node: "h", name: "H", home: [0, 0, R + 6] }));
  ws.deliver(JSON.stringify({ t: "fly" }));
  const seat = [...room.seats.values()][0];
  seat.body.pos.set(0, 0, 0);
  const fleet = spawnFleet(room.combat, 1, new THREE.Vector3(0, 0, R + 10), new THREE.Vector3(0, 1, 0), { count: 1 });
  const e = fleet[0];
  const sees = () => {
    ws.sent.length = 0;
    room.step();
    const st = JSON.parse(ws.states()[0]);
    return (st.E as number[][]).some((row) => row[10] === e.id);
  };
  e.pos.set(0, 0, 360);
  ok("a fighter past the range is not sent", !sees(), "360 units");
  e.pos.set(0, 0, 300);
  ok("inside it, it is", sees(), "300 units");
  e.pos.set(0, 0, 370);
  ok("and drifting a little past the range it is kept, not dropped", sees(), "370 units");
  e.pos.set(0, 0, 430);
  ok("far enough past it and it goes", !sees(), "430 units");
  e.pos.set(0, 0, 370);
  ok("and having gone, it does not come back until it is properly in range", !sees(), "370 units again");
  room.stop();
}

/* ---- THE RANGES HAVE TO AGREE WITH EACH OTHER ----
   Three rules that are not obvious from any single number, and that a
   careless tweak would break silently. */
{
  const { VIEW } = await import("../../../ui/src/wallet/rebels/rebelsView");
  const { ENEMY_FIRE_RANGE } = await import("../../../ui/src/wallet/rebels/rebelsCombat");
  const { DRONE_FIRE_RANGE } = await import("../../../ui/src/wallet/rebels/rebelsFlock");
  ok("if you can see who fired, you can see what they fired", VIEW.shots >= VIEW.ships,
     `shots ${VIEW.shots}, ships ${VIEW.ships}`);
  ok("nothing can shoot you from outside your own view",
     VIEW.enemies > ENEMY_FIRE_RANGE * 2 && VIEW.enemies > DRONE_FIRE_RANGE * 2,
     `enemies ${VIEW.enemies}, fighters fire at ${ENEMY_FIRE_RANGE}, swarms at ${DRONE_FIRE_RANGE}`);
  ok("you can hear anything you can see", VIEW.events >= VIEW.enemies,
     `events ${VIEW.events}, enemies ${VIEW.enemies}`);
  ok("and a gem is visible from further than the coins it fell among",
     VIEW.gems > VIEW.loot, `gems ${VIEW.gems}, loot ${VIEW.loot}`);
}

console.log(out.join("\n"));
console.log(`\n${out.length - failures} passed, ${failures} failed`);
if (failures > 0) process.exit(1);
