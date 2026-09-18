import { useEffect, useState } from "react";
import { listSkins, type GallerySkin } from "./api";
import { SkinDetail, authorLabel, priceLabel } from "./SkinDetail";

export function SkinsGallery() {
  const [skins, setSkins] = useState<GallerySkin[] | null>(null);
  const [err, setErr] = useState("");
  const [selectedSlug, setSelectedSlug] = useState<string | null>(null);

  useEffect(() => {
    listSkins()
      .then(setSkins)
      .catch((ex) => setErr(ex instanceof Error ? ex.message : "Couldn't load the gallery"));
  }, []);

  const selected = skins?.find((s) => s.slug === selectedSlug) ?? null;
  if (selected) {
    return <SkinDetail skin={selected} onBack={() => setSelectedSlug(null)} />;
  }

  return (
    <div className="skins-gallery">
      {err && <p className="style-note style-upload-err">{err}</p>}
      {!err && skins === null && <p className="style-note">Loading the gallery…</p>}
      {skins && skins.length === 0 && (
        <p className="style-note">No skins published yet — be the first, from Settings → Style.</p>
      )}
      {skins && skins.length > 0 && (
        <div className="gallery-grid">
          {skins.map((s) => (
            <button type="button" key={s.slug} className="gallery-card" onClick={() => setSelectedSlug(s.slug)}>
              <div
                className="gallery-card-preview"
                style={s.preview_url ? { backgroundImage: `url(${s.preview_url})` } : undefined}
              />
              <div className="gallery-card-body">
                <span className="gallery-card-name">{s.name}</span>
                <span className="gallery-card-author">{authorLabel(s)}</span>
                <span className={s.is_free ? "skin-badge" : "gallery-card-price"}>{priceLabel(s)}</span>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
