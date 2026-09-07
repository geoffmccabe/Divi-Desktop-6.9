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
  { keys: "MOUSE", what: "Fly. The crosshair goes where you point and the ship follows it." },
  { keys: "ARROWS / WASD", what: "Fly, if you would rather not chase a hidden cursor." },
  { keys: "LEFT CLICK / SPACE", what: "Main guns. One double shot per press, full damage." },
  { keys: "HOLD E + CLICK", what: "Mini gun. Twenty a second while held, aimed at the crosshair, quarter damage, quarter of a round each." },
  { keys: "HOLD RIGHT CLICK", what: "Shield. Soaks four fifths of a hit. Ten charges, one every half second held." },
  { keys: "T / CTRL + CLICK", what: "Torpedo. Two carried. Press again to set it off, or it goes after four seconds." },
  { keys: "SHIFT", what: "Boost." },
  { keys: "Z", what: "Brake. Slows right down, which is how you turn tightly." },
  { keys: "?", what: "This panel." },
  { keys: "ESC", what: "Back to the map." },
];

export const DOCKING: ControlLine[] = [
  { keys: "YOUR OWN TOWER", what: "The red one with the beam going up. Fly straight into it at any speed. It stops you and never damages you." },
  { keys: "THE RESUPPLY", what: "Four seconds, and it restores everything: hull, ammo, boost, torpedoes and shields." },
  { keys: "EVERY OTHER TOWER", what: "Not yours. They do not resupply you and flying into one hurts." },
];

export function RebelsControls({ onClose }: { onClose?: () => void }) {
  return (
    <div className="orbit-controls">
      <h3>CONTROLS</h3>
      <dl>
        {CONTROLS.map((c) => (
          <div key={c.keys}>
            <dt>{c.keys}</dt>
            <dd>{c.what}</dd>
          </div>
        ))}
      </dl>
      <h3>DOCKING</h3>
      <dl>
        {DOCKING.map((c) => (
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
  );
}
