// Does the room actually refuse the things it claims to refuse?
//
// These are the tests that matter most in the whole project, because they are
// the ones standing between a treasury and a text editor. Every case here is
// written from the attacker's side: not "does an honest player work", but "what
// happens when the message is a lie".
//
// Run: sh scripts/run-rebels-room-tests.sh

import * as THREE from "three";
import { RebelsRoom } from "../src/room";
import { R } from "../../../ui/src/wallet/rebels/orbitWorld";
import { MAX_AMMO, MAX_SHIELD, BOOST, MAX_TORPEDOES } from "../../../ui/src/wallet/rebels/orbitFlight";

const out: string[] = [];
let failures = 0;
function ok(name: string, cond: boolean, extra = "") {
  if (!cond) failures++;
  out.push(`${cond ? "PASS" : "FAIL"} ${name}${extra ? `  [${extra}]` : ""}`);
}

/* A socket that remembers rather than sends. */
class FakeSocket {
  sent: any[] = [];
  closed: string | null = null;
  handlers: Record<string, Array<(e: any) => void>> = {};
  addEventListener(k: string, fn: (e: any) => void) { (this.handlers[k] ??= []).push(fn); }
  send(s: string) { this.sent.push(JSON.parse(s)); }
  close(_code: number, why: string) { this.closed = why; }
  deliver(text: string) { for (const fn of this.handlers.message ?? []) fn({ data: text }); }
  last(t: string) { return [...this.sent].reverse().find((m) => m.t === t); }
  all(t: string) { return this.sent.filter((m) => m.t === t); }
}

const storage = {
  map: new Map<string, unknown>(),
  async get(k: string) { return this.map.get(k); },
  async put(k: string, v: unknown) { this.map.set(k, v); },
  async delete(k: string) { return this.map.delete(k); },
  async list(opts: { prefix?: string } = {}) {
    const out = new Map<string, unknown>();
    for (const [k, v] of this.map) if (!opts.prefix || k.startsWith(opts.prefix)) out.set(k, v);
    return out;
  },
  clear() { this.map.clear(); },
  keys() { return this.map.keys(); },
};
const fakeState = { storage } as never;
const credits: any[] = [];
const requests: any[] = [];
const fakeEnv = {
  ROOM: null,
  LEDGER: {
    idFromName: () => "id",
    get: () => ({
      fetch: async (u: string, init?: { body: string }) => {
        /* A purse read, or a cash-out request: answered with a blank purse. */
        if (!init?.body || String(u).includes("/request")) {
          if (init?.body) requests.push(JSON.parse(init.body));
          return Response.json({ divi: 0, claimable: 0, paid: 0, pending: null, last: null });
        }
        credits.push(JSON.parse(init.body));
        return new Response("{}");
      },
    }),
  },
} as never;

/* The room's privates are plain properties once compiled, which is what lets
   these tests drive it without a real websocket upgrade. */
function newRoom() {
  const room = new RebelsRoom(fakeState, fakeEnv) as any;
  return room;
}
function join(room: any, ws: FakeSocket, node = "node-a") {
  room.seat(ws as never);
  const id = ws.last("hi").id as string;
  ws.deliver(JSON.stringify({ t: "join", node, name: "A Node", home: [0, 0, R] }));
  return room.seats.get(id);
}
const home: [number, number, number] = [0, 0, R + 8];

// 1. A seat starts full, and starts full of the ROOM's numbers.
{
  const room = newRoom();
  const ws = new FakeSocket();
  const seat = join(room, ws);
  ok("a new seat is welcomed", !!ws.last("hi"), ws.last("hi")?.id);
  ok("with a full shield and magazine", seat.shield === MAX_SHIELD && seat.ammo === MAX_AMMO,
     `${seat.shield} shield, ${seat.ammo} rounds`);
  const you = ws.last("you");
  ok("and is told its own gauges", you?.shield === MAX_SHIELD && you?.score === 0);
  room.stop();
}

// 2. THE ONE THAT MATTERS: a client cannot invent a score.
//
//    There is no message for it. This checks the negative — that sending the
//    obvious shapes an attacker would try changes nothing at all.
{
  const room = newRoom();
  const ws = new FakeSocket();
  const seat = join(room, ws);
  for (const lie of [
    { t: "score", score: 999999 },
    { t: "you", score: 999999, kills: 5000, divi: 5000 },
    { t: "kill", tier: 7 },
    { t: "fire", k: "main", p: home, f: [0, 1, 0], kills: 900, score: 900, divi: 900 },
  ]) ws.deliver(JSON.stringify(lie));
  ok("no message a client can send raises its score", seat.score === 0, `${seat.score}`);
  ok("nor its kills", seat.kills === 0, `${seat.kills}`);
  ok("nor its DIVI", seat.divi === 0, `${seat.divi}`);
  room.stop();
}

// 3. Ammunition is the room's, so the trigger cannot outrun the magazine.
{
  const room = newRoom();
  const ws = new FakeSocket();
  const seat = join(room, ws);
  seat.body.pos.set(0, 0, R + 8);

  /* Two hundred trigger pulls in the same instant. */
  for (let i = 0; i < 200; i++) {
    ws.deliver(JSON.stringify({ t: "fire", k: "main", p: home, f: [0, 1, 0] }));
  }
  ok("a burst faster than the gun fires once", room.combat.bullets.length === 2,
     `${room.combat.bullets.length} rounds in the air`);
  ok("and costs exactly one round", seat.ammo === MAX_AMMO - 1, `${seat.ammo} left`);

  /* Now with time passing, until the magazine is genuinely empty. */
  for (let i = 0; i < 500; i++) {
    room.now += 0.1;
    ws.deliver(JSON.stringify({ t: "fire", k: "main", p: home, f: [0, 1, 0] }));
  }
  ok("an empty magazine fires nothing", seat.ammo === 0, `${seat.ammo} left`);
  const spent = room.combat.bullets.length;
  room.now += 1;
  ws.deliver(JSON.stringify({ t: "fire", k: "main", p: home, f: [0, 1, 0] }));
  ok("and stays empty however hard the trigger is pulled",
     room.combat.bullets.length === spent, `${room.combat.bullets.length} vs ${spent}`);
  room.stop();
}

// 4. A shot has to come from where the room thinks the ship is.
{
  const room = newRoom();
  const ws = new FakeSocket();
  const seat = join(room, ws);
  seat.body.pos.set(0, 0, R + 8);
  const before = room.combat.bullets.length;
  /* Sniping from the far side of the planet. */
  ws.deliver(JSON.stringify({ t: "fire", k: "main", p: [0, 0, -(R + 8)], f: [0, 1, 0] }));
  ok("a shot from somewhere else is refused", room.combat.bullets.length === before,
     `${room.combat.bullets.length}`);
  ok("and the player is told why", ws.last("no")?.why === "shot from elsewhere", ws.last("no")?.why);
  room.stop();
}

// 5. Teleporting is refused and corrected.
{
  const room = newRoom();
  const ws = new FakeSocket();
  const seat = join(room, ws);
  seat.body.pos.set(0, 0, R + 8);
  const was = seat.body.pos.clone();

  ws.deliver(JSON.stringify({ t: "tf", p: [0, R + 8, 0], f: [0, 0, 1] }));
  ok("a jump across the world is refused", seat.body.pos.distanceTo(was) < 1e-6,
     `moved ${seat.body.pos.distanceTo(was).toFixed(1)}`);
  const no = ws.last("no");
  ok("and the room says where they really are", no?.why === "moved too far" && !!no?.p, no?.why);

  /* A legitimate step, at the speed the ship actually flies. */
  const step = new THREE.Vector3(0, BOOST * 0.05, 0).add(was);
  ws.deliver(JSON.stringify({ t: "tf", p: [step.x, step.y, step.z], f: [0, 1, 0] }));
  ok("an honest step is accepted", seat.body.pos.distanceTo(step) < 1e-6,
     `${seat.body.pos.distanceTo(step).toFixed(2)} out`);
  room.stop();
}

// 6. Flying inside the planet, or off into space, is refused.
{
  const room = newRoom();
  const ws = new FakeSocket();
  const seat = join(room, ws);
  seat.body.pos.set(0, 0, R + 8);
  ws.deliver(JSON.stringify({ t: "tf", p: [0, 0, R * 0.5], f: [0, 1, 0] }));
  ok("under the surface is refused", ws.last("no")?.why === "outside the world", ws.last("no")?.why);
  /* Well past the edge of the sky, which moved a long way out twice over: once
     when the flight model was freed, and again when fourteen planets were hung
     out to 3,600 units and the ceiling had to clear the furthest of them. */
  ws.deliver(JSON.stringify({ t: "tf", p: [0, 0, R * 90], f: [0, 1, 0] }));
  ok("and so is deep space", ws.last("no")?.why === "outside the world", ws.last("no")?.why);
  room.stop();
}

// 7. Rubbish on the wire is survivable, and persistent rubbish is not tolerated.
{
  const room = newRoom();
  const ws = new FakeSocket();
  join(room, ws);
  for (const junk of ["", "{", "null", "[]", '{"t":"nonsense"}', '{"t":"tf","p":"over there"}']) {
    ws.deliver(junk);
  }
  ok("malformed messages do not throw", true);
  ok("and are refused out loud", ws.all("no").length > 0, `${ws.all("no").length} refusals`);

  for (let i = 0; i < 60; i++) ws.deliver('{"t":"nonsense"}');
  ok("a client sending nothing but rubbish is disconnected", ws.closed !== null, `${ws.closed}`);
  room.stop();
}

// 8. An oversized frame is dropped rather than parsed.
{
  const room = newRoom();
  const ws = new FakeSocket();
  join(room, ws);
  ws.deliver(JSON.stringify({ t: "tf", p: home, f: [0, 1, 0], pad: "x".repeat(4000) }));
  ok("an oversized frame is refused", ws.last("no")?.why === "oversized", ws.last("no")?.why);
  room.stop();
}

// 9. Points follow the round back to the gun that fired it.
//
//    Two players, one fighter, one shot. The shooter scores and the bystander
//    does not, however close they are standing.
{
  const room = newRoom();
  const a = new FakeSocket(); const b = new FakeSocket();
  const sa = join(room, a, "node-a");
  const sb = join(room, b, "node-b");
  sa.body.pos.set(0, 0, R + 8);
  sb.body.pos.set(0.5, 0, R + 8);
  room.refreshRoster();

  /* A fighter parked at the convergence point, fifty-five units ahead, which
     is where the two barrels cross and therefore the only place a shot down the
     middle actually goes. Twenty units out the rounds are still wide apart and
     sail past either side of it. */
  room.combat.enemies.push({
    pos: new THREE.Vector3(0, 55, R + 8),
    fwd: new THREE.Vector3(0, -1, 0), roll: 0,
    cls: { tier: 1, name: "Grey", shieldMax: 100, colour: 0, speed: 1, weight: 1 },
    shield: 100, vel: new THREE.Vector3(), tumble: new THREE.Vector3(), spin: new THREE.Vector3(),
    flash: 0, ammo: 0, reload: 99, fireAt: 99, weave: 9, weaveDir: 1, wave: 1,
    mode: "in" as const, breakAt: 0, rejoinAt: 1e9,
    escape: new THREE.Vector3(), passFor: 1e9,
  });
  a.deliver(JSON.stringify({ t: "fire", k: "main", p: home, f: [0, 1, 0] }));
  for (let i = 0; i < 20; i++) room.step();

  ok("the player who fired is credited", sa.score > 0, `${sa.score} points`);
  ok("and the bystander is not", sb.score === 0, `${sb.score} points`);
  room.stop();
}

// 10. Being shot down banks the earnings rather than burning them.
{
  credits.length = 0;
  const room = newRoom();
  const ws = new FakeSocket();
  const seat = join(room, ws);
  seat.kills = 12; seat.divi = 1.2; seat.score = 900;
  room.down(seat);
  ok("death sends the run to the ledger", credits.length === 1, `${credits.length} credits`);
  ok("with the kills on it", credits[0]?.kills === 12, `${credits[0]?.kills}`);
  ok("and the DIVI", Math.abs((credits[0]?.divi ?? 0) - 1.2) < 1e-9, `${credits[0]?.divi}`);
  ok("the player is grounded", seat.dead === true);
  seat.respawn = 0;
  room.revive(seat);
  ok("and comes back whole", seat.shield === MAX_SHIELD && seat.ammo === MAX_AMMO && !seat.dead);
  room.stop();
}

// 11. Leaving banks too, so closing the lid is not a way to hide a run.
{
  credits.length = 0;
  const room = newRoom();
  const ws = new FakeSocket();
  const seat = join(room, ws);
  seat.kills = 3; seat.score = 400;
  room.leave(seat);
  ok("quitting files the run", credits.length === 1 && credits[0].kills === 3, `${credits.length}`);
  ok("and the seat is gone", room.seats.size === 0);
  room.stop();
}

console.log(out.join("\n"));
// N. Cashing out: the account is the CONNECTING address, never the typed node.
{
  const room = newRoom();
  const ws = new FakeSocket();
  room.seat(ws as never, "203.0.113.7");
  const id = ws.last("hi").id as string;
  ws.deliver(JSON.stringify({ t: "join", node: "somebody-elses-node", name: "Liar", home: [0, 0, R] }));
  const seat = room.seats.get(id);
  ok("the seat's account is the socket's address", seat.account === "203.0.113.7", seat.account);
  ok("the typed node is kept for display only", seat.node === "somebody-elses-node");
  await new Promise((r) => setTimeout(r, 0));
  ok("a purse is sent on join", !!ws.last("purse"), JSON.stringify(ws.last("purse")));

  requests.length = 0;
  credits.length = 0;
  seat.kills = 3; seat.divi = 0.3; seat.score = 30;
  ws.deliver(JSON.stringify({ t: "claim", to: "D8tjqHzBg3ZA7tUWryChUPqLjz4K41DxSt" }));
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));
  ok("a claim banks the run first", credits.length === 1 && credits[0].node === "203.0.113.7"
     && credits[0].kills === 3, JSON.stringify(credits));
  ok("then asks the ledger under the socket's address, not the typed one",
     requests.length === 1 && requests[0].node === "203.0.113.7"
     && requests[0].to === "D8tjqHzBg3ZA7tUWryChUPqLjz4K41DxSt", JSON.stringify(requests));
  ok("and the answer reaches the cockpit", ws.all("purse").length >= 2);

  ws.deliver(JSON.stringify({ t: "claim", to: "D8tjqHzBg3ZA7tUWryChUPqLjz4K41DxSt" }));
  await new Promise((r) => setTimeout(r, 0));
  ok("a second claim inside five seconds is ignored", requests.length === 1);
  ok("none of that is a strike", seat.strikes === 0, `${seat.strikes}`);
  room.stop();
}
{
  /* No connecting address at all (a test, a local run): the declared node stands in. */
  const room = newRoom();
  const ws = new FakeSocket();
  const seat = join(room, ws, "10.0.0.5");
  ok("without a connecting address the declared node is the account", seat.account === "10.0.0.5", seat.account);
  room.stop();
}

// Gear: what a ship declared is what it can fire, and its magazine is sized by it.
{
  const room = newRoom();
  const ws = new FakeSocket();
  room.seat(ws as never);
  const id = ws.last("hi").id as string;
  ws.deliver(JSON.stringify({ t: "join", node: "g1", name: "Geared", home: [0, 0, R],
    gear: ["mini", "beam1", "beam2", "mag2", "torp1", "deathray", 7, "pulse"] }));
  const seat = room.seats.get(id);
  ok("unknown gear is dropped, known gear kept",
     [...seat.gear].sort().join(",") === "beam1,beam2,mag2,mini,pulse,torp1", [...seat.gear].sort().join(","));
  ok("the magazine is sixty percent bigger with mag2", seat.ammoMax === Math.round(MAX_AMMO * 1.6), `${seat.ammoMax}`);
  ok("and there is one more torpedo with torp1", seat.torpsMax === MAX_TORPEDOES + 1, `${seat.torpsMax}`);
  ok("and it starts full", seat.ammo === seat.ammoMax && seat.torps === seat.torpsMax);

  const p = seat.body.pos.toArray(), f = seat.body.fwd.toArray();
  room.now = 10;
  ws.deliver(JSON.stringify({ t: "fire", k: "beam", p, f, w: "beam2" }));
  ok("a declared beam fires", room.combat.beams.length === 1 && room.combat.beams[0].key === "beam2",
     `${room.combat.beams.length}`);
  ok("and costs a round", seat.ammo === seat.ammoMax - 1, `${seat.ammo}`);
  ws.deliver(JSON.stringify({ t: "fire", k: "beam", p, f, w: "beam2" }));
  ok("not twice inside its burst", room.combat.beams.length === 1);
  room.now = 11;
  ws.deliver(JSON.stringify({ t: "fire", k: "beam", p, f, w: "beam3" }));
  ok("a beam that was not declared is refused, with a reason",
     room.combat.beams.length === 1 && String(ws.last("no")?.why).includes("no "), ws.last("no")?.why);
  ok("and is not a strike", seat.strikes === 0);
  ws.deliver(JSON.stringify({ t: "fire", k: "beam", p, f, w: "mini" }));
  ok("naming a non-beam as a beam is a strike", seat.strikes === 1, `${seat.strikes}`);

  /* The wire carries the beam so everyone sees it. */
  room.broadcastState();
  const st = ws.last("s");
  ok("beams go out in the state message", Array.isArray(st.M) && st.M.length === 1 && st.M[0][6] === "beam2",
     JSON.stringify(st.M));

  /* Revive refills to the sized maximum, not the stock one. */
  seat.ammo = 0; seat.torps = 0;
  room.revive(seat);
  ok("revived to the sized magazine", seat.ammo === seat.ammoMax && seat.torps === seat.torpsMax);
  room.stop();
}
{
  /* No gear declared: stock ship, and the minigun is refused. */
  const room = newRoom();
  const ws = new FakeSocket();
  const seat = join(room, ws, "g2");
  ok("stock magazine without items", seat.ammoMax === MAX_AMMO && seat.torpsMax === MAX_TORPEDOES);
  const p = seat.body.pos.toArray(), f = seat.body.fwd.toArray();
  room.now = 5;
  const before = room.combat.bullets.length;
  ws.deliver(JSON.stringify({ t: "fire", k: "mini", p, f }));
  ok("the minigun is refused without it", room.combat.bullets.length === before
     && String(ws.last("no")?.why).includes("minigun"), ws.last("no")?.why);
  ws.deliver(JSON.stringify({ t: "fire", k: "main", p, f }));
  ok("the pulse gun always fires", room.combat.bullets.length > before);
  const st0 = (room.broadcastState(), ws.last("s"));
  ok("no beams, no M key on the wire", !("M" in st0), Object.keys(st0).join(","));
  room.stop();
}

// Flock kills: over half a fleet's members, tallied per seat; the last death drops a gem.
{
  storage.clear();
  const room = newRoom();
  const wsA = new FakeSocket(), wsB = new FakeSocket();
  const a = join(room, wsA, "a-node");
  const b = join(room, wsB, "b-node");
  const { spawnFleet, hurtEnemy, setFlockRandomForTests } = await import("../../../ui/src/wallet/rebels/rebelsCombat");
  setFlockRandomForTests(() => 1);
  const fleet = spawnFleet(room.combat, 2, a.body.pos, a.body.fwd, { count: 4 });
  /* A downs three, B downs one. */
  for (const [d, who] of [[fleet[0], a.id], [fleet[1], a.id], [fleet[2], b.id], [fleet[3], a.id]] as const) {
    hurtEnemy(room.combat, d, 999, d.pos.clone().add(new THREE.Vector3(0, 0, 1)), who);
  }
  room.step();
  await new Promise((r) => setTimeout(r, 0));
  ok("a fifth of a kill a member, on the seats", Math.abs(a.kills - 0.6) < 1e-9 && Math.abs(b.kills - 0.2) < 1e-9, `${a.kills} ${b.kills}`);
  ok("the seat over half takes the flock kill", a.flocks === 1 && b.flocks === 0, `${a.flocks} ${b.flocks}`);
  ok("the tally is cleared with the fleet", a.tally.size === 0 && b.tally.size === 0);
  ok("a gem of the fleet's tier is in the world", room.combat.gems.length === 1 && room.combat.gems[0].tier === 2);
  ok("everyone is told", wsB.all("e").some((m: any) => (m.v as any[]).some((v) => v.k === "flockDown" && v.who === a.id)));
  const st = wsA.last("s");
  ok("and sees it on the wire", Array.isArray(st.G) && st.G.length === 1 && st.G[0][3] === 2, JSON.stringify(st.G));
  const saved = [...storage.keys()].filter((k) => String(k).startsWith("gem:"));
  ok("it is written to storage at once", saved.length === 1, `${saved.length}`);

  /* B flies through it: B's property, banked, gone from storage. */
  const gem = room.combat.gems[0];
  b.body.pos.copy(gem.pos);
  room.combat.gems.length = 0;
  room.combat.events.push({ kind: "gem", at: gem.pos.clone(), power: 1, tier: gem.tier, who: b.id });
  room.step();
  await new Promise((r) => setTimeout(r, 0));
  ok("the gem is the seat's", b.gems[1] === 1, `${b.gems}`);
  ok("and leaves storage", [...storage.keys()].filter((k) => String(k).startsWith("gem:")).length === 0);
  credits.length = 0;
  await room.bank(b);
  ok("banking carries gems and flock kills", credits[0]?.gems?.[1] === 1 && credits[0]?.flocks === 0, JSON.stringify(credits[0]));
  credits.length = 0;
  await room.bank(a);
  ok("and the flock kill", credits[0]?.flocks === 1, JSON.stringify(credits[0]));
  room.stop();
}

// Everyone dead: the fight starts over at wave one; gems survive it.
{
  storage.clear();
  const room = newRoom();
  const wsA = new FakeSocket(), wsB = new FakeSocket();
  const a = join(room, wsA, "r-a");
  const b = join(room, wsB, "r-b");
  const { startWave, dropGem } = await import("../../../ui/src/wallet/rebels/rebelsCombat");
  startWave(room.combat, 7);
  room.combat.enemies.push(...room.combat.enemies);   /* whatever is there */
  dropGem(room.combat, 3, a.body.pos.clone().add(new THREE.Vector3(0, 0, 20)), "keep-me");
  const waveBefore = room.combat.wave?.n;
  room.down(a);
  ok("one player down: the fight goes on", room.combat.wave?.n === waveBefore && !b.dead, `${room.combat.wave?.n}`);
  room.down(b);
  ok("everyone down: back to wave one", room.combat.wave?.n === 1, `${room.combat.wave?.n}`);
  ok("with nothing left in the air", room.combat.enemies.length === 0 && room.combat.bullets.length === 0);
  ok("and the gems still there", room.combat.gems.length === 1 && room.combat.gems[0].id === "keep-me");
  room.stop();
}

// Respawn: thirty seconds, ten with a VIP Pass declared.
{
  const room = newRoom();
  const wsA = new FakeSocket(), wsB = new FakeSocket();
  room.seat(wsA as never);
  const idA = wsA.last("hi").id as string;
  wsA.deliver(JSON.stringify({ t: "join", node: "v-a", name: "A", home: [0, 0, R], gear: ["vip"] }));
  const a = room.seats.get(idA);
  const b = join(room, wsB, "v-b");
  room.down(a);
  ok("a VIP pass respawns in ten seconds", a.respawn === 10, `${a.respawn}`);
  room.down(b);
  ok("without it, thirty", b.respawn === 30, `${b.respawn}`);
  room.stop();
}

console.log(`\n${out.length - failures} passed, ${failures} failed`);
if (failures > 0) process.exit(1);
