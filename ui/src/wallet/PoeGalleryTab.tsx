// Gallery tab: every proof this wallet has made, as a visual grid. Uses the same
// reusable ImageGrid as the Collectibles and Agents panels. Everything shown is
// LOCAL — PoE files never leave the machine, so the "full size" in the lightbox
// is the largest preview stored (the shareable public thumbnail), not the
// original file.

import { useState } from "react";
import { loadPoeHistory } from "./poeHistory";
import { ImageGrid, type GridItem } from "./ImageGrid";

export function PoeGalleryTab() {
  const [list] = useState(() => loadPoeHistory());

  const items: GridItem[] = list.map((r) => ({
    id: r.txid,
    thumb: r.publicThumb || r.thumb,
    full: r.publicThumb || r.thumb,
    title: r.title?.trim() || r.name,
    subtitle: r.confirmedAt
      ? `timestamped ${new Date(r.confirmedAt * 1000).toLocaleDateString()}`
      : "confirming…",
  }));

  return (
    <div>
      <p className="wl-note" style={{ marginBottom: 10 }}>
        Every timestamp you've made. Previews are stored on this device only — your original files
        never left your machine. Double-click any tile to view it larger.
      </p>
      <ImageGrid
        items={items}
        storageKey="poe-gallery"
        defaultCols={4}
        emptyText="No timestamps yet. Create one and it'll appear here."
      />
    </div>
  );
}
