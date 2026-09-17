// Does the fight in Earth orbit stop when the last pilot leaves for Spikeworld?
//
// Geoff: "don't do waves for players that have gone to Spikeworld. That's a
// separate game, so don't continue launching waves of enemies back around earth
// if there's no players there to fight them. If a player goes to spikeworld then
// it's like the game is over for them because they're in another game, which
// means the game ends back on earth UNLESS another player is there to keep it
// alive."
//
// It already worked that way, and this is here so it keeps working. The chain
// is short: going out there sends `away`, which clears the seat's `flying`; the
// roster counts only seats that are flying and alive; and the tick returns
// before the fight is stepped at all when that roster is empty. So no wave
// arrives, nothing already in the air moves, and the fight is reset to wave one
// for whoever comes back. With somebody else still in orbit the roster is not
// empty and none of that happens.
//
// Run: sh scripts/run-rebels-waves-tests.sh
export {};
import { RebelsRoom } from "../src/room";
const storage = {
  map: new Map<string, unknown>(),
  async get(k: string) { return this.map.get(k); },
  async put(k: string, v: unknown) { this.map.set(k, v); },
  async delete(k: string) { return this.map.delete(k); },
  async list() { return new Map(); },
};
const env = { ROOM: null, LEDGER: { idFromName: () => "id", get: () => ({ fetch: async () => Response.json({ divi: 0, claimable: 0, paid: 0, pending: null, last: null }) }) } } as never;
(globalThis as Record<string, unknown>).fetch = () => Promise.reject(new Error("offline"));
function fakeSocket() {
  const handlers: Record<string, ((e: unknown) => void)[]> = {};
  return {
    accept() {}, addEventListener(k: string, fn: (e: unknown) => void) { (handlers[k] ??= []).push(fn); },
    send() {}, close() {},
    tell(msg: unknown) { for (const fn of handlers.message ?? []) fn({ data: JSON.stringify(msg) }); },
  };
}
const room = new RebelsRoom({ storage } as never, env) as never as {
  seat(ws: unknown, from?: string): void; step(): void; stop(): void;
  combat: { enemies: unknown[]; wave: { n?: number } | null };
};
const a = fakeSocket();
room.seat(a as never, "one");
room.stop();
a.tell({ t: "join", node: "n1", name: "One", home: [0, 0, 100] });
a.tell({ t: "fly" });
for (let i = 0; i < 20 * 40; i++) { a.tell({ t: "tf", p: [0, 0, 120], f: [0, 0, 1] }); room.step(); }
const out: string[] = [];
let failures = 0;
function ok(name: string, cond: boolean, extra = ""): void {
  if (!cond) failures++;
  out.push(`${cond ? "PASS" : "FAIL"} ${name}${extra ? `  [${extra}]` : ""}`);
}
const alone = room.combat.enemies.length;
ok("a pilot flying in Earth orbit gets a wave", alone > 0, `${alone} enemies`);
a.tell({ t: "away" });
for (let i = 0; i < 20 * 60; i++) room.step();
ok("and a minute after they leave for Spikeworld the sky is empty",
   room.combat.enemies.length === 0, `${room.combat.enemies.length} enemies`);
/* And with a second pilot still in Earth orbit, the fight must carry on. */
const b = fakeSocket();
room.seat(b as never, "two");
room.stop();
b.tell({ t: "join", node: "n2", name: "Two", home: [0, 0, 100] });
b.tell({ t: "fly" });
for (let i = 0; i < 20 * 40; i++) { b.tell({ t: "tf", p: [0, 0, 120], f: [0, 0, 1] }); room.step(); }
ok("a second pilot starts it again", room.combat.enemies.length > 0,
   `${room.combat.enemies.length} enemies`);
a.tell({ t: "away" });
for (let i = 0; i < 20 * 30; i++) { b.tell({ t: "tf", p: [0, 0, 120], f: [0, 0, 1] }); room.step(); }
ok("and one of two leaving does NOT end it for the other",
   room.combat.enemies.length > 0, `${room.combat.enemies.length} enemies`);
console.log(out.join("\n"));
console.log(`\n${out.length - failures} passed, ${failures} failed`);
if (failures > 0) process.exit(1);
