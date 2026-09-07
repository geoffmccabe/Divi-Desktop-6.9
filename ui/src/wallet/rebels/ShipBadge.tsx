// Your ship, small, in the corner of the cockpit.
//
// The Ship Market in miniature: the same hull, turning at the same slow rate,
// on the same translucent disc inside the same ring. That repetition is the
// point — the badge and the Market read as one object seen at two sizes, so
// what you chose in the shop is what you can see you are flying.
//
// It gets out of the way. Come within three diameters of a world or a station
// and the corner belongs to that instead: the badge fades out, the readout
// fades in, and there is never a moment where both are competing for the same
// space. A ship you already know about is worth less than the name of the
// thing you are flying at.

import { useEffect, useState } from "react";
import { ShipPreview } from "./ShipPreview";
import { loadShip, subscribeShip } from "./shipChoice";
import { loadPaint, type ShipPaint } from "./shipColours";

export function ShipBadge({ hidden }: { hidden: boolean }) {
  const [ship, setShip] = useState(() => loadShip());
  const [paint, setPaint] = useState<ShipPaint>(() => loadPaint());

  /* Changing your ship or its colours in the Market changes the badge, without
     leaving the game and coming back. */
  useEffect(() => subscribeShip(() => {
    setShip(loadShip());
    setPaint(loadPaint());
  }), []);

  /* Kept mounted while it fades, so the model is not thrown away and rebuilt
     every time a planet drifts past. */
  return (
    <div className={"ship-badge" + (hidden ? " ship-badge-away" : "")} aria-hidden>
      <div className="ship-badge-ring">
        <ShipPreview id={ship} paint={paint} />
      </div>
    </div>
  );
}
