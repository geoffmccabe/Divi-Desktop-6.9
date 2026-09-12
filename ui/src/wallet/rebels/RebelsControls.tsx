// The controls, as data, and the help card that draws them.
//
// ONE list of groups, and everything reads it: the key mapping in the
// controller (which keys are the game's), the launch card, and the ? panel
// with its keyboard. Nothing about a key or a number is written twice, so a
// bought item that changes a multiplier changes the words here too: the
// explanations are functions of what the player owns.
//
// Geoff: "show the keyboard layout on the top, and when mouse-over the
// various keys, it puts in bold the explanations below. The explanations
// should be in groups like WASD all highlight together. QE together, RC
// together, and TAB/SHIFT as 2x and 1x Boost."

import { useState } from "react";
import { BOOST, CRUISE, STRAFE_SPEED, vstrafeOf, type Extras, NO_EXTRAS } from "./orbitFlight";

/** What the words need to know about this player's ship. */
export interface ControlsContext {
  extras: Extras;
}

export interface ControlGroup {
  id: string;
  /** Key names as the keyboard draws them and as KeyboardEvent.key gives
   *  them (lower-cased), which are the same for letters. */
  keys: string[];
  /** The short name on the card. */
  label: string;
  what: (ctx: ControlsContext) => string;
}

const x = (n: number) => (Number.isInteger(n) ? `${n}` : n.toFixed(1));

export const CONTROL_GROUPS: ControlGroup[] = [
  { id: "mouse", keys: ["MOUSE"], label: "MOUSE",
    what: () => "Move the crosshair. The ship turns toward it and the mini gun fires AT it." },
  /* WASD is ONE group: Geoff asked for "WASD all highlight together", and
     hovering any of the four lights all four and bolds this line. */
  { id: "move", keys: ["w", "a", "s", "d"], label: "W / A / S / D",
    what: (c) => `W and S throttle up and down; below zero it reverses. A and D slide left and right without turning, at ${x(STRAFE_SPEED * c.extras.strafeMult)} units a second${c.extras.strafeMult > 1 ? ` (${x(c.extras.strafeMult)}x)` : ""}.` },
  { id: "lift", keys: ["r", "c"], label: "R / C",
    what: (c) => `Slide up and down without turning, at ${x(STRAFE_SPEED * vstrafeOf(c.extras))} units a second${vstrafeOf(c.extras) > 1 ? ` (${x(vstrafeOf(c.extras))}x)` : ""}.` },
  { id: "roll", keys: ["q", "e"], label: "Q / E",
    what: () => "Roll left and right." },
  /* And SHIFT with TAB, as "2x and 1x Boost", which is how he put it. */
  { id: "boost", keys: ["shift", "tab"], label: "SHIFT / TAB",
    what: (c) => `Boost. SHIFT is 1x, ${x(BOOST)} units a second against a cruise of ${x(CRUISE)}. TAB is ${x(c.extras.superMult)}x, ${x(BOOST * c.extras.superMult)} a second, burning fuel ${x(c.extras.superMult)}x as fast. Both ignore the throttle.` },
  { id: "stop", keys: ["x"], label: "X", what: () => "Full stop." },
  { id: "fire", keys: ["LEFT CLICK", " "], label: "LEFT CLICK / SPACE",
    what: () => "Primary weapon. Only the left button fires." },
  { id: "secondary", keys: ["RIGHT CLICK"], label: "RIGHT CLICK",
    what: () => "Secondary weapon. Press again to detonate a torpedo." },
  { id: "primary", keys: ["1", "2", "3", "4", "5", "6"], label: "1 to 6",
    what: () => "Pick the primary along the upgrade line: 1 pulse, 2 mini gun (aims at the crosshair), 3 to 6 the beams." },
  { id: "guard", keys: ["f"], label: "F  (HOLD)",
    what: () => "SHIELD. Absorbs 80% of a hit. Ten charges, one every half second held." },
  { id: "view", keys: ["v"], label: "V",
    what: () => "Cockpit or third person. OPTION + WHEEL sets the distance." },
  { id: "arrows", keys: ["arrowup", "arrowdown", "arrowleft", "arrowright"], label: "ARROWS",
    what: () => "Steer, for anyone who would rather not use the mouse." },
  { id: "esc", keys: ["escape"], label: "ESC", what: () => "Back to the map." },
  { id: "rear", keys: ["7"], label: "7",
    what: () => "Rear Gun, when you hold one: a rear view top right. Aim in it to fire backwards; right-click there for a torpedo." },
  { id: "use", keys: ["y"], label: "Y",
    what: () => "Use a held Instant Recharge; a Supercharge when you are already full (up to double)." },
  { id: "inventory", keys: ["i"], label: "I",
    what: () => "Inventory: your ships, guns, sealed spheres and items. Right-click a sphere to open it." },
  { id: "sound", keys: ["0"], label: "0",
    what: () => "Sound gone? Start the sound again from scratch, without restarting the game." },
  { id: "help", keys: ["?"], label: "?", what: () => "This panel." },
  { id: "dflow", keys: ["#"], label: "#", what: () => "The DFlow panel: frame times and what is costing them." },
];

export const DOCKING_NOTES: Array<{ label: string; what: string }> = [
  { label: "YOUR TOWER", what: "Fly into your Red Tower with the Beacon to Refuel, Resupply, and Repair." },
  { label: "EVERY OTHER TOWER", what: "Crashing into other towers causes damage." },
];

/** Every keyboard key the game claims, lower-cased as KeyboardEvent.key
 *  gives them. The controller swallows exactly these. */
export const GAME_KEYS: string[] = CONTROL_GROUPS.flatMap((g) => g.keys)
  .filter((k) => k !== "MOUSE" && k !== "LEFT CLICK" && k !== "RIGHT CLICK");

/** Which group a key belongs to. */
export const GROUP_OF_KEY: Record<string, string> = Object.fromEntries(
  CONTROL_GROUPS.flatMap((g) => g.keys.map((k) => [k, g.id])),
);

/* ---- the keyboard ----
   The keys that matter, in their places, with a few dark neighbours so it
   reads as a keyboard and not a list. A cap is [what is printed, the key it
   stands for]; a cap with no key is decoration. */
type Cap = [string, string | null, number?];
const KEYBOARD: Cap[][] = [
  [["ESC", "escape"], ["1", "1"], ["2", "2"], ["3", "3"], ["4", "4"], ["5", "5"], ["6", "6"], ["7", "7"], ["8", null], ["0", "0"]],
  [["TAB", "tab", 1.6], ["Q", "q"], ["W", "w"], ["E", "e"], ["R", "r"], ["T", null], ["Y", "y"], ["I", "i"]],
  [["SHIFT", "shift", 2.1], ["A", "a"], ["S", "s"], ["D", "d"], ["F", "f"], ["G", null]],
  [["Z", null, 1.2], ["X", "x"], ["C", "c"], ["V", "v"], ["SPACE", " ", 3.2]],
];
/* Everything that is not a key, so that every line below can be reached from
   the picture above: the mouse itself had no cap at all, which left its line
   the one thing on the card with no way to light it. */
const EXTRA_CAPS: Cap[] = [
  ["MOUSE", "MOUSE", 1.8], ["ARROWS", "arrowup", 1.8],
  ["L CLICK", "LEFT CLICK", 1.8], ["R CLICK", "RIGHT CLICK", 1.8], ["?", "?"], ["#", "#"],
];

/** Every cap on the picture, rows and extras together, so a test can check
 *  that each explanation below has something above it that lights it. */
export const KEYBOARD_CAPS: Cap[] = [...KEYBOARD.flat(), ...EXTRA_CAPS];

export function Keyboard({ active, onHover, onPick }: {
  active: string | null;
  onHover: (group: string | null) => void;
  /** Clicking a key holds its explanation up, for anyone not hovering. */
  onPick?: (group: string) => void;
}) {
  const cap = ([text, key, w]: Cap) => {
    const group = key ? GROUP_OF_KEY[key] : undefined;
    return (
      <span
        key={text}
        className={"orbit-key" + (group ? " live" : " dead") + (group && group === active ? " on" : "")}
        style={w ? { flex: `${w} 0 0` } : undefined}
        onMouseEnter={() => group && onHover(group)}
        onMouseLeave={() => onHover(null)}
        onClick={() => group && onPick?.(group)}
      >
        {text}
      </span>
    );
  };
  return (
    <div className="orbit-keyboard" aria-hidden>
      {KEYBOARD.map((row, i) => <div key={i} className="orbit-keyrow">{row.map(cap)}</div>)}
      <div className="orbit-keyrow orbit-keyrow-extra">{EXTRA_CAPS.map(cap)}</div>
    </div>
  );
}

/**
 * The controls, as a picture you point at.
 *
 * The keyboard on top and ONE explanation under it, the one for whatever the
 * pointer is on. This is what the launch screen shows beside the logo, in
 * place of the wall of two dozen lines that used to be there. Geoff,
 * 2026-Sep-12: "You're supposed to show a keyboard layout on top, to show how
 * the controls work, with interactive highlighting, and not just a list, and
 * this is supposed to show on startup on the right side, next to the logo
 * too."
 *
 * Clicking a key holds its line up, so it reads without a steady hand.
 */
export function ControlsBoard({ extras = NO_EXTRAS }: { extras?: Extras }) {
  const [hover, setHover] = useState<string | null>(null);
  const [pinned, setPinned] = useState<string | null>(null);
  const active = hover ?? pinned;
  const group = CONTROL_GROUPS.find((g) => g.id === active) ?? null;
  return (
    <div className="orbit-board">
      <Keyboard
        active={active}
        onHover={setHover}
        onPick={(g) => setPinned((p) => (p === g ? null : g))}
      />
      <div className={"orbit-board-read" + (group ? " on" : "")}>
        <b>{group ? group.label : "THE CONTROLS"}</b>
        <span>{group ? group.what({ extras }) : "Point at a key to see what it does. Click one to hold it."}</span>
      </div>
      <div className="orbit-board-notes">
        {DOCKING_NOTES.map((d) => (
          <div key={d.label}><b>{d.label}</b><span>{d.what}</span></div>
        ))}
      </div>
    </div>
  );
}

/** The plain list, for anywhere that wants every line at once. */
export function controlLines(ctx: ControlsContext): Array<{ keys: string; what: string }> {
  return [
    ...CONTROL_GROUPS.map((g) => ({ keys: g.label, what: g.what(ctx) })),
    ...DOCKING_NOTES.map((d) => ({ keys: d.label, what: d.what })),
  ];
}

export function RebelsControls({ onClose, extras = NO_EXTRAS }: { onClose?: () => void; extras?: Extras }) {
  const [active, setActive] = useState<string | null>(null);
  const ctx = { extras };
  return (
    <>
      {/* A plain black wash over the game behind the panel. The panel had a
          tinted, blurred background of its own and it still read as grey text
          over a moving starfield: blur softens what is behind a thing, it does
          not darken it, and the globe is bright. Half-opacity black under the
          whole panel is what actually makes the words legible. */}
      <div className="orbit-controls-scrim" onClick={onClose} />
      <div className="orbit-controls">
        <h3>CONTROLS</h3>
        <Keyboard active={active} onHover={setActive} />
        <dl>
          {CONTROL_GROUPS.map((g) => (
            <div
              key={g.id}
              className={g.id === active ? "on" : ""}
              onMouseEnter={() => setActive(g.id)}
              onMouseLeave={() => setActive(null)}
            >
              <dt>{g.label}</dt>
              <dd>{g.what(ctx)}</dd>
            </div>
          ))}
          {DOCKING_NOTES.map((d) => (
            <div key={d.label}><dt>{d.label}</dt><dd>{d.what}</dd></div>
          ))}
        </dl>
        {onClose && (
          <button type="button" onClick={onClose}>CLOSE</button>
        )}
      </div>
    </>
  );
}
