// The node globe's DRAWING: how much the card is asked to do per frame.
//
// Run: sh scripts/run-globe-draw-tests.sh
//
// Why this file exists. DFlow measured a flight at 60fps average with 153
// stalls over 40ms in 222 seconds, and nearly every worst frame was spent
// outside the game's own code with 395 to 474 draw calls issued. The sky held
// about five enemies and five bullets at the time, so what the card was
// drawing was the MAP: one cone and one sphere for every node on the network,
// and a shader compiled the first time each hidden effect was used.
//
// Both fixes are structural and both are easy to undo by accident, so they are
// pinned here. These are source assertions rather than a render: the globe is
// React and three.js and needs a canvas, which is exactly the sort of test the
// full suite cannot run. What they guard is the SHAPE of the fix.

import { readFileSync } from "node:fs";

const map = readFileSync(`${process.cwd()}/src/wallet/GlobeMap.tsx`, "utf8");
const cockpit = readFileSync(`${process.cwd()}/src/wallet/rebels/rebelsController.ts`, "utf8");

const out: string[] = [];
let failures = 0;
function ok(name: string, cond: boolean, extra = "") {
  if (!cond) failures++;
  out.push(`${cond ? "PASS" : "FAIL"} ${name}${extra ? `  [${extra}]` : ""}`);
}

/* ---- the towers are instanced ---- */
{
  ok("network towers are drawn as instances, not one mesh each",
     /new THREE\.InstancedMesh\(cone, spire, n\)/.test(map)
     && /new THREE\.InstancedMesh\(sph, beacon, n\)/.test(map));
  ok("their shapes are built once and shared",
     /towerGeoCache/.test(map) && /function towerGeometries/.test(map));
  ok("and the shared shapes are marked so the teardown leaves them alone",
     /cone\.userData\.shared = true/.test(map)
     && /!m\.geometry\.userData\?\.shared/.test(map),
     "a disposed shared geometry blanks every tower the next time the map opens");
  ok("the instanced meshes free their own buffers on teardown",
     /inst\.isInstancedMesh\) inst\.dispose\(\)/.test(map));
}

/* ---- and everything that talks to a tower still works ---- */
{
  ok("a tower still keeps its own group, so the rest of the file is unchanged",
     /towerByIp\.set\(p\.ip, t\)/.test(map));
  ok("moving a tower is copied into the instances",
     (map.match(/syncTowers\(\)/g) ?? []).length >= 3,
     `${(map.match(/syncTowers\(\)/g) ?? []).length} calls`);
  ok("the game's scaleTowers pushes the new size through",
     /tipOf\.set\(ip, t\.position[\s\S]{0,120}?syncTowers\(\)/.test(map));
  ok("the winner coin's hidden tower is pushed through too",
     /winnerDeco\.visible = false;[\s\S]{0,240}?syncTowers\(\)/.test(map));
  ok("a hidden tower is written away rather than left standing",
     /makeScale\(0, 0, 0\)/.test(map));
  ok("your own tower stays a real group, because it carries the beam",
     /const solo = p\.kind === "self"/.test(map) && /if \(solo\) t\.add\(makeHomeBeacon/.test(map));
  ok("hovering an instanced tower still names the node it hit",
     /h\.instanceId/.test(map) && /userData\.nodes as GlobePoint\[\]/.test(map));
}

/* ---- the shaders are built before they are needed ---- */
{
  ok("the map hands the game its compile", /compile: \(\) => prewarm\(\)/.test(map));
  ok("and the game warms what is hidden", /function warmShaders\(\)/.test(cockpit));
  ok("which is the whole point: hidden things are shown for the one call",
     /if \(!o\.visible\) \{ o\.visible = true; hidden\.push\(o\); \}/.test(cockpit)
     && /for \(const o of hidden\) o\.visible = false;/.test(cockpit));
  ok("things held outside the scene are lent to it, because a compile walks the scene",
     /if \(!root\.parent && scene\) \{ scene\.add\(root\); lent\.push\(root\); \}/.test(cockpit)
     && /for \(const o of lent\) scene\?\.remove\(o\)/.test(cockpit));
  ok("the dragon is warmed when it lands, not when it is met",
     /dragonProto = p; warmShaders\(\)/.test(cockpit));
  ok("the warm runs once the whole game is in the scene",
     /homeName: homeIndex >= 0[\s\S]{0,300}?warmShaders\(\)/.test(cockpit));
  ok("and the compile is let go with the scene it belonged to",
     /compileScene = null;/.test(cockpit));
}

console.log(out.join("\n"));
console.log(`\n${out.length - failures} passed, ${failures} failed`);
if (failures > 0) process.exit(1);
