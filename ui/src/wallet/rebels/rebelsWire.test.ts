// The shared row layouts (rebelsWire.ts): packing, unpacking, and agreement with
// the code installed clients still run.
//
// Run: sh scripts/run-rebels-wire-codec-tests.sh

import { readFileSync } from "node:fs";
import * as W from "./rebelsWire";

const out: string[] = [];
let failures = 0;
function ok(name: string, cond: boolean, extra = "") {
  if (!cond) failures++;
  out.push(`${cond ? "PASS" : "FAIL"} ${name}${extra ? `  [${extra}]` : ""}`);
}
const vec = (x: number, y: number, z: number) => ({ x, y, z });
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/* ---- the unpacking installed apps and open pages still run ----
   Copied VERBATIM (vectors as plain objects) from rebelsRoom.ts as it was at
   commit 1e8ccbd, before rebelsWire.ts existed. The new unpacking must read every
   recorded row exactly as this does. */
const legacy = {
  P: (row: any[]) => ({ id: row[0], pos: vec(row[1], row[2], row[3]), fwd: vec(row[4], row[5], row[6]), guard: row[7] === 1, shield: row[8] }),
  E: (e: any[]) => ({ pos: vec(e[0], e[1], e[2]), fwd: vec(e[3], e[4], e[5]), tier: e[6], shield: e[7], shieldMax: e[8], drone: e[9] === 1, dragon: e[9] === 2, id: e[10] || 0 }),
  F: (f: any[]) => ({ id: f[0], pos: vec(f[1], f[2], f[3]), vel: vec(f[4], f[5], f[6]), hostile: (f[7] & 1) !== 0, mini: (f[7] & 2) !== 0, orb: (f[7] & 4) !== 0, life: f[8] }),
  J: (j: any[]) => ({ pos: vec(j[0], j[1], j[2]), rot: vec(j[3], j[4], j[5]), kind: j[6] === 1 ? "wingL" : j[6] === 2 ? "wingR" : "body" }),
  W: (v: any[]) => ({ owner: String(v[0]), slot: Number(v[1]) || 0, pos: vec(v[2], v[3], v[4]), hull: Number(v[5]) || 0, hullMax: Number(v[6]) || 1, tier: Number(v[7]) || 1 }),
  T: (t: any[]) => ({ pos: vec(t[0], t[1], t[2]), vel: vec(t[3], t[4], t[5]) }),
  C: (k: any[]) => ({ pos: vec(k[0], k[1], k[2]) }),
  M: (b: any[]) => ({ pos: vec(b[0], b[1], b[2]), fwd: vec(b[3], b[4], b[5]), key: String(b[6]), life: Number(b[7]) || 0 }),
  G: (g: any[]) => ({ id: String(g[5]), tier: Number(g[3]) || 1, pos: vec(g[0], g[1], g[2]), spin: Number(g[4]) || 0,
    ...(g[6] ? { item: String(g[6]), owner: String(g[7] ?? ""), hidden: Number(g[8]) || 0 } : {}) }),
};
const now = {
  P: (r: any) => W.unpackPlayer(r, vec), E: (r: any) => W.unpackEnemy(r, vec), F: (r: any) => W.unpackShot(r, vec),
  J: (r: any) => W.unpackJunk(r, vec), W: (r: any) => W.unpackWing(r, vec), T: (r: any) => W.unpackTorpedo(r, vec),
  C: (r: any) => W.unpackCoin(r, vec), M: (r: any) => ({ ...W.unpackBeam(r, vec) }), G: (r: any) => W.unpackGem(r, vec),
};

{
  const states = JSON.parse(readFileSync(`${process.cwd()}/../contrib/rebels-room/test/golden/wire-state-v1.json`, "utf8")) as string[];
  const counts: Record<string, number> = {};
  let mismatch = "";
  for (const text of states) {
    const m = JSON.parse(text) as Record<string, any[]>;
    for (const k of Object.keys(legacy) as Array<keyof typeof legacy>) {
      for (const row of m[k] ?? []) {
        counts[k] = (counts[k] ?? 0) + 1;
        const a = legacy[k](row), b = now[k](row);
        if (!mismatch && !same(a, b)) mismatch = `${k}: ${JSON.stringify(a)} vs ${JSON.stringify(b)}`;
      }
    }
  }
  ok("every recorded row is unpacked exactly as installed clients unpack it", mismatch === "", mismatch);
  ok("and every kind was checked", Object.keys(legacy).every((k) => (counts[k] ?? 0) > 0), JSON.stringify(counts));
}

/* ---- packing: the layout, written out ---- */
{
  ok("a ship", same(W.packPlayer("s1", vec(1.26, -2.34, 3.35), vec(0.07, 0.99, -0.04), true, 199.6), ["s1", 1.3, -2.3, 3.4, 0.1, 1, -0, 1, 200]));
  ok("an enemy, a dragon", same(W.packEnemy(vec(10.04, 0, 0), vec(0, 1, 0), 7, -3, 2000, { dragon: true }, 12), [10, 0, 0, 0, 1, 0, 7, 0, 2000, 2, 12]));
  ok("an enemy without an id", same(W.packEnemy(vec(0, 0, 0), vec(0, 0, 1), 1, 50.4, 60, { drone: true }, undefined).slice(9), [1, 0]));
  ok("a shot's flags", same(W.packShot(5, vec(0, 0, 0), vec(0, 240, 0), { hostile: true, orb: true }, 1.23456), [5, 0, 0, 0, 0, 240, 0, 5, 1.23]));
  ok("wreckage turns to a hundredth and knows its wing", same(W.packJunk(vec(0, 0, 0), vec(0.12345, 1.23456, -2.34567), "wingR"), [0, 0, 0, 0.12, 1.23, -2.35, 2]));
  ok("a beam points to a thousandth", same(W.packBeam(vec(0, 0, 0), vec(0.12345, 0.98765, -0.0999), "beam1", 0.4567), [0, 0, 0, 0.123, 0.988, -0.1, "beam1", 0.5]));
  ok("a plain gem has six fields", W.packGem(vec(0, 0, 0), 3, 1.234, "g1").length === 6);
  ok("an item drop has nine", same(W.packGem(vec(0, 0, 0), 2, 0, "g2", { key: "strafe2", owner: "s2", hidden: 59.6 }).slice(6), ["strafe2", "s2", 60]));
  ok("a wingman", same(W.packWing("s1", 3, vec(1, 2, 3), 1400.4, 1600, 3), ["s1", 3, 1, 2, 3, 1400, 1600, 3]));
}

/* ---- round trips ---- */
{
  const s = W.unpackShot(W.packShot(9, vec(1, 2, 3), vec(4, 5, 6), { mini: true }, 0.5), vec);
  ok("a shot survives the wire", s.id === 9 && s.mini && !s.hostile && !s.orb && s.life === 0.5 && s.vel.y === 5);
  const g = W.unpackGem(W.packGem(vec(1, 2, 3), 4, 0.25, "gx", { key: "hull3", owner: "s9", hidden: 12 }), vec);
  ok("an item drop survives the wire", g.item === "hull3" && g.owner === "s9" && g.hidden === 12 && g.tier === 4);
  const plain = W.unpackGem(W.packGem(vec(1, 2, 3), 4, 0.25, "gy"), vec);
  ok("a plain gem comes back with no item", !("item" in plain));
}

console.log(out.join("\n"));
console.log(`\n${out.length - failures} passed, ${failures} failed`);
if (failures > 0) process.exit(1);
