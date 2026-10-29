import { useState } from "react";

// A glyph in a circle that reveals a short explanation on hover or click.
// Click toggles (for touch); hover shows on desktop. The glyph defaults to "?";
// pass glyph="i" for an information marker.
export function InfoDot({ text, glyph = "?" }: { text: string; glyph?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <span
      className="info-dot-wrap"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <button
        type="button"
        className="info-dot"
        aria-label="More info"
        onClick={(e) => {
          e.stopPropagation();
          setOpen((o) => !o);
        }}
      >
        {glyph}
      </button>
      {open && <span className="info-dot-bubble">{text}</span>}
    </span>
  );
}
