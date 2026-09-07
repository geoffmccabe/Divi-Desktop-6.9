import { useState } from "react";
import { useTheme } from "../ThemeProvider";
import type { GallerySkin } from "./api";
import { buySkin } from "../../wallet/api";
import { walletStatus } from "../../wallet/api";
import { getAskMode } from "../../wallet/securityPrefs";

function shortAddr(a: string): string {
  return a.length > 16 ? `${a.slice(0, 8)}…${a.slice(-6)}` : a;
}

export function authorLabel(s: Pick<GallerySkin, "author_name" | "author_address">): string {
  return s.author_name?.trim() || shortAddr(s.author_address);
}

export function priceLabel(s: Pick<GallerySkin, "is_free" | "price_divi">): string {
  return s.is_free ? "Free" : `${s.price_divi} DIVI`;
}

// Buying: one immediate on-chain payment to the creator's address, tagged
// with the skin's slug (see crates/supervisor/src/skinbuy.rs). Deliberately
// NOT the payment-request/invitation mechanism used elsewhere in the app
// (crates/supervisor/src/payreq.rs) — that's for someone to ask another
// address to pay them later; a Buy button is the buyer paying right now.
//
// This phase only sends the payment. There is no "Apply" for a paid skin
// yet — proving you own it (by scanning your own transaction history for
// this exact tag) and unlocking Apply for it is separate follow-up work,
// not built here.
type BuyStage = "idle" | "confirm" | "password" | "sending" | "done";

function BuyButton({ skin }: { skin: GallerySkin }) {
  const [stage, setStage] = useState<BuyStage>("idle");
  const [pass, setPass] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [txid, setTxid] = useState("");

  const send = async (passphrase?: string) => {
    setStage("sending");
    setErr(null);
    try {
      const id = await buySkin(skin.author_address, skin.price_divi, skin.slug, passphrase);
      setTxid(id);
      setStage("done");
    } catch (e) {
      setErr(String(e));
      setStage(passphrase != null ? "password" : "confirm");
    }
  };

  const confirm = async () => {
    setErr(null);
    try {
      const st = await walletStatus();
      const needsPass = st.encrypted && !(getAskMode() === "open" && st.unlocked);
      if (needsPass) {
        setStage("password");
        return;
      }
      await send();
    } catch (e) {
      setErr(String(e));
    }
  };

  if (stage === "done") {
    return (
      <div className="gallery-buy-done">
        <p className="wl-note">
          ✓ Sent {skin.price_divi} DIVI. It'll be usable here once the payment confirms — there's no
          "Apply" for it yet in this build.
        </p>
        {txid && <p className="wl-note gallery-buy-txid">Transaction: {txid}</p>}
      </div>
    );
  }

  if (stage === "confirm" || stage === "password") {
    return (
      <div className="gallery-buy-confirm">
        <p className="wl-note">
          Send <strong>{skin.price_divi} DIVI</strong> to {authorLabel(skin)} for this skin. This cannot
          be undone.
        </p>
        {stage === "password" && (
          <input
            className="wl-input"
            type="password"
            placeholder="Wallet password"
            value={pass}
            onChange={(e) => setPass(e.target.value)}
            autoFocus
          />
        )}
        {err && <p className="wl-err">{err}</p>}
        <div className="gallery-buy-actions">
          <button
            type="button"
            className="style-btn style-btn-primary"
            onClick={() => (stage === "password" ? send(pass) : confirm())}
          >
            Confirm purchase
          </button>
          <button type="button" className="style-btn" onClick={() => setStage("idle")}>
            Cancel
          </button>
        </div>
      </div>
    );
  }

  if (stage === "sending") {
    return <p className="wl-note">Sending…</p>;
  }

  return (
    <button type="button" className="style-btn style-btn-primary" onClick={() => setStage("confirm")}>
      Buy for {skin.price_divi} DIVI
    </button>
  );
}

// Detail view for one gallery skin. Free skins apply for real today via the
// same mechanism as any locally-saved theme (ThemeProvider.applyExternal);
// priced skins can now actually be bought (one on-chain payment to the
// creator), though there's no ownership-proof/Apply gate for a paid skin yet.
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
            <BuyButton skin={skin} />
          )}
        </div>
      </div>
    </div>
  );
}
