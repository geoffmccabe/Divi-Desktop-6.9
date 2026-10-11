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
import { GAME_MAX_PAYOUT, LIVE_MAX_ENEMIES } from "../../../ui/src/wallet/rebels/gameTypes";
import { R } from "../../../ui/src/wallet/rebels/orbitWorld";
import { MAX_AMMO, MAX_SHIELD, BOOST, MAX_TORPEDOES, MAX_GUARDS } from "../../../ui/src/wallet/rebels/orbitFlight";
import {
  setDropRandomForTests, setDragonRandomForTests, spawnDragon, spawnFleet,
  spawnFighter, BULLET_SPEED,
} from "../../../ui/src/wallet/rebels/rebelsCombat";
import { WING_NOSE } from "../../../ui/src/wallet/rebels/rebelsWings";
setDragonRandomForTests(() => 0.99);

/* Wrecks roll for items. Pinned to "nothing" so a count of gems or storage
   keys in the tests below is what the test put there; the drop block sets
   its own rolls. */
setDropRandomForTests(() => 0.99);

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
/** Which round the room is running, from one.
 *
 *  The wave number used to come from the simulation's own clock; the game
 *  controller owns the rounds now (gameRunner.ts) and combat.wave stays null.
 *  Read through one helper so a test says "which round" rather than reaching
 *  into whichever machinery currently answers that - and, more to the point,
 *  so a test cannot pass by comparing two undefineds, which is exactly what
 *  "the fight goes on" started doing the moment the wave went away. */
function roundOf(room: { run?: { round: number; done: boolean } | null }): number | null {
  const run = room.run;
  return run && !run.done ? run.round + 1 : null;
}

function newRoom() {
  const room = new RebelsRoom(fakeState, fakeEnv) as any;
  return room;
}
/** `home` is the TIP of the player's own tower, mast and all, which is what
 *  the cockpit sends and what docking is measured to. */
/**
 * Seat a player AND put them in the fight.
 *
 * Joining and flying are two messages now: the cockpit opens its socket when
 * the map hands over its scene, and the room only counts the seat as a player
 * once LAUNCH is pressed. Almost every test below wants a player in the fight,
 * so the helper sends both; the ones that care about the difference are at the
 * end of the file and send them apart.
 */
function join(room: any, ws: FakeSocket, node = "node-a", home: [number, number, number] = [0, 0, R + 6]) {
  const seat = seatOnly(room, ws, node, home);
  ws.deliver(JSON.stringify({ t: "fly" }));
  return seat;
}
/** Seated, but still reading the launch card. */
function seatOnly(room: any, ws: FakeSocket, node = "node-a", home: [number, number, number] = [0, 0, R + 6]) {
  room.seat(ws as never);
  const id = ws.last("hi").id as string;
  ws.deliver(JSON.stringify({ t: "join", node, name: "A Node", home }));
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
  /* Sniping from the far side of the planet. The shot HAPPENS, because a
     shot is never thrown away, but it leaves from where the room has this
     ship and not from where the message claimed. Claiming to be somewhere
     else therefore gains nothing, which is the whole point. */
  ws.deliver(JSON.stringify({ t: "fire", k: "main", p: [0, 0, -(R + 8)], f: [0, 1, 0] }));
  ok("a shot claiming to come from across the planet still fires",
     room.combat.bullets.length === before + 2, `${room.combat.bullets.length}`);
  ok("but from where the room has the ship, not from where it claimed",
     room.combat.bullets[room.combat.bullets.length - 1].pos.distanceTo(seat.body.pos) < 10,
     `${room.combat.bullets[room.combat.bullets.length - 1].pos.distanceTo(seat.body.pos).toFixed(1)} away`);
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
  const roundBefore = roundOf(room as never);
  ok("(setup) the room is running a round at all", roundBefore !== null, `${roundBefore}`);
  room.down(a);
  ok("one player down: the fight goes on",
     roundOf(room as never) === roundBefore && !b.dead, `round ${roundOf(room as never)}`);
  room.down(b);
  ok("everyone down: back to round one", roundOf(room as never) === 1, `round ${roundOf(room as never)}`);
  ok("with nothing left in the air", room.combat.enemies.length === 0 && room.combat.bullets.length === 0);
  ok("and the gems still there", room.combat.gems.length === 1 && room.combat.gems[0].id === "keep-me");
  room.stop();
}

// The speed budget allows a super-boosting ship, and grows with a faster item.
{
  const room = newRoom();
  const ws = new FakeSocket();
  const seat = join(room, ws, "fast-a");
  /* ---- AND FOR CARRIED SPEED, WHICH IS MOST OF IT NOW ----
     Boosting builds a speed that nothing bleeds away (see DRIFT_MAX_MULT in
     orbitFlight.ts), so the budget has to cover four boosts' worth of carry
     plus a boost held on top of it plus a diagonal slide. A budget that left
     the carry out would snap an honest pilot backwards the moment they had
     built any up, which is the worst bug this check can have. */
  ok("a stock ship is budgeted for carried speed, super boost and a slide",
     seat.topSpeed > BOOST * 6 && seat.topSpeed < BOOST * 7,
     `${seat.topSpeed.toFixed(1)} a second, which is ${(seat.topSpeed / BOOST).toFixed(1)} boosts`);
  /* Two boosts' worth of movement in one report: fine. */
  room.now = 1;
  (seat as any).lastTf = 0.95;
  const p = seat.body.pos.clone().add(new THREE.Vector3(0, BOOST * 2 * 0.05, 0));
  ws.deliver(JSON.stringify({ t: "tf", p: p.toArray(), f: [0, 1, 0] }));
  ok("a super-boost move is accepted", seat.body.pos.distanceTo(p) < 1e-6 && !ws.all("no").length, JSON.stringify(ws.last("no")));
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

// Opened passives ride in with the gear; Y is applied by the room and paced.
{
  storage.clear();
  const room = newRoom();
  room.setDropsForTests(null, () => 0.99);
  const ws = new FakeSocket();
  room.seat(ws as never);
  ws.deliver(JSON.stringify({ t: "join", node: "h-node", name: "H", home: [0, 0, R], gear: ["hull3", "vstrafe2", "deathray"] }));
  const seat = room.seats.get(ws.last("hi").id);
  ok("a Hull Boost T3 in the gear is 60% more hull, from the room", seat.shieldMax === Math.round(MAX_SHIELD * 1.6) && seat.shield === seat.shieldMax, `${seat.shieldMax}`);
  ok("junk gear is dropped, opened passives kept", seat.gear.has("hull3") && seat.gear.has("vstrafe2") && !seat.gear.has("deathray"));
  ok("the top speed budget knows the vertical strafe", seat.topSpeed > BOOST * 2 + 4.5 * 1.42);
  seat.shield = 100; seat.ammo = 2; seat.torps = 0; seat.guards = 0;
  ws.deliver(JSON.stringify({ t: "use", k: "recharge" }));
  ok("a recharge refills the seat to ITS full", seat.shield === seat.shieldMax && seat.ammo === seat.ammoMax && seat.torps === seat.torpsMax && seat.guards === MAX_GUARDS, `${seat.shield} ${seat.ammo} ${seat.torps} ${seat.guards}`);
  ok("and the gauges go straight back", ws.last("you").shield === seat.shieldMax);
  ws.deliver(JSON.stringify({ t: "use", k: "supercharge" }));
  ok("a second one inside two seconds is ignored", seat.shield === seat.shieldMax);
  room.now += 3;
  ws.deliver(JSON.stringify({ t: "use", k: "supercharge" }));
  ok("after the gap, a supercharge doubles", seat.shield === seat.shieldMax * 2 && seat.ammo === seat.ammoMax * 2, `${seat.shield}`);
  room.now += 3;
  ws.deliver(JSON.stringify({ t: "use", k: "deathray" }));
  ok("a made-up item is refused", ws.last("no")?.why === "no such item");
  room.stop();
}

// A shot leaves from where the cockpit says, not from the room's older copy;
// the tower refills the seat, only at a tower, only every few seconds; the
// test cheats work in company too.
{
  storage.clear();
  const room = newRoom();
  room.setDropsForTests(null, () => 0.99);
  const ws = new FakeSocket();
  const seat = join(room, ws, "s-node");
  const near = seat.body.pos.clone().add(new THREE.Vector3(0, 3, 0));
  ws.deliver(JSON.stringify({ t: "fire", k: "main", p: [near.x, near.y, near.z], f: [0, 1, 0] }));
  const b = room.combat.bullets[room.combat.bullets.length - 1];
  ok("a round leaves from the reported position when it is close enough", !!b && b.pos.distanceTo(near) < 4 && b.pos.distanceTo(seat.body.pos) > b.pos.distanceTo(near), `${b?.pos.distanceTo(near).toFixed(2)} vs ${b?.pos.distanceTo(seat.body.pos).toFixed(2)}`);

  /* The two muzzles sit at the SHIP's sides: right is forward crossed with
     the up the cockpit sends, however the ship is rolled. */
  room.combat.bullets.length = 0;
  const p0 = seat.body.pos;
  room.now += 1;
  ws.deliver(JSON.stringify({ t: "fire", k: "main", p: [p0.x, p0.y, p0.z], f: [0, 1, 0], u: [1, 0, 0] }));
  const [l, r] = room.combat.bullets.slice(-2);
  const across = l.pos.clone().sub(r.pos);
  const expectRight = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(1, 0, 0)).normalize();
  ok("a rolled ship's muzzles follow its own up", Math.abs(Math.abs(across.clone().normalize().dot(expectRight)) - 1) < 1e-6, across.toArray().map((n: number) => n.toFixed(2)).join(","));
  ok("without an up the room falls back to away-from-the-planet", (() => {
    room.combat.bullets.length = 0;
    room.now += 1;
    ws.deliver(JSON.stringify({ t: "fire", k: "main", p: [p0.x, p0.y, p0.z], f: [0, 1, 0] }));
    const [a, c] = room.combat.bullets.slice(-2);
    const d = a.pos.clone().sub(c.pos).normalize();
    const radialRight = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), p0.clone().normalize()).normalize();
    return Math.abs(Math.abs(d.dot(radialRight)) - 1) < 1e-6;
  })());

  /* ---- THE MINI GUN MEETS THE CROSSHAIR ----
     Its muzzle is a corner of the frame, so the round does not travel along
     the aim: it travels to where the aim POINTS, fifty-five units out, and
     crosses it there. What went wrong was the cockpit sending the muzzle as
     its position, which moved that crossing point up and out with it. */
  {
    room.combat.bullets.length = 0;
    room.now += 2;
    /* The mini gun has to be declared, as any gun does. */
    ws.deliver(JSON.stringify({ t: "gear", gear: ["mini"] }));
    room.now += 1;
    const eye = seat.body.pos.clone();
    const aim = new THREE.Vector3(0.2, 0.9, 0.3).normalize();
    ws.deliver(JSON.stringify({
      t: "fire", k: "mini", p: [eye.x, eye.y, eye.z], f: [0, 1, 0],
      a: [aim.x, aim.y, aim.z], u: [0, 0, 1],
    }));
    const shot = room.combat.bullets[room.combat.bullets.length - 1];
    const mark = eye.clone().addScaledVector(aim, 55);
    /* Closest approach of the round's line to the point under the crosshair. */
    const dir = shot.vel.clone().normalize();
    const along = mark.clone().sub(shot.pos).dot(dir);
    const miss = mark.distanceTo(shot.pos.clone().addScaledVector(dir, along));
    ok("a mini round crosses the point under the crosshair", miss < 1.5, `${miss.toFixed(2)} units off`);
    ok("and it leaves from beside the ship, not from the crosshair", shot.pos.distanceTo(eye) < 6 && shot.pos.distanceTo(eye) > 0.5,
       `${shot.pos.distanceTo(eye).toFixed(2)}`);
  }

  /* A torpedo is the room's, and comes back on the wire to be drawn. */
  room.now += 1;
  ws.deliver(JSON.stringify({ t: "fire", k: "torp", p: [p0.x, p0.y, p0.z], f: [0, 1, 0] }));
  room.step();
  const st1 = ws.last("s");
  ok("a launched torpedo is on the wire", Array.isArray(st1.T) && st1.T.length === 1 && st1.T[0].length === 6, JSON.stringify(st1.T));
  ok("and off the rack", seat.torps === seat.torpsMax - 1);

  /* ---- THE TOWER ----
     Measured to the player's OWN mast, reported when they joined. The room's
     own tower list is deliberately not consulted: nothing has ever filled it
     in, so every dock used to be refused and the resupply a player watched
     was their cockpit's animation and nothing else. */
  seat.ammo = 0; seat.shield = 10; seat.torps = 0;
  seat.body.pos.set(0, 0, R + 8);
  ok("(setup) the room has no tower list at all", room.tips.length === 0);
  ws.deliver(JSON.stringify({ t: "dock" }));
  ok("at your own tower, the dock refills the seat", seat.ammo === seat.ammoMax && seat.shield === seat.shieldMax && seat.torps === seat.torpsMax, `${seat.ammo} ${seat.shield}`);
  ok("and the gauges go back", ws.last("you").ammo === seat.ammoMax);
  seat.ammo = 0;
  ws.deliver(JSON.stringify({ t: "dock" }));
  ok("not again inside the resupply time", seat.ammo === 0);
  room.now += 10;
  seat.body.pos.set(0, R + 8, 0);          /* a quarter of the way round the world */
  ws.deliver(JSON.stringify({ t: "dock" }));
  ok("away from your own tower it is refused", seat.ammo === 0 && ws.last("no")?.why === "not at a tower");
  /* And it still works after a launch, which halves every mast under you. */
  room.now += 10;
  seat.body.pos.copy(seat.home).normalize().multiplyScalar(R + 3);
  ws.deliver(JSON.stringify({ t: "dock" }));
  ok("and at a tower half its old height, since launching shrinks them", seat.ammo === seat.ammoMax, `${seat.ammo}`);

  ws.deliver(JSON.stringify({ t: "cheat", code: "21" }));
  const d = room.combat.enemies.find((e: any) => e.dragon);
  ok("the dragon cheat works in company", !!d && d.pos.distanceTo(seat.body.pos) > 30, `${d?.pos.distanceTo(seat.body.pos).toFixed(1)}`);
  ws.deliver(JSON.stringify({ t: "cheat", code: "21" }));
  ok("one at a time", room.combat.enemies.filter((e: any) => e.dragon).length === 1);
  ws.deliver(JSON.stringify({ t: "cheat", code: "13" }));
  ok("a flock cheat too, worth nothing", room.combat.enemies.some((e: any) => e.drone && e.cheat));
  room.stop();
}

// The stake bonus belongs to a seat, is the client's word, and is capped.
{
  storage.clear();
  const room = newRoom();
  room.setDropsForTests(null, () => 0.99);
  const wsA = new FakeSocket(), wsB = new FakeSocket();
  const a = join(room, wsA, "a-node");
  const b = join(room, wsB, "b-node");
  const { spawnFleet, hurtEnemy } = await import("../../../ui/src/wallet/rebels/rebelsCombat");
  wsA.deliver(JSON.stringify({ t: "bonus" }));
  ok("the seat that asked has it", a.bonusUntil > room.now && b.bonusUntil < room.now);
  ok("and is told how long is left", wsA.last("you").bonus > 0 && !wsB.last("you").bonus);

  /* The fight asks per shooter, which is the whole point: one number for
     the world would give everyone in the room somebody else's bonus. */
  const scale = room.world.damageScale;
  ok("the fight asks per shooter", typeof scale === "function");
  ok("triple for the one with it, ordinary for the other", scale(a.id) === 3 && scale(b.id) === 1, `${scale(a.id)} ${scale(b.id)}`);
  ok("and for nobody at all", scale("") === 1);
  void spawnFleet; void hurtEnemy;

  a.bonusUntil = -99;
  wsA.deliver(JSON.stringify({ t: "bonus" }));
  ok("asking again straight away gets nothing", a.bonusUntil < room.now);
  room.now += 400;
  wsA.deliver(JSON.stringify({ t: "bonus" }));
  ok("after five minutes it can be claimed again", a.bonusUntil > room.now);
  room.stop();
}

// ---- THE WINGMEN ----
// Declared as counts, built by the room, flown in formation, firing in
// unison at their tier's share, hit like anything else, and back with the
// ship when it respawns.
{
  storage.clear();
  const room = newRoom();
  room.setDropsForTests(null, () => 0.99);
  const ws = new FakeSocket();
  const seat = join(room, ws, "w-node");
  ok("nobody flies wingmen by default", seat.wings.length === 0);

  /* Two T2 and one T4: the best comes first. */
  room.now += 2;
  ws.deliver(JSON.stringify({ t: "gear", gear: [], reach: 4, drones: [0, 2, 0, 1, 0, 0, 0] }));
  ok("three wingmen, best tier first", seat.wings.map((w: any) => w.tier).join(",") === "4,2,2",
     seat.wings.map((w: any) => w.tier).join(","));
  ok("their hulls are shares of the ship's",
     seat.wings[0].hullMax === Math.round(seat.shieldMax * 1.4) && seat.wings[1].hullMax === Math.round(seat.shieldMax * 0.8),
     `${seat.wings[0].hullMax} ${seat.wings[1].hullMax}`);
  ok("and their magazines too", seat.wings[0].ammoMax === Math.round(seat.ammoMax * 1.5));
  ok("eight at most", (() => {
    room.now += 2;
    ws.deliver(JSON.stringify({ t: "gear", gear: [], drones: [20, 0, 0, 0, 0, 0, 0] }));
    return seat.wings.length === 8;
  })());
  room.now += 2;
  ws.deliver(JSON.stringify({ t: "gear", gear: [], reach: 4, drones: [0, 2, 0, 1, 0, 0, 0] }));

  /* In formation: a ring round the ship, none of them on its nose or tail. */
  room.step();
  const ring = seat.wings.map((w: any) => w.pos.distanceTo(seat.body.pos));
  ok("they sit in a ring around the ship", ring.every((d: number) => Math.abs(d - 12) < 0.001), ring.map((d: number) => d.toFixed(1)).join(","));
  ok("none on the nose or the tail", seat.wings.every((w: any) => Math.abs(w.pos.clone().sub(seat.body.pos).dot(seat.body.fwd)) < 0.001));
  ok("and they are on the wire", (() => {
    const st = ws.last("s");
    return Array.isArray(st.W) && st.W.length === 3 && st.W[0][0] === seat.id && st.W[0][7] === 4;
  })(), JSON.stringify(ws.last("s").W?.[0]));

  /* ⚠ THE RING NO LONGER TURNS, and this used to assert that it did. Geoff:
     "Let's not make them orbit for now." A wingman holds the slot it was given
     in the ship's frame, so with the ship still it does not move at all. */
  const before = seat.wings[0].pos.clone();
  for (let i = 0; i < 20 * 4; i++) room.step();          /* four seconds */
  ok("the ring holds station instead of turning", seat.wings[0].pos.distanceTo(before) < 1e-6,
     `${seat.wings[0].pos.distanceTo(before).toFixed(1)} units in four seconds`);

  /* ---- IN UNISON ----
     One trigger, four streams: the player's two and one from each wingman. */
  room.combat.bullets.length = 0;
  room.now += 1;
  const p0 = seat.body.pos;
  /* ⚠ THE SHIP IS MOVING, AND ACROSS ITS LINE OF FIRE, which is what makes
     the velocity assertions below mean anything. With the seat stationary
     every round's speed equals BULLET_SPEED whether the ship's velocity was
     added or not, and the test passed with the bug in place: I checked by
     putting the bug back. A test of an addition needs a non-zero addend. */
  seat.vel.set(30, 0, -40);
  ws.deliver(JSON.stringify({ t: "fire", k: "main", p: [p0.x, p0.y, p0.z], f: [0, 1, 0], u: [0, 0, 1] }));
  const fired = room.combat.bullets;
  ok("the wingmen fire with their owner", fired.length === 5, `${fired.length} rounds`);
  ok("each round is credited to the owner", fired.every((b: any) => b.owner === seat.id));
  const shares = fired.map((b: any) => b.scale ?? 1).sort();
  ok("and carries its own tier's share", shares.join(",") === "0.8,0.8,1,1,1.4", shares.join(","));
  ok("their magazines empty, not the ship's", seat.wings.every((w: any) => w.ammo === w.ammoMax - 1));

  /* ---- WHERE A DRONE'S ROUND COMES FROM AND HOW FAST ----
     Geoff: "also in parallel, and from the nose of the drone (a single shot
     from each drone)". Parallel and single were already true; these two were
     not. */
  {
    const aim = new THREE.Vector3(0, 1, 0);
    /* Every round, the player's and the drones', down the same line. */
    ok("every round in the volley flies parallel",
       fired.every((b: any) => {
         const d = b.vel.clone().sub(seat.vel).normalize();
         return d.angleTo(aim) < 1e-6;
       }));
    /* ⚠ AND EVERY ONE CARRIES THE SHIP'S VELOCITY. The drones' rounds did
       not: their pushBullet was a fourth firing site that the velocity
       inheritance never reached, so at boost a drone's fire fell behind the
       player's out of the formation it flies in. */
    ok("and every round carries the ship's own velocity",
       fired.every((b: any) => {
         const own = b.vel.clone().sub(seat.vel);
         return Math.abs(own.length() - BULLET_SPEED) < 1e-6;
       }), fired.map((b: any) => b.vel.clone().sub(seat.vel).length().toFixed(1)).join(", "));
    /* The drones' rounds start AHEAD of the drone, not inside it. */
    const droneRounds = fired.filter((b: any) => (b.scale ?? 1) !== 1 || b.pos.distanceTo(seat.body.pos) > 5);
    ok("a drone's round starts ahead of the drone, not inside it",
       seat.wings.every((w: any) => droneRounds.some((b: any) =>
         Math.abs(b.pos.distanceTo(w.pos) - WING_NOSE) < 1e-6
         && b.pos.clone().sub(w.pos).normalize().angleTo(aim) < 1e-6)),
       `${droneRounds.length} drone rounds against ${seat.wings.length} drones`);
  }

  /* Hit: the hull comes off the wingman, not the ship. */
  const hull = seat.wings[0].hull;
  const shield = seat.shield;
  room.combat.events.push({
    kind: "wingHit", at: seat.wings[0].pos.clone(), power: 1, damage: 40,
    who: seat.id, slot: seat.wings[0].slot,
  });
  room.step();
  ok("a hit takes the wingman's hull, not the ship's", seat.wings[0].hull === hull - 40 && seat.shield === shield,
     `${seat.wings[0].hull} of ${hull}`);
  room.combat.events.push({
    kind: "wingHit", at: seat.wings[0].pos.clone(), power: 1, damage: 99999,
    who: seat.id, slot: seat.wings[0].slot,
  });
  room.step();
  ok("enough of them and it is gone", seat.wings[0].hull === 0);
  ok("everyone is told", ws.all("e").some((m: any) => (m.v as any[]).some((v) => v.k === "wingDown")));
  ok("and it leaves the wire", (ws.last("s").W as any[]).length === 2);
  room.combat.bullets.length = 0;
  room.now += 1;
  ws.deliver(JSON.stringify({ t: "fire", k: "main", p: [p0.x, p0.y, p0.z], f: [0, 1, 0], u: [0, 0, 1] }));
  ok("a dead wingman does not fire", room.combat.bullets.length === 4, `${room.combat.bullets.length}`);

  /* Respawn brings them back with the ship. */
  seat.shield = 0;
  room.down(seat);
  seat.respawn = 0;
  room.revive(seat);
  ok("they come back with the ship", seat.wings.every((w: any) => w.hull === w.hullMax && w.ammo === w.ammoMax));
  room.stop();
}

// The dragon goes over the wire as kind 2, with its two thousand.
{
  storage.clear();
  const room = newRoom();
  room.setDropsForTests(null, () => 0.99);
  const ws = new FakeSocket();
  join(room, ws, "d-node");
  spawnDragon(room.combat, new THREE.Vector3(0, 0, R + 30));
  room.step();
  const st = ws.last("s");
  const row = (st.E as any[]).find((e) => e[9] === 2);
  ok("the cockpit is told it is a dragon", !!row && row[8] === 2000, JSON.stringify(row));
  ok("and told it appeared", ws.all("e").some((m: any) => (m.v as any[]).some((v) => v.k === "dragon")));
  room.stop();
}

// Dropped items: the room rolls, the owner alone sees it for a minute, the
// pickup is banked by key, and it survives a restart.
{
  storage.clear();
  const room = newRoom();
  const wsA = new FakeSocket(), wsB = new FakeSocket();
  const a = join(room, wsA, "a-node");
  const b = join(room, wsB, "b-node");
  const rolls: number[] = [];
  room.setDropsForTests(null, () => rolls.shift() ?? 0.99);
  /* The capture ball is the client's measurement, kept within reason. */
  ok("a join without a reach gets the floor", a.body.reach === 2.2, `${a.body.reach}`);
  const wsW = new FakeSocket();
  room.seat(wsW as never);
  wsW.deliver(JSON.stringify({ t: "join", node: "w-node", name: "W", home: [0, 0, R], reach: 400 }));
  const wSeat = room.seats.get(wsW.last("hi").id);
  ok("a giant reach is clamped to the ceiling", wSeat.body.reach === 9, `${wSeat.body.reach}`);
  room.leave(wSeat);
  const { spawnFleet, hurtEnemy, setFlockRandomForTests } = await import("../../../ui/src/wallet/rebels/rebelsCombat");
  setFlockRandomForTests(() => 1);
  const fleet = spawnFleet(room.combat, 2, a.body.pos, a.body.fwd, { count: 3 });
  rolls.push(0.01, 0);
  hurtEnemy(room.combat, fleet[0], 999, fleet[0].pos.clone().add(new THREE.Vector3(0, 0, 1)), a.id);
  room.step();
  await new Promise((r) => setTimeout(r, 0));
  const drop = room.combat.gems.find((g: any) => g.item);
  ok("a kill in the room can leave an item", drop?.item === "recharge" && drop?.owner === a.id, JSON.stringify(drop && { item: drop.item, owner: drop.owner }));
  ok("it is written to storage with its name and owner", [...storage.map.values()].some((v: any) => v.item === "recharge" && v.owner === a.id));
  const sA = wsA.last("s"), sB = wsB.last("s");
  ok("the owner sees it on the wire", Array.isArray(sA.G) && sA.G.some((g: any) => g[6] === "recharge" && g[7] === a.id && g[8] > 0), JSON.stringify(sA.G));
  ok("nobody else is told it exists", !Array.isArray(sB.G) || !sB.G.some((g: any) => g[6] === "recharge"), JSON.stringify(sB.G));
  ok("the drop event carries the key and reaches the owner", wsA.all("e").some((m: any) => (m.v as any[]).some((v) => v.k === "drop" && v.item === "recharge" && v.id === drop.id)));

  /* B parks on it: nothing, for a minute. */
  b.body.pos.copy(drop.pos);
  a.body.pos.set(0, 0, R + 90);
  room.step();
  ok("someone else cannot take it yet", room.combat.gems.includes(drop) && Object.keys(b.items).length === 0);
  drop.hidden = 0;
  room.step();
  b.body.pos.copy(drop.pos);
  room.step();
  await new Promise((r) => setTimeout(r, 0));
  ok("after the minute it is anyone's, and goes into the seat by key", b.items.recharge === 1, JSON.stringify(b.items));
  ok("and leaves the world and storage", !room.combat.gems.includes(drop) && ![...storage.map.values()].some((v: any) => v.item === "recharge"));
  ok("the taker is told which item", wsB.all("e").some((m: any) => (m.v as any[]).some((v) => v.k === "gem" && v.item === "recharge" && v.who === b.id)));
  credits.length = 0;
  await room.bank(b);
  ok("banking carries items by key", credits[0]?.items?.recharge === 1, JSON.stringify(credits[0]));
  ok("and the seat is empty again", Object.keys(b.items).length === 0);

  /* Another drop, still private, and the room restarts: it comes back as
     everyone's, because its owner's seat is gone. */
  rolls.push(0.01, 0.5);
  hurtEnemy(room.combat, fleet[1], 999, fleet[1].pos.clone().add(new THREE.Vector3(0, 0, 1)), a.id);
  room.step();
  await new Promise((r) => setTimeout(r, 0));
  const second = room.combat.gems.find((g: any) => g.item);
  ok("(setup) a private drop is in the world", !!second && second.hidden > 0, JSON.stringify(second && { item: second.item }));
  room.stop();
  await new Promise((r) => setTimeout(r, 0));
  const room2 = newRoom();
  room2.setDropsForTests(null, () => 0.99);
  const ws2 = new FakeSocket();
  join(room2, ws2, "c-node");
  await new Promise((r) => setTimeout(r, 0));
  const back = room2.combat.gems.find((g: any) => g.item === second.item);
  ok("it is there after a restart, and now anyone's", !!back && back.hidden === 0 && back.owner === "", JSON.stringify(back && { hidden: back.hidden, owner: back.owner }));
  room2.stop();
}

/* ---- A SHOT IS NEVER THROWN AWAY FOR BEING A FEW UNITS OUT ----
   The room's copy of a position is up to a report behind, and a ship at
   super boost covers several units in that time. Refusing the shot meant a
   player's guns stopped working: one rejected transform left the room's copy
   behind for good, and every shot after it was "fired from elsewhere". */
{
  storage.clear();
  const room = newRoom();
  room.setDropsForTests(null, () => 0.99);
  const ws = new FakeSocket();
  const seat = join(room, ws, "s-node");
  const p = seat.body.pos.clone();

  room.now += 1;
  room.combat.bullets.length = 0;
  const near = p.clone().add(new THREE.Vector3(4, 0, 0));
  ws.deliver(JSON.stringify({ t: "fire", k: "main", p: [near.x, near.y, near.z], f: [0, 1, 0], u: [0, 0, 1] }));
  ok("a shot four units out fires, from where the cockpit said", room.combat.bullets.length === 2
     && room.combat.bullets[0].pos.distanceTo(near) < 4, `${room.combat.bullets.length}`);

  /* Far enough out that the room does not believe the origin, but the shot
     still happens: from where the room thinks the ship is. */
  room.now += 1;
  room.combat.bullets.length = 0;
  const off = p.clone().add(new THREE.Vector3(80, 0, 0));
  ws.deliver(JSON.stringify({ t: "fire", k: "main", p: [off.x, off.y, off.z], f: [0, 1, 0], u: [0, 0, 1] }));
  ok("a shot eighty units out still fires", room.combat.bullets.length === 2, `${room.combat.bullets.length}`);
  ok("but from the room's own position, not the cockpit's",
     room.combat.bullets[0].pos.distanceTo(p) < 10 && room.combat.bullets[0].pos.distanceTo(off) > 40,
     `${room.combat.bullets[0].pos.distanceTo(p).toFixed(1)} from the ship`);

  /* And a shot from genuinely across the map is still refused, which is what
     the check was ever for. */
  room.now += 1;
  room.combat.bullets.length = 0;
  ws.sent.length = 0;
  ws.deliver(JSON.stringify({ t: "fire", k: "main", p: [0, 2000, 0], f: [0, 1, 0], u: [0, 0, 1] }));
  ok("even a shot claiming to be two thousand units away fires", room.combat.bullets.length === 2);
  ok("from the room's position, so the claim buys nothing",
     room.combat.bullets[0].pos.distanceTo(p) < 10,
     `${room.combat.bullets[0].pos.distanceTo(p).toFixed(1)} from the ship`);
  /* A transform out of the world is still corrected, and the correction
     carries the position so the cockpit can obey it. */
  ws.sent.length = 0;
  ws.deliver(JSON.stringify({ t: "tf", p: [0, 0, 99999], f: [0, 1, 0] }));
  ok("a transform out of the world is corrected", ws.last("no")?.why === "outside the world", ws.last("no")?.why);
  ok("and the correction says where the room has the ship",
     Array.isArray(ws.last("no")?.p) && ws.last("no").p.length === 3, JSON.stringify(ws.last("no")?.p));
  room.stop();
}

/* ---- JOINING IS NOT FLYING ----
   Geoff, 2026-Sep-13: "when the game starts it seems to have the player taking
   damage almost instantly and I don't know why. And when it restarts it seems
   to not restart fresh with all stats at zero and no enemies around, but it's
   like going back into the same game."

   Both were the same fault. The cockpit opens its socket the moment the map
   hands over its scene, so the connection is settled before anybody launches,
   and the room counted that seat as a player straight away: the waves began,
   the fighters spawned and they all came for a ship parked on its pad while
   the human was still reading the launch card. Pressing LAUNCH then dropped
   them into a fight that had been running for as long as they had been
   reading. */
{
  const room = newRoom();
  const ws = new FakeSocket();
  const seat = seatOnly(room, ws);
  ok("a seated player is not yet in the fight", seat.joined && !seat.flying);
  room.refreshRoster();
  ok("so the simulation has nobody to run for", room.world.players.length === 0,
     `${room.world.players.length} players`);
  /* Two hundred ticks of reading the launch card. */
  for (let i = 0; i < 200; i++) room.step();
  ok("and no enemies come looking while the card is up", room.combat.enemies.length === 0,
     `${room.combat.enemies.length} enemies`);
  ok("nor is the wave clock running", (room.combat.wave?.n ?? 1) <= 1,
     `round ${roundOf(room as never)}`);

  ws.deliver(JSON.stringify({ t: "fly" }));
  ok("LAUNCH puts them in the fight", seat.flying);
  room.refreshRoster();
  ok("and the simulation now has a player", room.world.players.length === 1);
  ok("launching starts at round one", roundOf(room as never) === 1, `round ${roundOf(room as never)}`);
  ok("with full gauges", seat.shield === seat.shieldMax && seat.ammo === seat.ammoMax);
  room.stop();
}

/* ---- A RESTART IS A RESTART ---- */
{
  const room = newRoom();
  const ws = new FakeSocket();
  const seat = join(room, ws);
  /* Fly a while, and put something in the sky. */
  for (let i = 0; i < 60; i++) room.step();
  spawnFleet(room.combat, 3, seat.body.pos, seat.body.fwd, { count: 8 });
  seat.score = 500; seat.kills = 7;
  ok("there is a fight in progress", room.combat.enemies.length > 0,
     `${room.combat.enemies.length} enemies`);

  /* Die. */
  room.down(seat);
  ok("death takes them out of the fight", !seat.flying && seat.dead);
  ok("and with nobody flying the sky is cleared", room.combat.enemies.length === 0,
     `${room.combat.enemies.length} enemies`);
  ok("the run's score is banked, not carried", seat.score === 0 && seat.kills === 0,
     `${seat.score} score, ${seat.kills} kills`);

  /* The countdown runs out and the seat is alive again, but STILL not in the
     fight: nothing may happen until the player asks for it. */
  seat.respawn = 0;
  room.revive(seat);
  ok("reviving alone does not put them back in the fight", !seat.dead && !seat.flying);
  for (let i = 0; i < 200; i++) room.step();
  ok("so nothing gathers around them while they decide",
     room.combat.enemies.length === 0, `${room.combat.enemies.length} enemies`);

  ws.deliver(JSON.stringify({ t: "fly" }));
  ok("LAUNCH AGAIN is a NEW game: round one", roundOf(room as never) === 1,
     `round ${roundOf(room as never)}`);
  ok("nothing in the sky from the last one", room.combat.enemies.length === 0);
  ok("full gauges", seat.shield === seat.shieldMax && seat.ammo === seat.ammoMax
     && seat.torps === seat.torpsMax);
  ok("and nothing scored yet", seat.score === 0 && seat.kills === 0);
  room.stop();
}

/* ---- BUT NOT FOR EVERYONE ELSE ----
   One player launching must not wipe the sky out from under the people already
   in it. There is one game and it is shared. */
{
  const room = newRoom();
  const a = new FakeSocket(), b = new FakeSocket();
  const seatA = join(room, a, "node-a", [0, 0, R + 6]);
  for (let i = 0; i < 40; i++) room.step();
  spawnFleet(room.combat, 2, seatA.body.pos, seatA.body.fwd, { count: 6 });
  const before = room.combat.enemies.length;
  ok("the first player has a fight on", before > 0, `${before} enemies`);

  const seatB = seatOnly(room, b, "node-b", [0, R + 6, 0]);
  b.deliver(JSON.stringify({ t: "fly" }));
  ok("the second player joins it", seatB.flying);
  ok("without wiping it", room.combat.enemies.length === before,
     `${before} -> ${room.combat.enemies.length}`);
  room.stop();
}

// N. A WEB GUEST: its own account, banked like anyone, cash-out held for sign-in.
//    Geoff, 2026-Sep-13: web players earn DIVI like normal, and signing in is
//    offered but not required to play.
{
  const room = newRoom();
  const SAME_HOUSE = "198.51.100.9";

  const app = new FakeSocket();
  room.seat(app as never, SAME_HOUSE);
  const appId = app.last("hi").id as string;
  app.deliver(JSON.stringify({ t: "join", node: "house-node", name: "App Pilot", home: [0, 0, R] }));
  const appSeat = room.seats.get(appId);

  const web = new FakeSocket();
  room.seat(web as never, SAME_HOUSE);
  const webId = web.last("hi").id as string;
  web.deliver(JSON.stringify({ t: "join", node: "web-guest", name: "Guest Pilot", door: "web", home: [0, 0, R] }));
  const webSeat = room.seats.get(webId);

  ok("an app player's account is unchanged by the web door", appSeat.account === SAME_HOUSE && !appSeat.guest, appSeat.account);
  ok("a web guest on the same address gets an account of its own",
     webSeat.guest === true && webSeat.account === `web:${SAME_HOUSE}` && webSeat.account !== appSeat.account, webSeat.account);
  ok("both are in the same room, seeing each other", room.seats.size === 2);

  await new Promise((r) => setTimeout(r, 0));
  ok("a guest is told on joining, before asking, that cashing out needs a sign-in",
     /sign in/i.test(String(web.last("purse")?.why ?? "")) && !app.last("purse")?.why, JSON.stringify(web.last("purse")));
  requests.length = 0;
  credits.length = 0;
  webSeat.kills = 2; webSeat.divi = 0.4; webSeat.score = 20;
  web.deliver(JSON.stringify({ t: "claim", to: "D8tjqHzBg3ZA7tUWryChUPqLjz4K41DxSt" }));
  for (let i = 0; i < 4; i++) await new Promise((r) => setTimeout(r, 0));
  ok("a guest's run is still banked, to the guest's own account",
     credits.length === 1 && credits[0].node === `web:${SAME_HOUSE}` && credits[0].divi > 0, JSON.stringify(credits));
  ok("but no cash-out is asked of the ledger", requests.length === 0, JSON.stringify(requests));
  const said = web.last("purse");
  ok("the guest is told to sign in to cash out", typeof said?.why === "string" && /sign in/i.test(said.why), JSON.stringify(said));
  ok("and is never offered an amount to cash out", said?.claimable === 0);
  ok("asking is not a strike", webSeat.strikes === 0);

  requests.length = 0;
  app.deliver(JSON.stringify({ t: "claim", to: "D8tjqHzBg3ZA7tUWryChUPqLjz4K41DxSt" }));
  for (let i = 0; i < 4; i++) await new Promise((r) => setTimeout(r, 0));
  ok("the app player in the same house still cashes out as before",
     requests.length === 1 && requests[0].node === SAME_HOUSE, JSON.stringify(requests));
  room.stop();
}

// N. READY FOR A PUBLIC PAGE: overflow rooms, the names that may exist, guest ids.
{
  const { roomNameOk, nextRoom, guestIdOk } = await import("../src/protocol");
  ok("earth is a room", roomNameOk("earth"));
  ok("so are its overflow rooms, earth-2 to earth-16", roomNameOk("earth-2") && roomNameOk("earth-16"));
  ok("but not earth-1, earth-17 or earth-02", !roomNameOk("earth-1") && !roomNameOk("earth-17") && !roomNameOk("earth-02x"));
  ok("the planet shards p1 to p14 are held", roomNameOk("p1") && roomNameOk("p14") && !roomNameOk("p15"));
  ok("an invented name is not a room", !roomNameOk("my-private-room") && !roomNameOk(""));
  ok("a full earth sends you to earth-2", nextRoom("earth") === "earth-2");
  ok("a full earth-7 sends you to earth-8", nextRoom("earth-7") === "earth-8");
  ok("when earth-16 is full there is nowhere further", nextRoom("earth-16") === "");
  ok("a guest id is long and plain", guestIdOk("3f2b9c1e-7a4d-4e8b-9c2a-1d5e6f7a8b9c"));
  ok("a short or strange one is not trusted", !guestIdOk("abc") && !guestIdOk("<script>alert(1)</script>xxxx") && !guestIdOk(42));

  const room = newRoom();
  const ID = "3f2b9c1e-7a4d-4e8b-9c2a-1d5e6f7a8b9c";
  const a = new FakeSocket();
  room.seat(a as never, "203.0.113.50");
  const aId = a.last("hi").id as string;
  a.deliver(JSON.stringify({ t: "join", node: "web-guest", name: "Pilot 1", door: "web", guest: ID, home: [0, 0, R] }));
  ok("a guest with an id banks under that id, not the address", room.seats.get(aId).account === `guest:${ID}`, room.seats.get(aId).account);
  const b = new FakeSocket();
  room.seat(b as never, "198.51.100.77");
  const bId = b.last("hi").id as string;
  b.deliver(JSON.stringify({ t: "join", node: "web-guest", name: "Pilot 1", door: "web", guest: ID, home: [0, 0, R] }));
  ok("so the same guest on another connection reaches the same account", room.seats.get(bId).account === `guest:${ID}`);
  const c = new FakeSocket();
  room.seat(c as never, "198.51.100.78");
  const cId = c.last("hi").id as string;
  c.deliver(JSON.stringify({ t: "join", node: "web-guest", name: "Pilot 2", door: "web", guest: "bad", home: [0, 0, R] }));
  ok("a guest id that fails the check falls back to the address", room.seats.get(cId).account === "web:198.51.100.78");
  const app = new FakeSocket();
  room.seat(app as never, "198.51.100.79");
  const appId = app.last("hi").id as string;
  app.deliver(JSON.stringify({ t: "join", node: "n", name: "App", guest: ID, home: [0, 0, R] }));
  ok("an app player sending a guest id is still the app account it always was", room.seats.get(appId).account === "198.51.100.79");
  const g = new FakeSocket();
  room.seat(g as never, "198.51.100.80");
  const gId = g.last("hi").id as string;
  g.deliver(JSON.stringify({ t: "join", node: "web-guest", name: "Pilot 3", door: "web", guest: ID,
    ship: "space_SM_Ship_Cruiser_05", paint: [[10, 1, 1, 0], [10, 1, 1, 0], [10, 1, 1, 0], [10, 1, 1, 0], [10, 1, 1, 0]], home: [0, 0, R] }));
  ok("a guest is shown in the first hull whatever its page claims", room.seats.get(gId).ship === "space_SM_Ship_Fighter_01", room.seats.get(gId).ship);
  ok("in the factory paint", room.seats.get(gId).paint === undefined, JSON.stringify(room.seats.get(gId).paint));
  ok("an app player keeps the hull it chose", (() => {
    const a2 = new FakeSocket();
    room.seat(a2 as never, "198.51.100.81");
    const a2Id = a2.last("hi").id as string;
    a2.deliver(JSON.stringify({ t: "join", node: "n2", name: "App 2", ship: "space_SM_Ship_Cruiser_05", home: [0, 0, R] }));
    return room.seats.get(a2Id).ship === "space_SM_Ship_Cruiser_05";
  })());
  room.stop();
}

// N. CHEATS: never from a web guest. "21" is a real dragon that leaves a real egg,
//    and any browser console can send the message.
{
  const room = newRoom();
  const web = new FakeSocket();
  room.seat(web as never, "198.51.100.90");
  const webId = web.last("hi").id as string;
  web.deliver(JSON.stringify({ t: "join", node: "web-guest", name: "Pilot 9", door: "web", guest: "3f2b9c1e-7a4d-4e8b-9c2a-1d5e6f7a8b9c", home: [0, 0, R] }));
  web.deliver(JSON.stringify({ t: "fly" }));
  const before = room.combat.enemies.length;
  web.deliver(JSON.stringify({ t: "cheat", code: "21" }));
  web.deliver(JSON.stringify({ t: "cheat", code: "11" }));
  ok("a web guest's cheat summons nothing", room.combat.enemies.length === before, `${before} -> ${room.combat.enemies.length}`);
  ok("and is not a strike either", room.seats.get(webId).strikes === 0);

  const app = new FakeSocket();
  room.seat(app as never, "198.51.100.91");
  app.deliver(JSON.stringify({ t: "join", node: "n", name: "App", home: [0, 0, R] }));
  app.deliver(JSON.stringify({ t: "fly" }));
  app.deliver(JSON.stringify({ t: "cheat", code: "21" }));
  ok("an app seat's !21 still brings the dragon, for testing", room.combat.enemies.some((e: any) => e.dragon));
  room.stop();
}

// N. identity.ts, directly: who a player is and what they may do.
{
  const I = await import("../src/identity");
  const app = I.whoJoins("203.0.113.1", "node-a", {});
  ok("an app player is its connecting address", app.account === "203.0.113.1" && !app.guest);
  ok("with no address (a local run) the node stands in", I.whoJoins("", "node-a", {}).account === "node-a");
  const guest = I.whoJoins("203.0.113.1", "web-guest", { door: "web", guest: "3f2b9c1e-7a4d-4e8b-9c2a-1d5e6f7a8b9c" });
  ok("a web guest is its private id", guest.account === "guest:3f2b9c1e-7a4d-4e8b-9c2a-1d5e6f7a8b9c" && guest.guest);
  ok("a guest with no sound id is its address, marked as the web's", I.whoJoins("203.0.113.1", "w", { door: "web", guest: "x" }).account === "web:203.0.113.1");
  ok("an app player may cheat and cash out; a guest may do neither", I.mayCheat(app) && I.mayCashOut(app) && !I.mayCheat(guest) && !I.mayCashOut(guest));
  ok("a guest is shown in the first hull; an app player in the one asked for",
     I.shipFor(guest, "space_SM_Ship_Cruiser_05") === I.GUEST_SHIP && I.shipFor(app, "space_SM_Ship_Cruiser_05") === "space_SM_Ship_Cruiser_05");
}

/* ---- THE COUNTDOWN HAS TO END ----
   A revived seat is not FLYING until its player launches again, so with nobody
   else in the room the roster is empty and the tick returns early: not one more
   message goes out, and the cockpit is left showing a dead ship and a stopped
   clock. Geoff: "the 30 second countdown froze... then it froze again and never
   restarted." */
{
  const room = newRoom();
  const ws = new FakeSocket();
  const seat = join(room, ws);
  room.down(seat);
  ok("dead, with a wait", seat.dead && seat.respawn > 0, `${seat.respawn}s`);
  ws.sent.length = 0;
  seat.respawn = 0.01;
  room.step();
  ok("the countdown ends", !seat.dead);
  ok("AND THE COCKPIT IS TOLD, or it waits for ever",
     !!ws.last("you") && !ws.last("you").dead,
     ws.last("you") ? JSON.stringify(ws.last("you")).slice(0, 80) : "nothing was sent");
  room.stop();
}

/* ---- AND IT IS AS LONG AS THE WALLET SAYS ---- */
{
  const room = newRoom();
  const ws = new FakeSocket();
  room.seat(ws as never);
  ws.deliver(JSON.stringify({
    t: "join", node: "rich", name: "Rich", home: [0, 0, R + 6], divi: 20_000_000,
  }));
  const seat = room.seats.get(ws.last("hi").id as string);
  ws.deliver(JSON.stringify({ t: "fly" }));
  room.down(seat);
  ok("twenty million in the wallet is a five second wait", seat.respawn === 5, `${seat.respawn}s`);
  room.stop();
}
{
  const room = newRoom();
  const ws = new FakeSocket();
  const seat = join(room, ws);
  room.down(seat);
  ok("no wallet is the plain thirty", seat.respawn === 30, `${seat.respawn}s`);
  /* And it can arrive late, because the door has to be asked. */
  seat.dead = false;
  ws.deliver(JSON.stringify({ t: "gear", gear: [], divi: 1_000_000 }));
  room.down(seat);
  ok("a balance that arrives after the join still counts", seat.respawn === 10, `${seat.respawn}s`);
  room.stop();
}


/* ================= A CUSTOM ENEMY, THROUGH THE ROOM =================
   customEnemy.test.ts proves the PIECES: the class is cloned, the tune travels,
   the shield is filled. This proves the WIRING, which is a different claim and
   the one that breaks quietly - the spawner's custom branch sits after four
   built-in branches and behind a lookup, and every way of getting it wrong ends
   with "no enemy arrived" rather than with an error.

   Nothing here reaches into customEnemy.ts. It asks the room for what a ROUND
   asks the room for, by the name a game description would use. */
{
  storage.clear();
  const room = newRoom();
  const ws = new FakeSocket();
  join(room, ws, "ce-a");
  room.setDropsForTests(null, () => 0.99);

  const { builtInEnemies, blankEnemy } = await import("../../../ui/src/wallet/rebels/enemyTypes");
  const brute = {
    ...blankEnemy("brute"), name: "Brute", shieldMax: 4000, resistance: 0.5,
    speed: 2, fireEvery: 0.5, fireRange: 300, shotSpeed: 2, damage: 4, worth: 6,
  };
  const swarm = {
    ...blankEnemy("gnats"), name: "Gnats", behaviour: "drone" as const,
    shieldMax: 60, worth: 0.5,
  };
  room.enemyTypes = [...builtInEnemies(), brute, swarm];

  /* ---- one of his fighters ---- */
  room.combat.enemies.length = 0;
  room.spawner().spawn("brute", 2);
  const mine = room.combat.enemies;
  ok("a round can ask for one of Geoff's enemies by name", mine.length === 2,
     `${mine.length} arrived`);
  ok("and it arrives with HIS numbers, not a tier's",
     mine.every((e: any) => e.cls.shieldMax === 4000 && e.shield === 4000 && e.cls.speed === 2),
     `${mine[0]?.cls.shieldMax} hp, ${mine[0]?.shield} in the bar`);
  ok("carrying the five the class had nowhere to put",
     mine[0]?.tune?.resistance === 0.5 && mine[0]?.tune?.damage === 4
     && mine[0]?.tune?.fireRange === 300 && mine[0]?.tune?.worth === 6);
  ok("built as the tier it most looks like, because the wire sends the tier",
     mine[0]?.cls.tier === 7, `tier ${mine[0]?.cls.tier}`);

  /* ---- and the built-ins are untouched by it ----
     The aliasing trap, asserted here as well as in the unit tests, because
     THROUGH THE ROOM is where it would actually have happened. */
  room.combat.enemies.length = 0;
  room.spawner().spawn("tier7", 1);
  ok("an ordinary tier7 asked for afterwards is still an ordinary tier7",
     room.combat.enemies[0]?.cls.shieldMax !== 4000
     && room.combat.enemies[0]?.tune === undefined,
     `${room.combat.enemies[0]?.cls.shieldMax} hp`);

  /* ---- one of his flocks ---- */
  room.combat.enemies.length = 0;
  room.spawner().spawn("gnats", 1);
  const drones = room.combat.enemies.filter((e: any) => e.drone);
  ok("a custom drone arrives as a whole formation, not one ship",
     drones.length > 1, `${drones.length} of them`);
  ok("and every member of it got his numbers",
     drones.length > 0 && drones.every((d: any) => d.cls.shieldMax === 60 && d.tune?.worth === 0.5),
     `${drones[0]?.cls.shieldMax} hp each`);

  /* ---- a name nobody has written ----
     A quiet gap in one round and nothing else. Not a throw, which would stop
     the tick, and not a fallback to some other enemy, which would put a ship
     in the sky that the game description never asked for. */
  room.combat.enemies.length = 0;
  let threw = false;
  try { room.spawner().spawn("nothing-by-that-name", 3); } catch { threw = true; }
  ok("a round naming an enemy nobody has written does not throw", !threw);
  ok("and puts nothing in the sky rather than something else",
     room.combat.enemies.length === 0, `${room.combat.enemies.length} arrived`);

  /* ---- and the round goes on ----
     The gap must be confined to the ENTRY that named the missing enemy. A round
     holds several spawn entries and the game controller calls the spawner once
     per entry per tick, so "an easy screen of fighters plus one knot of
     something custom" must still get its fighters when the custom one is
     misspelt. That is what this asserts, and it is a separate claim from the two
     above it: those say the bad entry is quiet, this says the GOOD ones are
     unaffected. The `return` in the custom branch only abandons the remaining
     copies of the same name, which would not have arrived anyway. */
  room.spawner().spawn("brute", 1);
  ok("the next spawn in the same round still arrives",
     room.combat.enemies.length === 1);

  room.stop();
}


/* ================= THE ROOM ACTUALLY RUNS HIS GAME =================
   ⚠ THE BUG THIS EXISTS FOR made the entire game builder invisible. start() is
   synchronous and fires the config fetch as a `void` promise, so the run was
   chosen a fraction of a second BEFORE the games arrived. Every room began on
   the built-in fallback and nothing ever looked again. Geoff could write a
   game, save it, watch the room load and VALIDATE it, and nobody would ever
   play it - and the state endpoint said gamesLive:true the whole time, because
   the games really had loaded. They just were not being run.

   Nothing was broken and nothing was lost. It simply never took effect. Every
   test in this file passed throughout. */
{
  storage.clear();
  const room = newRoom();
  room.setDropsForTests(null, () => 0.99);
  const { waveDefence } = await import("../../../ui/src/wallet/rebels/gameTypes");

  const his = {
    id: "shakedown", name: "Shakedown", place: "earth", crew: "multiplayer",
    published: true,
    rounds: [{ seconds: 90, spawns: [{ enemy: "fighters", count: 6, arrive: "spread" as const }] }],
  };

  /* The room as it is a moment after starting: running the fallback, because
     the fetch has not landed. This IS the state the bug left it in for ever. */
  const ws = new FakeSocket();
  join(room, ws, "adopt-a");
  ok("(setup) the room starts on the built-in, before any games arrive",
     room.run?.game.id === waveDefence().id, room.run?.game.id);

  /* Now the fetch lands. */
  room.games = [his];
  room.adoptStartupGame();

  ok("once his games arrive, the room runs HIS game",
     room.run?.game.id === "shakedown", room.run?.game.id);
  ok("and it starts at the beginning of it, not partway through",
     room.run?.round === 0 && room.run?.left === 90, `round ${room.run?.round}, ${room.run?.left}s`);
  ok("with a fresh purse, so the fallback's spending is not charged to it",
     room.purse.spent === 0);

  /* ---- ONCE, AND ONLY ONCE ----
     A refresh every ten minutes must not swap the game under people who are
     in the middle of one. */
  room.games = [{ ...his, id: "something-else" }];
  room.adoptStartupGame();
  ok("a later refresh does NOT swap the game under the players",
     room.run?.game.id === "shakedown", room.run?.game.id);
  room.stop();
}

/* A room that was already fighting when the fetch landed is left alone: the
   swap is for the first instants of a room, not for a live fight. */
{
  storage.clear();
  const room = newRoom();
  room.setDropsForTests(null, () => 0.99);
  const ws = new FakeSocket();
  join(room, ws, "adopt-b");
  room.run.round = 3;                       /* three rounds in */
  room.games = [{
    id: "late", name: "Late", place: "earth", crew: "multiplayer", published: true,
    rounds: [{ seconds: 60, spawns: [{ enemy: "fighters", count: 2, arrive: "once" as const }] }],
  }];
  room.adoptStartupGame();
  ok("a room three rounds into a fight is not yanked into a different game",
     room.run?.game.id !== "late", room.run?.game.id);
  room.stop();
}

/* And Earth with nothing written for it keeps the built-in, which is the
   normal case and must not become "no game at all". */
{
  storage.clear();
  const room = newRoom();
  room.setDropsForTests(null, () => 0.99);
  const { waveDefence } = await import("../../../ui/src/wallet/rebels/gameTypes");
  const ws = new FakeSocket();
  join(room, ws, "adopt-c");
  room.games = [];
  room.adoptStartupGame();
  ok("Earth with nothing written for it still runs the built-in",
     room.run?.game.id === waveDefence().id, room.run?.game.id);
  room.stop();
}


/* ---- AND THE WIRING, NOT JUST THE METHOD ----
   Everything above calls adoptStartupGame() by hand, which proves what it does
   and NOT that anything calls it. That distinction is the entire bug: the
   pieces were all correct and the order they ran in was not. So this drives the
   real path, refreshDrops, with the network stubbed, and asserts the room ends
   up running his game without anybody calling the fix directly. */
{
  storage.clear();
  const room = newRoom();
  const { waveDefence } = await import("../../../ui/src/wallet/rebels/gameTypes");
  const ws = new FakeSocket();
  join(room, ws, "wire-a");
  ok("(setup) still on the built-in", room.run?.game.id === waveDefence().id);

  const his = {
    id: "shakedown", name: "Shakedown", place: "earth", crew: "multiplayer",
    published: true,
    rounds: [{ seconds: 90, spawns: [{ enemy: "fighters", count: 6, arrive: "spread" }] }],
  };
  const real = globalThis.fetch;
  globalThis.fetch = (async (url: string) => ({
    ok: true,
    status: 200,
    json: async () => {
      const u = String(url);
      if (u.includes("rebels_games")) return [{ game: his }];
      if (u.includes("rebels_enemies")) return [];
      return [];                              /* the drop charts: fall back */
    },
  })) as never;
  try {
    await room.refreshDrops();
  } finally {
    globalThis.fetch = real;
  }

  ok("refreshDrops actually adopts the game, with nobody calling the fix",
     room.run?.game.id === "shakedown", room.run?.game.id);
  ok("and the games really did come through it", room.games.length === 1 && room.gamesLive === true,
     `${room.games.length} games, live ${room.gamesLive}`);
  room.stop();
}


/* ================= AN EXEMPT GAME IS STILL A RICH GAME =================
   The ceiling has an exemption: the built-in is never refused, because
   refusing the FALLBACK condemns every game in the room and leaves nothing to
   fall back to. That is right. But an exemption is a bound that covers less
   than it appears to, which is the shape of every fault found this week.

   The case it leaves: somebody lowers GAME_MAX_PAYOUT because the treasury
   cannot pay what is promised. Authored games are refused, correctly. Wave
   Defence carries on paying 5,850 to everybody, silently, being exempt - the
   ceiling failing at the moment it was tightened, on the one game nobody chose
   and everybody plays.

   It must not be refused. It must not be quiet either. */
{
  storage.clear();
  const room = newRoom();
  room.setDropsForTests(null, () => 0.99);
  const ws = new FakeSocket();
  join(room, ws, "ceil-a");

  const state = async () => {
    const r = await room.fetch(new Request("https://x/room/earth/state"));
    return r.json() as Promise<Record<string, number | boolean | string>>;
  };

  const s1 = await state();
  ok("the state says what a clear of the running game credits",
     typeof s1.credits === "number" && (s1.credits as number) > 0, `${s1.credits}`);

  /* The built-in, which is the richest game there is. */
  ok("and for the built-in that is the 5,850 the cashout doc derived separately",
     s1.credits === 5850, `${s1.credits}`);
  ok("which is under today's ceiling, so nothing is flagged",
     s1.overCeiling === undefined && 5850 < GAME_MAX_PAYOUT,
     `${s1.credits} of ${GAME_MAX_PAYOUT}`);

  /* ---- AND WHEN IT IS NOT UNDER ----
     Staged with a game rich enough to pass the ceiling rather than by pretending
     the constant is different, because the constant is what ships. */
  room.games = [{
    id: "goldmine", name: "Goldmine", place: "earth", crew: "multiplayer",
    published: true,
    /* Six rounds of a full sky. 6 x 400 x COIN_PER_KILL 5 = 12,000, which is
       over the ceiling using nothing but built-in enemies and legal counts -
       the point being that this takes no exotic content at all. */
    rounds: Array.from({ length: 6 }, () => ({
      seconds: 60, spawns: [{ enemy: "tier7", count: 400, arrive: "spread" as const }],
    })),
  }];
  room.adoptedStartupGame = false;
  room.adoptStartupGame();
  const s2 = await state();
  ok("(setup) the room is running the rich game", s2.game === "goldmine", `${s2.game}`);
  ok("a game over the ceiling is FLAGGED rather than hidden",
     s2.overCeiling === true, JSON.stringify(s2));
  ok("and the number is there to act on, not just a flag",
     (s2.credits as number) > GAME_MAX_PAYOUT,
     `${s2.credits} over ${GAME_MAX_PAYOUT}`);
  room.stop();
}

// THE SKY HAS A CEILING.
//
// An endless game never stops asking, survivors roll from one round into the
// next by design, and an enemy that keeps chasing a player is never culled for
// being far away. So the thing that bounded the sky was the game ending, and
// the built-in game no longer ends.
//
// Measured before this was written, with one player who survived and killed
// nothing: 205 alive at round 11, 1,580 at round 36, climbing by about 38 a
// minute with no limit in sight, and the room's cost per tick climbing with it.
// This is the ceiling, and these tests are about where it bites and where it
// must not.
{
  const room = newRoom();
  const ws = new FakeSocket();
  join(room, ws, "node-cap", home);
  const spawner = room.spawner();
  const sky = () => room.combat.enemies.length;

  /* Where it must NOT bite: an ordinary round in an ordinary sky. */
  spawner.spawn("tier1", 10);
  ok("a normal round arrives in full", sky() === 10, `${sky()} in the sky`);

  /* Filled to just under the ceiling with real fighters rather than with a
     pretend list, so what is counted is what the room would actually be
     flying. */
  const mark = room.world.players[0];
  while (sky() < LIVE_MAX_ENEMIES - 5) {
    spawnFighter(room.combat, mark.pos, mark.fwd, { tier: 1 });
  }
  ok("(setup) five places left", sky() === LIVE_MAX_ENEMIES - 5, `${sky()}`);

  /* A round asking for fifty gets the five that are left and stops there,
     rather than stepping over the ceiling by forty-five. */
  spawner.spawn("tier1", 50);
  ok("a round asking for more than there is room for stops AT the ceiling",
     sky() === LIVE_MAX_ENEMIES, `${sky()} of ${LIVE_MAX_ENEMIES}`);

  /* And then nothing more arrives at all, however long the game goes on. */
  spawner.spawn("tier1", 50);
  spawner.spawn("fighters", 50);
  spawner.spawn("flock", 3);
  ok("a full sky takes nothing more, fighters or flocks",
     sky() === LIVE_MAX_ENEMIES, `${sky()} of ${LIVE_MAX_ENEMIES}`);

  /* ⚠ THE CEILING MUST NOT BE A ONE-WAY DOOR. A cap that stopped spawning for
     good would empty the sky for the rest of a six-hour run the moment a
     player cleared it. Killing makes room, immediately. */
  room.combat.enemies.splice(0, 100);
  spawner.spawn("tier1", 40);
  ok("killing makes room again", sky() === LIVE_MAX_ENEMIES - 60,
     `${sky()} of ${LIVE_MAX_ENEMIES}`);

  /* ⚠ AND IT SAYS SO. A sky that has stopped filling looks exactly like a
     round that asked for nothing, and that is the whole question when somebody
     reports an endless game going quiet. Same argument as overCeiling: the cap
     must not be refused, and it must not be silent either. */
  const capped = await room.fetch(new Request("https://r/room/earth/state"))
    .then((r: Response) => r.json() as Promise<Record<string, unknown>>);
  ok("the state page says the ceiling has been refusing arrivals",
     typeof capped.skyRefused === "number" && (capped.skyRefused as number) > 0,
     `${capped.skyRefused} refused`);
  room.stop();

  /* And an ordinary room says nothing at all, so the field appearing MEANS
     something. */
  const quiet = newRoom();
  const qws = new FakeSocket();
  join(quiet, qws, "node-quiet", home);
  quiet.spawner().spawn("tier1", 10);
  const fine = await quiet.fetch(new Request("https://r/room/earth/state"))
    .then((r: Response) => r.json() as Promise<Record<string, unknown>>);
  ok("a room under the ceiling says nothing about it",
     fine.skyRefused === undefined, JSON.stringify(fine));
  quiet.stop();
}

console.log(out.join("\n"));
console.log(`\n${out.length - failures} passed, ${failures} failed`);
if (failures > 0) process.exit(1);
