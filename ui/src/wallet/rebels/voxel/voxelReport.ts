// Spikeworld, Phase 0: measure it before building any of it.
//
// Run: sh scripts/run-voxel-report.sh
//
// This is not a test; it prints numbers and answers the questions the plan left
// open. The plan's first version guessed some of these from a scratchpad
// sketch, and one of the guesses was wrong (a shell meant to be a quarter solid
// came out 15%). Everything here reads the real generator.
//
// What it answers:
//   1. Is the shell really a quarter rock, at every depth?
//   2. What does one chunk cost, in cubes, faces, merged quads and triangles?
//   3. What does a chunk cost at each detail level?
//   4. How far out can a ship be before the visible shell exceeds its
//      allowance? That number is where the shard's sky edge has to sit.
//   5. How long does a chunk take to build?

import {
  GRID, CUBE, CHUNK, R_OUTER, R_INNER, R_HEART, FILL, LOD_STEPS, WORLD_DIAMETER,
} from "./voxelWorld";
import { solid, crustFill, carvedFraction } from "./voxelField";
import { meshChunk, triangles } from "./voxelMesh";

/** What the planet is allowed to cost in one frame. DFlow showed the live game
 *  in trouble above about 200,000 triangles, and the planet cannot have all of
 *  it: the ships, shots and effects need room too. */
export const TRIANGLE_BUDGET = 120000;

const pad = (s: string | number, n: number) => String(s).padStart(n);
const pct = (n: number) => `${(n * 100).toFixed(1)}%`;

/** Sample the fill at a given radius, over many directions. */
function fillAt(radius: number, samples = 4000): number {
  const GOLD = Math.PI * (3 - Math.sqrt(5));
  let hit = 0;
  for (let i = 0; i < samples; i++) {
    const ct = 1 - (2 * i + 1) / samples;
    const st = Math.sqrt(Math.max(0, 1 - ct * ct));
    const a = i * GOLD;
    const x = Math.round(Math.cos(a) * st * radius);
    const y = Math.round(ct * radius);
    const z = Math.round(Math.sin(a) * st * radius);
    if (solid(x, y, z)) hit++;
  }
  return hit / samples;
}

export function report(): void {
  console.log(`SPIKEWORLD, Phase 0 report`);
  console.log(`  grid ${GRID} cubes, cube ${CUBE} units, so ${WORLD_DIAMETER} units across`);
  console.log(`  shell from ${R_INNER} to ${R_OUTER} cubes, heart ${R_HEART}, budget ${TRIANGLE_BUDGET} triangles\n`);

  /* ---- 1. is it a quarter rock? ---- */
  console.log(`1. FILL BY DEPTH (wanted: ${pct(FILL)} on average, leaning outwards)`);
  console.log(`   the channels carve ${pct(carvedFraction())} of the rock back out, and the`);
  console.log(`   threshold aims high by exactly that much`);
  console.log(`   radius   wanted    measured`);
  let worst = 0, total = 0, count = 0;
  for (let r = R_INNER + 5; r <= R_OUTER - 5; r += 25) {
    const want = crustFill(r), got = fillAt(r);
    worst = Math.max(worst, Math.abs(got - want));
    total += got; count++;
    console.log(`   ${pad(r, 6)}   ${pad(pct(want), 6)}    ${pad(pct(got), 6)}`);
  }
  console.log(`   average measured ${pct(total / count)}, worst miss ${pct(worst)}`);
  console.log(`   cavity at r=${R_INNER - 40}: ${pct(fillAt(R_INNER - 40))} (spokes only)`);
  console.log(`   heart at r=${R_HEART - 8}: ${pct(fillAt(R_HEART - 8))}\n`);

  /* ---- 2, 3. what a chunk costs ---- */
  console.log(`2. ONE ${CHUNK}-CUBE CHUNK, at four depths, full detail`);
  console.log(`   where            cubes    fill   faces  f/cube   quads    tris`);
  const spots: Array<[string, number]> = [
    ["outer surface", R_OUTER - CHUNK],
    ["upper crust", R_OUTER - 80],
    ["mid shell", (R_OUTER + R_INNER) / 2],
    ["cavity ceiling", R_INNER + 4],
  ];
  for (const [name, r] of spots) {
    /* CUBE coordinates, not chunk numbers. The first run of this report passed
       the chunk number and so measured a chunk thirteen cubes from the centre,
       in the cavity next to the heart, and reported an 8% crust. The generator
       was right and the report was wrong, which is the more usual way round. */
    const m = meshChunk(Math.round(r), 0, 0, CHUNK, 1);
    console.log(`   ${name.padEnd(15)} ${pad(m.cubes, 6)}  ${pad(pct(m.cubes / CHUNK ** 3), 6)}`
      + `  ${pad(m.faces, 6)}   ${pad((m.faces / Math.max(1, m.cubes)).toFixed(2), 5)}`
      + `  ${pad(m.quads, 6)}  ${pad(triangles(m), 6)}`);
  }

  console.log(`\n3. THE DETAIL LEVELS, one chunk at the upper crust`);
  console.log(`   step   covers        cubes   quads    tris`);
  for (const step of LOD_STEPS) {
    /* At step s the origin is in coarse cells, so the same place is r/s. */
    const m = meshChunk(Math.round((R_OUTER - 80) / step), 0, 0, CHUNK, step);
    console.log(`   ${pad(step, 4)}   ${pad(CHUNK * step, 5)} cubes   ${pad(m.cubes, 6)}`
      + `  ${pad(m.quads, 6)}  ${pad(triangles(m), 6)}`);
  }

  /* ---- 4. where the sky edge has to sit ----
     From a given altitude, how much of the shell is in front of you, and what
     does it cost at the coarsest level? The answer is a radius: past it, the
     whole planet fits in the frame and costs more than it may. */
  console.log(`\n4. WHERE THE SHARD'S SKY EDGE HAS TO SIT`);
  console.log(`   Chunks across the visible face of the shell, at the coarsest`);
  console.log(`   detail, against the ${TRIANGLE_BUDGET}-triangle allowance.\n`);
  const coarse = LOD_STEPS[LOD_STEPS.length - 1];
  const perChunk = triangles(meshChunk(Math.round((R_OUTER - 80) / coarse), 0, 0, CHUNK, coarse)) || 1;
  const chunkCubes = CHUNK * coarse;
  console.log(`   a coarsest chunk covers ${chunkCubes} cubes and costs ${perChunk} triangles`);
  console.log(`   altitude(cubes)  altitude(units)  visible chunks   tris   verdict`);
  for (const alt of [200, 400, 800, 1600, 3200, 6400]) {
    /* How much of the sphere is above the horizon from that altitude, as a
       fraction of its whole surface, then how many coarse chunks that is. */
    const d = R_OUTER + alt;
    const capFraction = 0.5 * (1 - R_OUTER / d);          /* the visible cap */
    const shellChunks = (4 * Math.PI * (R_OUTER / chunkCubes) ** 2);
    const seen = Math.max(1, Math.round(shellChunks * capFraction * 2));
    const tris = seen * perChunk;
    console.log(`   ${pad(alt, 15)}  ${pad(alt * CUBE, 15)}  ${pad(seen, 14)}  ${pad(tris, 6)}`
      + `   ${tris <= TRIANGLE_BUDGET ? "fits" : "OVER"}`);
  }

  /* ---- 5. build cost ---- */
  console.log(`\n5. BUILD COST (one chunk, on this machine, single threaded)`);
  for (const step of [1, 4, 8]) {
    const oo = Math.round((R_OUTER - 80) / step);
    const t0 = Date.now();
    let n = 0;
    while (Date.now() - t0 < 400) { meshChunk(oo + (n % 3) * CHUNK, (n % 3) * CHUNK, 0, CHUNK, step); n++; }
    const ms = (Date.now() - t0) / n;
    console.log(`   step ${pad(step, 2)}: ${ms.toFixed(1)}ms a chunk, so ${Math.round(1000 / ms)} chunks a second on one thread`);
  }
}
