// The map's animation gate: loops idle while the window is in the background.
//
// Run: sh scripts/run-anim-gate-tests.sh
//
// 2026-Oct-21: the wallet's web view used most of a CPU core for 1.5 days on
// Geoff's Mac, drawing the globe behind other windows. See animGate.ts.
import assert from "node:assert/strict";
import { mapAnimActive, onMapAnimChange, _setForTest } from "./animGate";

const seen: boolean[] = [];
const off = onMapAnimChange((a) => seen.push(a));
_setForTest({ focused: true, hidden: false });
assert.equal(mapAnimActive(), true, "focused and visible: animate");
_setForTest({ focused: false });
assert.equal(mapAnimActive(), false, "window in the background: idle");
_setForTest({ focused: true });
assert.equal(mapAnimActive(), true, "focus back: animate again");
_setForTest({ hidden: true });
assert.equal(mapAnimActive(), false, "page hidden: idle even if focused");
_setForTest({ hidden: false });
assert.equal(mapAnimActive(), true, "visible again: animate");
off();
_setForTest({ focused: false });
assert.deepEqual(seen, [false, true, false, true], "listeners hear every flip, none after unsubscribe");
console.log("animGate: all assertions passed");
