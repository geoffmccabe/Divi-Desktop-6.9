// The detailed globe: which tile covers where, and whether the outlines land
// on the planet rather than through it.
//
// Run: sh scripts/run-earth-tests.sh

import * as THREE from "three";
import { tileAt, tileBounds, tileKey, type EarthManifest } from "./earthTiles";
import { createBorders, borderStats } from "./globeBorders";

const out: string[] = [];
let failures = 0;
function ok(name: string, cond: boolean, extra = "") {
  if (!cond) failures++;
  out.push(`${cond ? "PASS" : "FAIL"} ${name}${extra ? `  [${extra}]` : ""}`);
}
process.on("uncaughtException", (e) => {
  console.log(out.join("\n"));
  console.log("FAIL threw: " + (e as Error).message);
  process.exit(1);
});

const M: EarthManifest = {
  version: 1, tileDeg: 30, cols: 12, rows: 6, size: 1125, format: "webp", tiles: 70,
};

/* ------------------------------------------------------- which tile is where */
{
  /* The corners of the world, which is where an off-by-one lives. */
  ok("the north-west corner is the first tile",
     tileKey(...Object.values(tileAt(90, -180, M)) as [number, number]) === "t_0_0",
     JSON.stringify(tileAt(90, -180, M)));
  ok("the south-east corner is the last",
     JSON.stringify(tileAt(-90, 179.999, M)) === JSON.stringify({ col: 11, row: 5 }),
     JSON.stringify(tileAt(-90, 179.999, M)));
  ok("the equator at Greenwich is the middle",
     JSON.stringify(tileAt(0, 0, M)) === JSON.stringify({ col: 6, row: 3 }),
     JSON.stringify(tileAt(0, 0, M)));

  /* Rome, 41.9N 12.5E, is the tile the earlier comparison came from. */
  ok("Rome lands in the tile that was checked by eye",
     JSON.stringify(tileAt(41.9, 12.5, M)) === JSON.stringify({ col: 6, row: 1 }),
     JSON.stringify(tileAt(41.9, 12.5, M)));

  /* Longitude wraps rather than falling off the end. A ship flying east past
     the date line must not ask for tile twelve of twelve. */
  for (const lon of [180, 180.1, 360, -180.1, 540, -540]) {
    const t = tileAt(10, lon, M);
    ok(`longitude ${lon} stays on the map`,
       t.col >= 0 && t.col < M.cols && t.row >= 0 && t.row < M.rows, JSON.stringify(t));
  }
  /* And latitude clamps rather than wrapping: there is nothing past a pole. */
  for (const lat of [95, -95, 1e6]) {
    const t = tileAt(lat, 0, M);
    ok(`latitude ${lat} clamps to the map`, t.row >= 0 && t.row < M.rows, JSON.stringify(t));
  }
}

/* ------------------------------------------------------- tiles tile the world */
{
  /* Every tile's bounds must agree with the lookup that chose it: take a point
     inside a tile's own rectangle and it must come back to that tile. Get this
     backwards, by a row or by a sign, and the ground under you is a picture of
     somewhere else entirely, which is the sort of bug that looks like a
     rendering fault. */
  let wrong = 0;
  for (let row = 0; row < M.rows; row++) {
    for (let col = 0; col < M.cols; col++) {
      const b = tileBounds(col, row, M);
      const lat = (b.lat0 + b.lat1) / 2;
      const lon = (b.lon0 + b.lon1) / 2;
      const back = tileAt(lat, lon, M);
      if (back.col !== col || back.row !== row) wrong++;
    }
  }
  ok("every tile's middle comes back to that tile", wrong === 0, `${wrong} disagreed`);

  const top = tileBounds(0, 0, M);
  ok("row zero is the NORTH pole", top.lat0 === 90 && top.lat1 === 60,
     `${top.lat0} to ${top.lat1}`);
  const left = tileBounds(0, 0, M);
  ok("column zero starts at the date line", left.lon0 === -180, `${left.lon0}`);

  /* The whole world, once, with no gaps and no overlaps. */
  const bottom = tileBounds(M.cols - 1, M.rows - 1, M);
  ok("the tiles cover the whole planet",
     bottom.lon1 === 180 && bottom.lat1 === -90, `${bottom.lon1}, ${bottom.lat1}`);
}

/* ------------------------------------------------------------- the outlines */
{
  const R = 100;
  /* A stand-in for the globe's own placement: latitude and longitude onto a
     sphere. The real one comes from react-globe.gl, and the point of passing it
     in is that the outlines land wherever the towers do without this file
     needing to know how that is done. */
  const coords = (lat: number, lng: number, alt: number) => {
    const r = R * (1 + alt);
    const phi = (90 - lat) * Math.PI / 180;
    const theta = (lng + 180) * Math.PI / 180;
    return {
      x: -r * Math.sin(phi) * Math.cos(theta),
      y: r * Math.cos(phi),
      z: r * Math.sin(phi) * Math.sin(theta),
    };
  };

  const b = createBorders(coords);
  const pos = b.object.geometry.getAttribute("position");
  const stats = borderStats();
  ok("there are outlines to draw", stats.rings > 200 && stats.points > 5000,
     `${stats.rings} rings, ${stats.points} points`);
  ok("and they became line segments", pos.count > stats.points,
     `${pos.count} vertices from ${stats.points} points`);
  ok("in whole segments", pos.count % 2 === 0, `${pos.count}`);

  /* ---- ON the planet, not through it ----
     Outlines are stored as points meant to be joined by straight lines on a
     FLAT map. Drawn straight on a sphere, a long chord cuts under the surface
     and vanishes into the ground. So every segment is split until it is short,
     and this is the assertion that says so: no vertex, and no midpoint between
     two joined vertices, may sink below the surface. */
  const v = new THREE.Vector3();
  const w = new THREE.Vector3();
  let below = 0;
  let deepest = R * 2;
  for (let i = 0; i < pos.count; i += 2) {
    v.fromBufferAttribute(pos as THREE.BufferAttribute, i);
    w.fromBufferAttribute(pos as THREE.BufferAttribute, i + 1);
    const mid = v.clone().add(w).multiplyScalar(0.5).length();
    deepest = Math.min(deepest, mid);
    if (mid < R) below++;
  }
  ok("no outline sinks into the planet", below === 0,
     `${below} segments dipped below, closest ${deepest.toFixed(3)} of ${R}`);

  /* And they sit above the surface rather than in it, or they would flicker
     against the ground at every angle. */
  v.fromBufferAttribute(pos as THREE.BufferAttribute, 0);
  ok("and they sit just above it", v.length() > R && v.length() < R * 1.01,
     `${v.length().toFixed(3)}`);

  /* ---- NOTHING ACROSS THE PACIFIC ----
     A ring that wraps at the date line stores it as a jump most of the way
     round the world. Joined up, that draws one line straight through every
     country in between, which on a globe is a bright chord through the planet.
     Nothing may span more than a few degrees. */
  let longest = 0;
  for (let i = 0; i < pos.count; i += 2) {
    v.fromBufferAttribute(pos as THREE.BufferAttribute, i);
    w.fromBufferAttribute(pos as THREE.BufferAttribute, i + 1);
    longest = Math.max(longest, v.distanceTo(w));
  }
  /* Two degrees of great circle is about 3.5 units on a radius of a hundred. */
  ok("no segment leaps across the world", longest < 5, `longest ${longest.toFixed(2)} units`);

  b.setColour("hsl(207, 90%, 54%)", 0.18);
  const mat = b.object.material as THREE.LineBasicMaterial;
  ok("the colour is the theme's", Math.abs(mat.opacity - 0.18) < 1e-6 && mat.color.b > 0.7,
     `#${mat.color.getHexString()} at ${mat.opacity}`);
  b.dispose();
}

console.log(out.join("\n"));
console.log(`${out.filter((l) => l.startsWith("PASS")).length} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
