import { useState } from "react";
import { useTheme } from "../ThemeProvider";
import type { GallerySkin } from "./api";

function shortAddr(a: string): string {
  return a.length > 16 ? `${a.slice(0, 8)}…${a.slice(-6)}` : a;
}

export function authorLabel(s: Pick<GallerySkin, "author_name" | "author_address">): string {
  return s.author_name?.trim() || shortAddr(s.author_address);
}

export function priceLabel(s: Pick<GallerySkin, "is_free" | "price_divi">): string {
  return s.is_free ? "Free" : `${s.price_divi} DIVI`;
}

// Detail view for one gallery skin. Free skins apply for real today via the
// same mechanism as any locally-saved theme (ThemeProvider.applyExternal);
// priced skins show the price but buying isn't wired up yet (Phase 5) — the
// button is visibly present so the eventual flow has an obvious home, but
// it does nothing yet rather than pretending to.
export function SkinDetail({ skin, onBack }: { skin: GallerySkin; onBack: () => void }) {
  const { applyExternal } = useTheme();
  const [applied, setApplied] = useState(false);

  return (
    <div className="gallery-detail">
      <button type="button" className="style-btn" onClick={onBack}>
        ← Back to Gallery
      </button>
      <div className="gallery-detail-body">
        <div
          className="gallery-detail-preview"
          style={skin.preview_url ? { backgroundImage: `url(${skin.preview_url})` } : undefined}
        />
        <div className="gallery-detail-info">
          <h2>{skin.name}</h2>
          <p className="gallery-detail-author">
            by {authorLabel(skin)} · {skin.downloads} download{skin.downloads === 1 ? "" : "s"}
          </p>
          {skin.description && <p className="gallery-detail-desc">{skin.description}</p>}
          <p className="gallery-price">{priceLabel(skin)}</p>
          {skin.is_free ? (
            <button
              type="button"
              className="style-btn style-btn-primary"
              onClick={() => {
                applyExternal(skin.tokens);
                setApplied(true);
              }}
            >
              {applied ? "Applied ✓" : "Apply this skin"}
            </button>
          ) : (
            <button type="button" className="style-btn style-btn-primary" disabled title="Buying skins is coming soon">
              Buy — coming soon
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
