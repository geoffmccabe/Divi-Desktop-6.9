// The control list, as it actually behaves.
//
// One place. The launch card used to carry its own summary and it had drifted
// from the game: it claimed any tower repairs and rearms you and that your own
// is merely twice as fast, when torpedoes and guards come from your own tower
// and from nowhere else. Both the launch card and the ? panel read this now, so
// there is nothing to drift apart from.

export interface ControlLine {
  keys: string;
  what: string;
}

export const CONTROLS: ControlLine[] = [
  { keys: "MOUSE", what: "Move the crosshair. The ship turns toward it and the mini gun fires AT it." },
  { keys: "W / S", what: "Throttle up and down. Below zero it reverses." },
  { keys: "A / D", what: "Strafe left and right, without turning." },
  { keys: "Q / E", what: "Roll left and right." },
  { keys: "SHIFT", what: "Boost. Ignores the throttle." },
  { keys: "X", what: "Full stop." },
  { keys: "LEFT CLICK", what: "Primary weapon. Only the left button fires." },
  { keys: "RIGHT CLICK", what: "Secondary weapon. Press again to detonate a torpedo." },
  { keys: "1 2 3", what: "Primary: 1 pulse laser, 2 MINI GUN (aims at the crosshair), 3 beam." },
  { keys: "4 5 6", what: "Choose the secondary: torpedo, mine, bomb." },
  { keys: "F  (HOLD)", what: "SHIELD. Absorbs 80% of a hit. Ten charges, one every half second held." },
  { keys: "V", what: "Cockpit or third person. OPTION + WHEEL sets the distance." },
  { keys: "ARROWS", what: "Steer, for anyone who would rather not use the mouse." },
  { keys: "ESC", what: "Back to the map." },
];

export const DOCKING: ControlLine[] = [
  { keys: "YOUR TOWER", what: "Fly into your Red Tower with the Beacon to Refuel, Resupply, and Repair" },
  { keys: "EVERY OTHER TOWER", what: "Crashing into other towers causes damage." },
  { keys: "?", what: "HELP Panel" },
];

export function RebelsControls({ onClose }: { onClose?: () => void }) {
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
      {/* One flat list, in the order Geoff wrote it. There used to be a second
          DOCKING heading, which now has nowhere sensible to go: the tower lines
          and the HELP line belong to the same run. */}
      <dl>
        {[...CONTROLS, ...DOCKING].map((c) => (
          <div key={c.keys}>
            <dt>{c.keys}</dt>
            <dd>{c.what}</dd>
          </div>
        ))}
      </dl>
      {onClose && (
        <button type="button" onClick={onClose}>CLOSE</button>
      )}
      </div>
    </>
  );
}
