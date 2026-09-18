// The room's half of the test cheats: what "21" and "1x" put in the sky.
//
// Moved out of room.ts (2026-Sep-15) so the cheats are one removable piece on each
// side (the cockpit's is ui/src/wallet/rebels/rebelsCheats.ts). WHO may use them
// is decided in room.ts, which refuses web guests.
//
// "21" is a REAL dragon ahead of the seat (it leaves its egg): to remove or gate
// before eggs are worth anything. "1x" is a flock of tier x, worth nothing, as in
// the cockpit.

import * as THREE from "three";
import { spawnDragon, spawnFleet, type CombatState } from "../../../ui/src/wallet/rebels/rebelsCombat";

export function runRoomCheat(combat: CombatState, body: { pos: THREE.Vector3; fwd: THREE.Vector3 }, code: string): void {
  if (code === "21") {
    if (combat.enemies.some((e) => e.dragon)) return;
    const ahead = body.pos.clone().addScaledVector(body.fwd, 35);
    const up = body.pos.clone().normalize();
    const across = new THREE.Vector3().crossVectors(body.fwd, up).normalize();
    spawnDragon(combat, ahead, across);
  } else if (/^1[1-6]$/.test(code)) {
    spawnFleet(combat, Number(code[1]), body.pos, body.fwd, { cheat: true });
  }
}
