// DFlow: the collector adds up, catches stalls with their breakdown, and
// writes a report a person can read and a script can parse.
import { newDflowForTests, STAGES, STALL_MS } from "./rebelsDflow";

const out: string[] = [];
let failures = 0;
function ok(name: string, cond: boolean, extra = "") {
  if (!cond) failures++;
  out.push(`${cond ? "PASS" : "FAIL"} ${name}${extra ? `  [${extra}]` : ""}`);
}

{
  const d = newDflowForTests();
  /* Sixty ordinary frames of 16ms with a little of our work in each. */
  for (let i = 0; i < 60; i++) {
    d.frameStart(0.016);
    d.add("flight", 0.2);
    d.add("combat", 0.5);
    d.add("draw.drones", 0.3);
    d.counts({ enemies: 5, drones: 24, bullets: 10 });
    d.render({ calls: 300, triangles: 50000, programs: 12, ratio: 1 });
    d.frameEnd();
  }
  const live = d.live();
  ok("frames are counted", live.frames === 60, `${live.frames}`);
  ok("the frame time is what the browser gave", Math.abs(live.dtAvg - 16) < 0.5, `${live.dtAvg}`);
  ok("and fps follows from it", Math.abs(live.fps - 62.5) < 1, `${live.fps}`);
  ok("the biggest stage is on top", live.top[0]?.[0] === "combat" && Math.abs(live.top[0][1] - 0.5) < 1e-6, JSON.stringify(live.top));
  ok("counts are carried", live.counts.drones === 24 && live.counts.enemies === 5);
  ok("no stalls in a smooth run", live.stalls === 0);

  /* A stall with our code in it, then one with nothing of ours. */
  d.frameStart(0.120);
  d.add("meshes", 95);
  d.frameEnd();
  d.frameStart(0.080);
  d.add("flight", 0.2);
  d.frameEnd();
  const after = d.live();
  ok("stalls are counted", after.stalls === 2, `${after.stalls}`);
  const rep = d.report();
  ok("the report names the stall's stage", rep.includes("meshes 95.0") && rep.includes("in our code"), rep.split("\n").find((l) => l.includes("meshes 95")) ?? "");
  ok("and blames the browser when it was not us", rep.includes("outside our code"));
  ok("worst first", rep.indexOf("120ms") < rep.indexOf(" 80ms"));

  /* A shader compile is noticed from the program count. */
  d.frameStart(0.016); d.render({ programs: 13 }); d.frameEnd();
  ok("a new program is a note", d.live().compiles === 1 && d.report().includes("shader compiled (+1, now 13)"));

  /* A flock arriving is a note. */
  d.frameStart(0.016); d.counts({ drones: 48 }); d.frameEnd();
  ok("a jump in drones is a note", d.report().includes("flock arrived: drones 24 -> 48"));

  /* Room traffic and status. */
  d.net(1200, 1200); d.net(300); d.room("live");
  d.frameStart(0.016); d.frameEnd();
  const r2 = d.report();
  ok("messages and bytes are totted up", r2.includes("messages 2, bytes 1500") && r2.includes("last state message 1200 bytes"));
  ok("a status change is a note", r2.includes("room: off -> live"));

  /* The raw table has one column per stage and per count, in the order named. */
  const header = r2.split("\n").find((l) => l.trim().startsWith("t,frames,dtAvg"))!;
  ok("the raw table header lists every stage", STAGES.every((s) => header.includes(s)));
  ok("sections a person looks for are there", ["FRAME TIME", "WHERE OUR TIME GOES", "WHAT WAS IN THE SKY", "RENDERER", "ROOM", "AUDIO", "WORST FRAMES", "NOTES", "RAW"].every((s) => r2.includes(s)));
  ok("the stall line is forty milliseconds", STALL_MS === 40);

  /* Reset wipes it. */
  d.reset();
  ok("reset starts over", d.live().frames === 0 && d.live().stalls === 0);
  ok("time() files the work under its stage", (() => { d.frameStart(0.016); const v = d.time("hud", () => 7); d.frameEnd(); return v === 7 && d.report().includes("hud"); })());
}

console.log(out.join("\n"));
console.log(`${out.filter((l) => l.startsWith("PASS")).length} passed, ${failures} failed`);
if (failures > 0) process.exit(1);
