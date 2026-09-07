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
  { keys: "MOUSE", what: "Fly. Push the crosshair off centre to turn; let go and it comes back." },
  { keys: "ARROWS / WASD", what: "Steer using the traditional keyboard navigation keys." },
  { keys: "LEFT CLICK / SPACE", what: "Main guns. One double shot per press." },
  { keys: "E + CLICK", what: "Mini gun. Twenty a second while held, aimed at the crosshair, 25% damage, uses 1/4 bullet" },
  { keys: "HOLD RIGHT CLICK", what: "Shield for 0.5 seconds. Absorbs 80% of a hit. Ten charges." },
  { keys: "T or CTRL + CLICK", what: "Torpedo. Four carried. Press again to detonate, or wait 4 sec." },
  { keys: "SHIFT", what: "Boost." },
  { keys: "Z", what: "Brake and slow down." },
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
