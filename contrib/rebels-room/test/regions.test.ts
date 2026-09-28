// Spikeworld as a SECOND REGION: is it really a room, and is the heart shared?
//
// Geoff: "for spikeworld, make it multiplayer now as a second region."
//
// A region is a room, so the questions are the room's questions. Does the
// Spikeworld room refuse to run Earth's game (no waves)? Does it run its own
// (the heart's guards)? And, the one that decides whether this is multiplayer
// at all: when two pilots shoot the heart, are they wearing down ONE million
// between them, or a million each?
//
// Run: sh scripts/run-rebels-regions-tests.sh
export {};
import { RebelsRoom } from "../src/room";
import {
  regionOf, roomNameOk, nextRoom, parseRoom, roomNameOf, gameOf, ROOM_OVERFLOW_MAX,
} from "../src/protocol";
import { HEART_HP, R_OUTER, R_INNER, R_HEART, ARRIVAL_OUT, toWorld } from "../../../ui/src/wallet/rebels/voxel/voxelWorld";

const out: string[] = [];
let failures = 0;
function ok(name: string, cond: boolean, extra = ""): void {
  if (!cond) failures++;
  out.push(`${cond ? "PASS" : "FAIL"} ${name}${extra ? `  [${extra}]` : ""}`);
}

/* ================= THE NAMES ================= */
ok("spike is a room that may exist", roomNameOk("spike"));
ok("and it overflows like earth does", roomNameOk("spike-2") && nextRoom("spike") === "spike-2",
   nextRoom("spike"));
ok("earth still overflows into earth", nextRoom("earth") === "earth-2", nextRoom("earth"));
ok("the two regions do not overflow into each other",
   nextRoom("earth-2") === "earth-3" && nextRoom("spike-2") === "spike-3");
ok("a name is read as exactly one region",
   regionOf("spike-7") === "spike" && regionOf("earth-7") === "earth" && regionOf("spoke") === null);
ok("and an invented room is still refused", !roomNameOk("spike-99") && !roomNameOk("spikeworld"));

/* ================= A ROOM, FOR TESTING ================= */
function storage() {
  const map = new Map<string, unknown>();
  return {
    map,
    async get(k: string) { return map.get(k); },
    async put(k: string, v: unknown) { map.set(k, v); },
    async delete(k: string) { return map.delete(k); },
    async list() { return new Map(); },
  };
}
const env = {
  ROOM: null,
  LEDGER: { idFromName: () => "id", get: () => ({ fetch: async () => Response.json({ divi: 0, claimable: 0, paid: 0, pending: null, last: null }) }) },
} as never;
(globalThis as Record<string, unknown>).fetch = () => Promise.reject(new Error("offline"));

function fakeSocket() {
  const handlers: Record<string, ((e: unknown) => void)[]> = {};
  const sent: string[] = [];
  return {
    sent,
    accept() {}, addEventListener(k: string, fn: (e: unknown) => void) { (handlers[k] ??= []).push(fn); },
    send(text: string) { sent.push(text); }, close() {},
    tell(msg: unknown) { for (const fn of handlers.message ?? []) fn({ data: JSON.stringify(msg) }); },
    lastState(): Record<string, unknown> | null {
      for (let i = sent.length - 1; i >= 0; i--) {
        const m = JSON.parse(sent[i]) as Record<string, unknown>;
        if (m.t === "s") return m;
      }
      return null;
    },
  };
}

type Testable = {
  fetch(req: Request): Promise<Response>;
  seat(ws: unknown, from?: string): void;
  step(): void;
  stop(): void;
  combat: { enemies: Array<{ drone?: boolean }>; wave: { n?: number } | null; flockClock: number; dragonClock: number };
  heartHp: number;
};

/** A room of a given name, with the name actually read the way the worker
 *  reads it: through fetch, which is the only place the region is decided. */
async function makeRoom(name: string): Promise<Testable> {
  const r = new RebelsRoom({ storage: storage() } as never, env) as never as Testable;
  await r.fetch(new Request(`https://x/room/${name}/state`));
  return r;
}

function join(room: Testable, sock: ReturnType<typeof fakeSocket>, id: string, home: number[]) {
  room.seat(sock as never, id);
  room.stop();
  sock.tell({ t: "join", node: `n-${id}`, name: id, home });
  sock.tell({ t: "fly" });
}

/**
 * FLY there; do not appear there.
 *
 * The room refuses a report further from the last one than the ship could have
 * covered, and it is right to: that check is what stops a client teleporting
 * onto somebody's tail. So a test that wants a ship somewhere has to take it
 * there, a report at a time, the same as a pilot would.
 */
function flyTo(
  room: Testable, sock: ReturnType<typeof fakeSocket>,
  from: [number, number, number], to: [number, number, number],
  fwd: [number, number, number],
): [number, number, number] {
  /* Comfortably inside any ship's budget, which is its top speed times the
     time since its last accepted report. A slower ship than this one is not a
     thing the game has; a bigger step than this is refused as a teleport, and
     being refused silently is exactly how the first version of this test
     "proved" the guards never woke. */
  const STEP = 15;
  const d = [to[0] - from[0], to[1] - from[1], to[2] - from[2]];
  const far = Math.hypot(d[0], d[1], d[2]);
  const steps = Math.max(1, Math.ceil(far / STEP));
  let at = from;
  for (let i = 1; i <= steps; i++) {
    at = [from[0] + d[0] * i / steps, from[1] + d[1] * i / steps, from[2] + d[2] * i / steps];
    sock.tell({ t: "tf", p: at, f: fwd });
    room.step();
  }
  return at;
}

/* ================= EARTH STILL GETS ITS WAVES ================= */
{
  const room = await makeRoom("earth");
  const a = fakeSocket();
  join(room, a, "one", [0, 0, 100]);
  for (let i = 0; i < 20 * 40; i++) { a.tell({ t: "tf", p: [0, 0, 120], f: [0, 0, 1] }); room.step(); }
  ok("Earth's room still runs Earth's game", room.combat.enemies.length > 0,
     `${room.combat.enemies.length} enemies, wave ${room.combat.wave?.n ?? 0}`);
}

/* ================= SPIKEWORLD DOES NOT ================= */
/* Far outside the cavity, so nothing should wake: the guards are the heart's
   answer to being approached, and nothing else out here spawns at all. */
{
  const room = await makeRoom("spike");
  const a = fakeSocket();
  const outside = toWorld(R_OUTER + ARRIVAL_OUT);
  join(room, a, "one", [0, 0, outside]);
  for (let i = 0; i < 20 * 90; i++) { a.tell({ t: "tf", p: [0, 0, outside], f: [0, 0, -1] }); room.step(); }
  ok("no Earth wave ever starts in Spikeworld", room.combat.wave === null,
     `wave ${JSON.stringify(room.combat.wave)}`);
  ok("and nothing is in the sky while nobody is inside it",
     room.combat.enemies.length === 0, `${room.combat.enemies.length} enemies`);
  /* ---- AND THE REASON, not just the outcome ----
     The simulation rolls for a natural swarm every five seconds at one percent
     and for the dragon every minute, neither of which owes anything to a wave.
     Left running they put the occasional yellow tier-one flock inside a hollow
     world whose whole population is meant to be the heart's sixty. Catching
     that by counting enemies catches it about one run in six, which is a test
     that reports a real bug as flakiness; the clocks themselves are the fact. */
  const clocks = room.combat as unknown as { flockClock: number; dragonClock: number };
  ok("Earth's own spawners are held, not merely lucky",
     clocks.flockClock < -1000 && clocks.dragonClock < -1000,
     `flock ${Math.round(clocks.flockClock)}, dragon ${Math.round(clocks.dragonClock)}`);
  ok("its arrival point is well inside what the wire will carry",
     outside < 1e5, `${Math.round(outside)} units from the heart`);
}

/* ================= THE HEART SENDS ITS GUARDS ================= */
{
  const room = await makeRoom("spike");
  const a = fakeSocket();
  /* Inside the cavity, which is the inner face of the shell with margin. */
  const inside = toWorld(R_INNER - 200);
  const start = toWorld(R_OUTER + ARRIVAL_OUT);
  join(room, a, "one", [0, 0, start]);
  flyTo(room, a, [0, 0, start], [0, 0, inside], [0, 0, -1]);
  for (let i = 0; i < 20; i++) { a.tell({ t: "tf", p: [0, 0, inside], f: [0, 0, -1] }); room.step(); }
  const guards = room.combat.enemies.filter((e) => e.drone).length;
  ok("crossing into the cavity wakes the heart's guards", guards > 0, `${guards} guards`);
  ok("and it is a flock, not a patrol", guards >= 40, `${guards}`);
}

/* ================= ONE MILLION, BETWEEN EVERYBODY ================= */
{
  const room = await makeRoom("spike");
  const a = fakeSocket();
  const b = fakeSocket();
  const at = toWorld(R_HEART) + 60;      /* just off the heart's surface */
  const start = toWorld(R_OUTER + ARRIVAL_OUT);
  join(room, a, "one", [0, 0, start]);
  join(room, b, "two", [0, 0, start]);
  ok("the heart starts at a million", room.heartHp === HEART_HP, `${room.heartHp}`);

  /* Both of them flown down to the heart, from opposite sides. */
  flyTo(room, a, [0, 0, start], [0, 0, at], [0, 0, -1]);
  flyTo(room, b, [0, 0, start], [at, 0, 0], [-1, 0, 0]);

  /* And firing into it. */
  for (let i = 0; i < 20 * 6; i++) {
    a.tell({ t: "tf", p: [0, 0, at], f: [0, 0, -1] });
    b.tell({ t: "tf", p: [at, 0, 0], f: [-1, 0, 0] });
    a.tell({ t: "fire", k: "main", p: [0, 0, at], f: [0, 0, -1] });
    b.tell({ t: "fire", k: "main", p: [at, 0, 0], f: [-1, 0, 0] });
    room.step();
  }
  const took = HEART_HP - room.heartHp;
  ok("shooting it counts the million down", took > 0, `${Math.round(took)} taken`);

  /* THE WHOLE POINT. Both pilots are firing into the same sphere, so what
     each of them sees left is what the other sees left. If the heart were per
     cockpit this number would differ between the two state messages. */
  const sa = a.lastState();
  const sb = b.lastState();
  ok("both cockpits are told the heart's health", typeof sa?.hp === "number" && typeof sb?.hp === "number",
     `${JSON.stringify(sa?.hp)} / ${JSON.stringify(sb?.hp)}`);
  ok("and it is the SAME million, not one each", sa?.hp === sb?.hp,
     `${sa?.hp} against ${sb?.hp}`);
  ok("which is the room's own number", sa?.hp === Math.round(room.heartHp),
     `${sa?.hp} against ${Math.round(room.heartHp)}`);
}

/* ================= EARTH'S ROOM HAS NO HEART ================= */
{
  const room = await makeRoom("earth");
  const a = fakeSocket();
  join(room, a, "one", [0, 0, 100]);
  for (let i = 0; i < 20; i++) { a.tell({ t: "tf", p: [0, 0, 120], f: [0, 0, 1] }); room.step(); }
  ok("no heart is sent to a cockpit in Earth orbit", a.lastState()?.hp === undefined,
     JSON.stringify(a.lastState()?.hp));
}

/* ================= THE HEART SURVIVES THE ROOM SLEEPING ================= */
{
  const keep = storage();
  const first = new RebelsRoom({ storage: keep } as never, env) as never as Testable;
  await first.fetch(new Request("https://x/room/spike/state"));
  const a = fakeSocket();
  const at = toWorld(R_HEART) + 60;
  const start = toWorld(R_OUTER + ARRIVAL_OUT);
  join(first, a, "one", [0, 0, start]);
  flyTo(first, a, [0, 0, start], [0, 0, at], [0, 0, -1]);
  for (let i = 0; i < 20 * 20; i++) {
    a.tell({ t: "tf", p: [0, 0, at], f: [0, 0, -1] });
    a.tell({ t: "fire", k: "main", p: [0, 0, at], f: [0, 0, -1] });
    first.step();
  }
  const worn = first.heartHp;
  await new Promise((r) => setTimeout(r, 30));
  const again = new RebelsRoom({ storage: keep } as never, env) as never as Testable;
  await again.fetch(new Request("https://x/room/spike/state"));
  const b = fakeSocket();
  join(again, b, "two", [0, 0, toWorld(R_OUTER + ARRIVAL_OUT)]);
  again.step();
  await new Promise((r) => setTimeout(r, 30));
  ok("damage done is still done after the room goes to sleep",
     again.heartHp < HEART_HP && Math.abs(again.heartHp - worn) < 2001,
     `${Math.round(worn)} before, ${Math.round(again.heartHp)} after`);
}


/* ================= A ROOM NAME CARRIES ITS GAME =================
   ⚠ THERE WERE FOUR COPIES OF THIS RULE and they disagreed. The cockpit's
   (regionOfRoom in rebelsRegions.ts) had no game suffix, so "spike_descent"
   parsed as EARTH: the cockpit would subtract Earth's origin instead of
   Spikeworld's, every position it reported would be two hundred thousand units
   out, the room would refuse them all as outside the world, and the player
   would be snapped back for ever with nothing logged anywhere.

   parseRoom is now the one reader and everything else calls it. These tests are
   what stop it drifting again. */
{
  const p = (n: string) => parseRoom(n);

  ok("a plain place is itself, first room, its own game",
     p("earth")?.region === "earth" && p("earth")?.overflow === 1 && p("earth")?.game === null);
  ok("an overflow room keeps its number",
     p("earth-2")?.overflow === 2 && p("earth-2")?.game === null);

  /* ---- THE ONE THAT WAS WRONG ---- */
  ok("a Spikeworld game room is SPIKEWORLD, not Earth",
     p("spike_descent")?.region === "spike", `${p("spike_descent")?.region}`);
  ok("and it knows which game it is", p("spike_descent")?.game === "descent");

  ok("a game room in an overflow copy is all three at once",
     p("spike-3_descent")?.region === "spike"
     && p("spike-3_descent")?.overflow === 3
     && p("spike-3_descent")?.game === "descent",
     JSON.stringify(p("spike-3_descent")));

  ok("and regionOf agrees with it, because it IS it",
     regionOf("spike-3_descent") === "spike" && regionOf("earth_shakedown") === "earth");
  ok("gameOf reads the game out", gameOf("earth_shakedown") === "shakedown" && gameOf("earth") === null);

  /* ---- THE DOOR MUST LET THEM IN ----
     roomNameOk is what the worker checks before routing. A name it refuses is
     a 404, so a game room that does not pass here cannot be joined at all. */
  ok("a game room is a room the door opens",
     roomNameOk("earth_shakedown") && roomNameOk("spike-3_descent"));

  /* ---- AND NONSENSE IS STILL NONSENSE ---- */
  for (const bad of ["earth_", "_shakedown", "earth-99_x", "mars_thing", "earth-1_x",
                     "earth_Shakedown", "earth__x", "earth-2-3"]) {
    ok(`"${bad}" is not a room`, p(bad) === null, JSON.stringify(p(bad)));
  }

  /* ---- ROUND TRIP ----
     parseRoom and roomNameOf are inverses, which is what stops one of them
     drifting from the other the way the four copies did. */
  for (const name of ["earth", "spike", "earth-2", "spike-14", "earth_shakedown",
                      "spike-3_descent", "earth-2_night-run"]) {
    const r = parseRoom(name);
    ok(`"${name}" survives a round trip`, !!r && roomNameOf(r) === name,
       r ? roomNameOf(r) : "unparsed");
  }

  /* ---- A FULL ROOM SENDS THEM ON WITH THEIR GAME ----
     Being pushed out of a full earth_shakedown into plain earth-2 would be a
     different game entirely, and would look like the room changing for no
     reason. */
  ok("the hop out of a full game room keeps the game",
     nextRoom("earth_shakedown") === "earth-2_shakedown", nextRoom("earth_shakedown"));
  ok("and out of an overflow game room too",
     nextRoom("earth-2_shakedown") === "earth-3_shakedown", nextRoom("earth-2_shakedown"));
  ok("a plain room still hops the way it always did",
     nextRoom("earth") === "earth-2" && nextRoom("spike-2") === "spike-3");
  ok("and the last room has nowhere to send anybody",
     nextRoom(`earth-${ROOM_OVERFLOW_MAX}_shakedown`) === "",
     nextRoom(`earth-${ROOM_OVERFLOW_MAX}_shakedown`));
}

console.log(out.join("\n"));
console.log(`\n${out.length - failures} passed, ${failures} failed`);
if (failures > 0) process.exit(1);
