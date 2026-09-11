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
import { BOOST, CRUISE, STRAFE_SPEED, type Extras, NO_EXTRAS } from "./orbitFlight";

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
  { id: "throttle", keys: ["w", "s"], label: "W / S",
    what: () => "Throttle up and down. Below zero it reverses." },
  { id: "strafe", keys: ["a", "d"], label: "A / D",
    what: (c) => `Slide left and right without turning, at ${x(STRAFE_SPEED * c.extras.strafeMult)} units a second${c.extras.strafeMult > 1 ? ` (${x(c.extras.strafeMult)}x)` : ""}.` },
  { id: "lift", keys: ["r", "c"], label: "R / C",
    what: (c) => `Slide up and down without turning, the same ${x(STRAFE_SPEED * c.extras.strafeMult)} units a second.` },
  { id: "roll", keys: ["q", "e"], label: "Q / E",
    what: () => "Roll left and right." },
  { id: "boost", keys: ["shift"], label: "SHIFT",
    what: () => `Boost, 1x: ${x(BOOST)} units a second against a cruise of ${x(CRUISE)}. Ignores the throttle.` },
  { id: "super", keys: ["tab"], label: "TAB",
    what: (c) => `Super boost, ${x(c.extras.superMult)}x: ${x(BOOST * c.extras.superMult)} units a second, burning fuel ${x(c.extras.superMult)}x as fast.` },
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
  [["ESC", "escape"], ["1", "1"], ["2", "2"], ["3", "3"], ["4", "4"], ["5", "5"], ["6", "6"], ["7", null], ["8", null]],
  [["TAB", "tab", 1.6], ["Q", "q"], ["W", "w"], ["E", "e"], ["R", "r"], ["T", null], ["Y", null]],
  [["SHIFT", "shift", 2.1], ["A", "a"], ["S", "s"], ["D", "d"], ["F", "f"], ["G", null]],
  [["Z", null, 1.2], ["X", "x"], ["C", "c"], ["V", "v"], ["SPACE", " ", 3.2]],
];
const EXTRA_CAPS: Cap[] = [["ARROWS", "arrowup", 1.8], ["L CLICK", "LEFT CLICK", 1.8], ["R CLICK", "RIGHT CLICK", 1.8], ["?", "?"], ["#", "#"]];

export function Keyboard({ active, onHover }: { active: string | null; onHover: (group: string | null) => void }) {
  const cap = ([text, key, w]: Cap) => {
    const group = key ? GROUP_OF_KEY[key] : undefined;
    return (
      <span
        key={text}
        className={"orbit-key" + (group ? " live" : " dead") + (group && group === active ? " on" : "")}
        style={w ? { flex: `${w} 0 0` } : undefined}
        onMouseEnter={() => group && onHover(group)}
        onMouseLeave={() => onHover(null)}
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

/** The plain list, for the launch card. */
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
