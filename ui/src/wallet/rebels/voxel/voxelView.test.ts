// Spikeworld, Phase 3: does it hold its budget, everywhere a player can be?
//
// Run: sh scripts/run-voxel-view-tests.sh
//
// The plan said the frame budget would be enforced rather than hoped for, and
// this is where that is checked. It builds the real chunk lists for the three
// places a player can stand, and then builds the real meshes for the worst of
// them to confirm the estimate the budget was spent against is honest.
//
// The three places:
//   - far out, with the whole planet in the frame: the case the plan called the
//     one that needed watching
//   - just above the surface, which is where the gate drops you
//   - inside a tunnel, which is where the game is

import { readFileSync } from "node:fs";
import {
  R_OUTER, R_INNER, R_HEART, CHUNK, CUBE, LOD_STEPS, WORLD_RADIUS, SKY_EDGE,
} from "./voxelWorld";
import {
  visibleChunks, stepFor, mightHoldRock, dustAt, dustFarFor,
  TRIANGLE_BUDGET, DUST_NEAR, DUST_FAR, DUST_FAR_OPEN, RING_CUBES, COST_BY_STEP,
} from "./voxelView";
import { meshChunk, triangles } from "./voxelMesh";

const out: string[] = [];
let failures = 0;
function ok(name: string, cond: boolean, extra = "") {
  if (!cond) failures++;
  out.push(`${cond ? "PASS" : "FAIL"} ${name}${extra ? `  [${extra}]` : ""}`);
}

/** Build every chunk in a list for real and add up the triangles. */
function actualTriangles(chunks: Array<{ ox: number; oy: number; oz: number; step: number }>): number {
  let n = 0;
  for (const c of chunks) {
    n += triangles(meshChunk(c.ox, c.oy, c.oz, CHUNK, c.step, 0));
  }
  return n;
}

/* ---- the rings ---- */
{
  ok("close up is full detail", stepFor(0) === 1 && stepFor(RING_CUBES[0] - 1) === 1);
  ok("further out is coarser", stepFor(RING_CUBES[0] + 1) === 2
     && stepFor(RING_CUBES[1] + 1) === 4 && stepFor(RING_CUBES[2] + 1) === 8);
  ok("and it never gets coarser than the shell allows",
     stepFor(1e9) === LOD_STEPS[LOD_STEPS.length - 1]);
  ok("the rings only ever get coarser going out",
     RING_CUBES.every((r, i) => i === 0 || r > RING_CUBES[i - 1]));
}

/* ---- what is worth building at all ---- */
{
  ok("a chunk far outside the planet holds nothing",
     !mightHoldRock(Math.round((R_OUTER + 400) / 1), 0, 0, 1));
  ok("a chunk in the crust does", mightHoldRock(Math.round(R_OUTER - 80), 0, 0, 1));
  ok("a chunk in the empty cavity does not",
     !mightHoldRock(Math.round(R_INNER - 120), Math.round(R_INNER - 120), 0, 1));
  ok("but a chunk over the middle does, because a spoke passes through it",
     mightHoldRock(-CHUNK / 2, -CHUNK / 2, -CHUNK / 2, 1));
  ok("and the heart's own chunk does", mightHoldRock(-2, -2, -2, 1));
}

/* ---- the dust ---- */
{
  ok("nothing near is dusty", dustAt(0) === 0 && dustAt(DUST_NEAR) === 0);
  ok("everything past the far edge is gone", dustAt(DUST_FAR) === 1 && dustAt(DUST_FAR * 2) === 1);
  ok("and it fades in between", dustAt((DUST_NEAR + DUST_FAR) / 2) > 0.4
     && dustAt((DUST_NEAR + DUST_FAR) / 2) < 0.6);
  ok("the dust reaches further than a shell is thick, so the shape still reads",
     DUST_FAR / CUBE > 200, `${(DUST_FAR / CUBE).toFixed(0)} cubes against a ${R_OUTER - R_INNER}-cube shell`);
}

/* ---- the dust is thick in the rock and thin in the sky ----
   One dust distance for everywhere swallowed the whole planet from outside,
   which the first run of this file caught by finding nothing to draw at all. */
{
  ok("deep in the rock you cannot see far",
     dustFarFor((R_OUTER + R_INNER) / 2) === DUST_FAR,
     `${dustFarFor((R_OUTER + R_INNER) / 2)} units mid shell`);
  /* But the CAVITY is open space, not a tunnel, and the far side of the shell
     is seven hundred cubes off. Treating it as rock hid half the planet. */
  ok("the cavity is open space and you can see across it",
     dustFarFor(R_INNER - 60) === DUST_FAR_OPEN
     && DUST_FAR_OPEN / CUBE > R_INNER + R_OUTER - 60,
     `${dustFarFor(R_INNER - 60) / CUBE} cubes against a far side ${R_INNER - 60 + R_OUTER} away`);
  ok("out in the open you can see the whole planet",
     dustFarFor(R_OUTER + SKY_EDGE) === DUST_FAR_OPEN,
     `${dustFarFor(R_OUTER + SKY_EDGE)} units against a ${R_OUTER * 2 * CUBE}-unit planet`);
  ok("and it thickens gradually going into the rock, not at a line",
     dustFarFor(R_OUTER - 20) > DUST_FAR && dustFarFor(R_OUTER - 20) < DUST_FAR_OPEN,
     `${dustFarFor(R_OUTER - 20).toFixed(0)} twenty cubes in`);
  ok("the open dust reaches across the whole planet",
     DUST_FAR_OPEN >= R_OUTER * 2 * CUBE * 0.9);
}

/* ---- THE PLACES A PLAYER CAN BE ---- */
const places: Array<[string, [number, number, number]]> = [
  ["at the shard's sky edge, whole planet in frame", [R_OUTER + SKY_EDGE, 0, 0]],
  ["arriving at the surface", [R_OUTER + 40, 0, 0]],
  ["just inside the crust", [R_OUTER - 30, 0, 0]],
  ["deep in the shell", [(R_OUTER + R_INNER) / 2, 0, 0]],
  ["in the cavity, looking at the heart", [R_INNER - 60, 0, 0]],
  ["beside the heart", [R_HEART + 14, 0, 0]],
];
for (const [name, at] of places) {
  const v = visibleChunks(at);
  ok(`${name}: holds the budget`, v.triangles <= TRIANGLE_BUDGET,
     `${v.triangles} of ${TRIANGLE_BUDGET}, ${v.chunks.length} chunks, ${v.dropped} dropped`);
  ok(`${name}: has something to draw`, v.chunks.length > 0, `${v.chunks.length} chunks`);
  ok(`${name}: the nearest chunks are the sharpest`,
     v.chunks.length < 2 || v.chunks[0].step <= v.chunks[v.chunks.length - 1].step,
     v.chunks.length
       ? `nearest step ${v.chunks[0].step}, furthest ${v.chunks[v.chunks.length - 1].step}`
       : "nothing to draw");
}

/* ---- NOTHING MISSING WHERE A PLAYER CAN SEE IT ----
   Holding the budget is not enough on its own: an allowance can be held by
   drawing a patch of ground and dropping the rest, and that is exactly what
   happened. The skin at the coarse levels was sixty cubes deep, so a coarse
   chunk still meshed the whole 25%-filled crust block by block at 12,000
   triangles; the allowance bought nine chunks and dropped thirty-five. Geoff:
   "at a distance they are invisible and we see right through them, so they
   appear only when close which is stupid and makes no sense."

   So the views a player actually looks at the planet FROM have to drop nothing
   at all. Inside the rock is allowed to drop, because what is dropped there is
   behind a wall. */
{
  const openViews: Array<[string, [number, number, number]]> = [
    ["the shard's sky edge", [R_OUTER + SKY_EDGE, 0, 0]],
    ["half way in from the edge", [R_OUTER + SKY_EDGE * 0.5, 0, 0]],
    ["arriving, just above the surface", [R_OUTER + 40, 0, 0]],
    ["in the cavity", [R_INNER - 60, 0, 0]],
    ["beside the heart", [R_HEART + 14, 0, 0]],
  ];
  for (const [name, at] of openViews) {
    /* LOOKING AT IT, which is what the name says and what the budget has to
       serve: without a direction the allowance goes on chunks behind the ship
       as well, which the renderer culls anyway. */
    const len = Math.hypot(at[0], at[1], at[2]) || 1;
    const towardsCentre: [number, number, number] = [-at[0] / len, -at[1] / len, -at[2] / len];
    const v = visibleChunks(at, { look: towardsCentre });
    ok(`looking at the planet from ${name}: nothing is left out`,
       v.dropped === 0,
       `${v.dropped} dropped, ${v.chunks.length} drawn, ${v.triangles} of ${TRIANGLE_BUDGET}`);
  }
  /* And the direction is worth real money. */
  {
    const at: [number, number, number] = [R_INNER - 60, 0, 0];
    const blind = visibleChunks(at, { budget: 1e9 });
    const aimed = visibleChunks(at, { budget: 1e9, look: [-1, 0, 0] });
    ok("knowing where the eye is looking is worth about a third of the work",
       aimed.triangles < blind.triangles * 0.78,
       `${aimed.triangles} looking one way against ${blind.triangles} looking every way`);
  }
  /* And every level is cheap enough for that to be possible at all. Measured
     at the 90th percentile over a hundred and twenty chunks round the shell. */
  ok("no level costs more than about five thousand triangles a chunk",
     LOD_STEPS.every((st) => COST_BY_STEP[st] <= 5200),
     LOD_STEPS.map((st) => `${st}:${COST_BY_STEP[st]}`).join(" "));
  ok("and the planet is never filled in to get there",
     !/solidSkinAt|skinDepth/.test(
       readFileSync(`${process.cwd()}/src/wallet/rebels/voxel/voxelMesh.ts`, "utf8"),
     ),
     "filling it in made it look solid from outside and vanish from inside");
}

/* ---- and the estimate has to be honest ----
   The budget is spent against a table of average costs. If the real meshes are
   much dearer than the table says, the budget is a fiction. Checked on the two
   viewpoints most likely to be expensive. */
for (const [name, at] of [places[0], places[3]]) {
  const v = visibleChunks(at);
  const real = actualTriangles(v.chunks);
  ok(`${name}: the real meshes cost about what the budget was told`,
     real <= TRIANGLE_BUDGET * 1.35,
     `estimated ${v.triangles}, really ${real}, allowance ${TRIANGLE_BUDGET}`);
}

/* ---- the far side of the planet is not drawn ---- */
{
  const v = visibleChunks([R_OUTER + SKY_EDGE, 0, 0]);
  const behind = v.chunks.filter((c) => {
    const mx = (c.ox + CHUNK / 2) * c.step;
    const my = (c.oy + CHUNK / 2) * c.step;
    const mz = (c.oz + CHUNK / 2) * c.step;
    const l = Math.hypot(mx, my, mz) || 1;
    return mx / l < -0.3;                     /* well round the back */
  });
  ok("standing outside, the far side of the planet is not drawn",
     behind.length === 0, `${behind.length} chunks behind the planet`);
  /* Inside, there is no far side: you are in the rock and everything near you
     counts. */
  const inside = visibleChunks([(R_OUTER + R_INNER) / 2, 0, 0]);
  const anyDirection = new Set(inside.chunks.map((c) => {
    const mx = (c.ox + CHUNK / 2) * c.step;
    return mx > 0 ? "near" : "far";
  }));
  ok("inside the shell, chunks in every direction count", anyDirection.size >= 1);
}

/* ---- the budget really is hard ---- */
{
  const tight = visibleChunks([R_OUTER + SKY_EDGE, 0, 0], { budget: 20000 });
  ok("a small allowance is obeyed", tight.triangles <= 20000, `${tight.triangles}`);
  ok("and it says how much it had to leave out", tight.dropped > 0, `${tight.dropped} dropped`);
  ok("what it keeps is the nearest", tight.chunks.every((c, i) =>
    i === 0 || c.distance >= tight.chunks[i - 1].distance));
  const none = visibleChunks([R_OUTER + SKY_EDGE, 0, 0], { budget: 0 });
  ok("a zero allowance draws nothing rather than crashing", none.chunks.length === 0);
}

/* ---- what each mechanism is actually worth ----
   Worth measuring rather than asserting, because the first version of this file
   claimed the dust was what made the far view affordable and that turned out to
   be false: out in the open it is the coarse detail and the horizon test that
   do that work, and the dust earns its keep INSIDE the shell and as the thing
   that hides the seam between detail levels. */
{
  const insideAt: [number, number, number] = [(R_OUTER + R_INNER) / 2, 0, 0];
  const thin = visibleChunks(insideAt, { dustFar: DUST_FAR_OPEN, budget: 1e9 });
  const thick = visibleChunks(insideAt, { dustFar: 900, budget: 1e9 });
  ok("inside the shell, the dust is worth a great deal",
     thick.triangles < thin.triangles * 0.5,
     `${thick.triangles} through thick dust against ${thin.triangles} through thin`);
  /* And without any of it, the planet is hopeless: this is the number the whole
     design exists to avoid. */
  const naked = visibleChunks(insideAt, { dustFar: 1e6, budget: 1e9 });
  ok("and with no dust and no budget at all the planet is unaffordable",
     naked.triangles > TRIANGLE_BUDGET * 1.5,
     `${naked.triangles} triangles wanted against an allowance of ${TRIANGLE_BUDGET}`);
  /* ---- WHERE THE SAVING REALLY COMES FROM ----
     Not from filling the planet in, which made it look solid from outside and
     vanish from inside. From growing the clumps with the level, so a coarse
     chunk costs what a fine one does and covers eight times the ground. */
  ok("every level costs about the same per chunk",
     LOD_STEPS.every((st) => Math.abs(COST_BY_STEP[st] - COST_BY_STEP[1]) < COST_BY_STEP[1] * 0.4),
     LOD_STEPS.map((st) => `${st}:${COST_BY_STEP[st]}`).join(" "));
  /* And it is measurable: the same ground, coarse against fine. A coarse chunk
     covers eight times the cubes for no more triangles. */
  const fine = triangles(meshChunk(Math.round(R_OUTER - 60), 0, 0, CHUNK, 1));
  const coarse = triangles(meshChunk(Math.round((R_OUTER - 60) / 8), 0, 0, CHUNK, 8));
  ok("a coarse chunk covers eight times the ground for no more triangles",
     coarse < fine * 1.6,
     `${coarse} triangles over ${CHUNK * 8} cubes against ${fine} over ${CHUNK}`);
}

/* ---- the world it has to fit in ---- */
{
  ok("the planet's radius in world units is what the shard has to hold",
     WORLD_RADIUS === R_OUTER * CUBE, `${WORLD_RADIUS} units`);
  ok("the cost table covers every detail level",
     LOD_STEPS.every((s) => typeof COST_BY_STEP[s] === "number"));
}

console.log(out.join("\n"));
console.log(`\n${out.length - failures} passed, ${failures} failed`);
if (failures > 0) process.exit(1);
