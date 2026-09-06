// A reusable image grid for DD69 — the PoE Gallery, Divi Collectibles (NFD) and
// the Agents panel can all render through this one component so they look and
// behave the same. Features: a user-chosen COLUMN COUNT (persisted), captions,
// and double-click (or click) to open a full-size lightbox.
//
// It is deliberately data-agnostic: callers map their own records to GridItem.

import { useEffect, useState, type ReactNode } from "react";
import "./image-grid.css";

export interface GridItem {
  id: string;
  /** Small preview shown in the cell (data URL or URL). Omit for a placeholder. */
  thumb?: string;
  /** Larger image shown in the lightbox; falls back to `thumb`. */
  full?: string;
  title?: string;
  subtitle?: string;
  /** Optional badge/caption node rendered over the cell (e.g. "✓ Confirmed"). */
  badge?: ReactNode;
  /** Override the default lightbox on open (e.g. jump to a detail view). */
  onOpen?: () => void;
}

const clampCols = (n: number) => Math.min(8, Math.max(1, Math.round(n)));

export function ImageGrid({
  items,
  storageKey,
  defaultCols = 4,
  emptyText = "Nothing here yet.",
}: {
  items: GridItem[];
  /** localStorage key so each grid remembers its own column count. */
  storageKey: string;
  defaultCols?: number;
  emptyText?: string;
}) {
  const [cols, setCols] = useState<number>(() => {
    try {
      const v = Number(localStorage.getItem(`dd69.grid.cols.${storageKey}`));
      return v ? clampCols(v) : defaultCols;
    } catch {
      return defaultCols;
    }
  });
  const [open, setOpen] = useState<GridItem | null>(null);

  useEffect(() => {
    try {
      localStorage.setItem(`dd69.grid.cols.${storageKey}`, String(cols));
    } catch {
      /* storage unavailable */
    }
  }, [cols, storageKey]);

  // Esc closes the lightbox.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(null);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const openItem = (it: GridItem) => (it.onOpen ? it.onOpen() : setOpen(it));

  return (
    <div className="imgrid-wrap">
      <div className="imgrid-toolbar">
        <label className="imgrid-cols">
          Columns
          <input
            type="range"
            min={1}
            max={8}
            value={cols}
            onChange={(e) => setCols(clampCols(Number(e.target.value)))}
          />
          <span className="imgrid-cols-n">{cols}</span>
        </label>
        <span className="imgrid-count">{items.length} item{items.length === 1 ? "" : "s"}</span>
      </div>

      {items.length === 0 ? (
        <p className="wl-empty">{emptyText}</p>
      ) : (
        <div className="imgrid" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
          {items.map((it) => (
            <button
              key={it.id}
              type="button"
              className="imgrid-cell"
              onDoubleClick={() => openItem(it)}
              onClick={() => openItem(it)}
              title={it.title || "Open"}
            >
              <div className="imgrid-thumbwrap">
                {it.thumb ? (
                  <img className="imgrid-thumb" src={it.thumb} alt={it.title || ""} loading="lazy" />
                ) : (
                  <div className="imgrid-noimg">no preview</div>
                )}
                {it.badge && <span className="imgrid-badge">{it.badge}</span>}
              </div>
              {(it.title || it.subtitle) && (
                <div className="imgrid-cap">
                  {it.title && <span className="imgrid-title">{it.title}</span>}
                  {it.subtitle && <span className="imgrid-sub">{it.subtitle}</span>}
                </div>
              )}
            </button>
          ))}
        </div>
      )}

      {open && (
        <div className="imgrid-lightbox" onClick={() => setOpen(null)}>
          <div className="imgrid-lightbox-inner" onClick={(e) => e.stopPropagation()}>
            <button type="button" className="imgrid-lightbox-close" onClick={() => setOpen(null)}>×</button>
            {(open.full || open.thumb) ? (
              <img className="imgrid-lightbox-img" src={open.full || open.thumb} alt={open.title || ""} />
            ) : (
              <div className="imgrid-noimg imgrid-noimg-big">No preview available</div>
            )}
            {(open.title || open.subtitle) && (
              <div className="imgrid-lightbox-cap">
                {open.title && <div className="imgrid-lightbox-title">{open.title}</div>}
                {open.subtitle && <div className="imgrid-lightbox-sub">{open.subtitle}</div>}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
