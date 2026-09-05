// Shared CEX/DEX venue selection for the Market Maker page. The toggle lives in
// the page's title row (rendered by the Shell) while the panel body below reads
// the same state - so they stay in sync through this little store.

import { useEffect, useState } from "react";
import "./marketmaker.css";

type Venue = "cex" | "dex";
let current: Venue = "cex";
const subs = new Set<(v: Venue) => void>();

export function setVenue(v: Venue) {
  if (v === current) return;
  current = v;
  subs.forEach((f) => f(v));
}

export function useVenue(): [Venue, (v: Venue) => void] {
  const [v, setV] = useState<Venue>(current);
  useEffect(() => {
    const f = (nv: Venue) => setV(nv);
    subs.add(f);
    setV(current);
    return () => { subs.delete(f); };
  }, []);
  return [v, setVenue];
}

// The CEX | DEX toggle: one rounded rectangle split in two (outer corners only).
export function MmVenueToggle() {
  const [venue] = useVenue();
  return (
    <div className="mm-venue-toggle">
      <button type="button" className={"mm-venue-btn" + (venue === "cex" ? " mm-venue-on" : "")} onClick={() => setVenue("cex")}>CEX</button>
      <button type="button" className={"mm-venue-btn" + (venue === "dex" ? " mm-venue-on" : "")} onClick={() => setVenue("dex")}>DEX</button>
    </div>
  );
}
