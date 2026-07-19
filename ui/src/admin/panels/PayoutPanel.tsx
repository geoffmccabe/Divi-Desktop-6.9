import { useEffect, useState } from "react";
import { validateAddress } from "../../wallet/api";
import { fetchPrices } from "../../wallet/value";
import {
  getPoePayout,
  setPoePayout,
  splitForAnchor,
  type PoePayoutSettings,
} from "../../wallet/poePayout";

// Admin → Payouts. Sets where the Proof-of-Existence anchor fee goes and how it
// is divided between the payout address and the staker who mines the block.

export function PayoutPanel() {
  const [s, setS] = useState<PoePayoutSettings>(() => getPoePayout());
  const [usdPerDivi, setUsd] = useState<number | null>(null);
  // null = not checked yet; the address is saved either way so a slow node
  // can't block editing.
  const [addrOk, setAddrOk] = useState<boolean | null>(null);
  const [checking, setChecking] = useState(false);

  const update = (partial: Partial<PoePayoutSettings>) => {
    const next = { ...s, ...partial };
    setS(next);
    setPoePayout(next);
  };

  useEffect(() => {
    let alive = true;
    fetchPrices()
      .then((p) => alive && setUsd(p.prices?.usd ?? null))
      .catch(() => {
        /* preview shows "unavailable" */
      });
    return () => {
      alive = false;
    };
  }, []);

  // Validate against the node, debounced — an invalid address would otherwise
  // only surface when a user's anchor failed.
  useEffect(() => {
    const addr = s.address.trim();
    if (!addr) {
      setAddrOk(null);
      return;
    }
    let alive = true;
    setChecking(true);
    const t = setTimeout(() => {
      validateAddress(addr)
        .then((ok) => alive && setAddrOk(ok))
        .catch(() => alive && setAddrOk(null))
        .finally(() => alive && setChecking(false));
    }, 400);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [s.address]);

  const split = splitForAnchor(s, usdPerDivi);
  const fmt = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 2 });

  return (
    <div className="admin-panel">
      <p className="wl-note">
        Where the Proof of Existence anchor fee goes. Each timestamp costs the user the amount
        below, converted to DIVI at the current price. Part is paid to your address; the rest is
        left as the transaction fee, which the staker who mines the block collects.
      </p>

      <label className="admin-field">
        <span>Payout address</span>
        <input
          className="wl-input"
          placeholder="Divi address (leave empty to disable payouts)"
          value={s.address}
          onChange={(e) => update({ address: e.target.value })}
          spellCheck={false}
        />
      </label>
      {s.address.trim() && (
        <p className={addrOk === false ? "wl-err" : "wl-note"}>
          {checking
            ? "Checking address…"
            : addrOk === true
              ? "✓ Valid Divi address."
              : addrOk === false
                ? "✗ Not a valid Divi address — anchors will refuse to send rather than burn funds."
                : "Could not check the address (node unreachable)."}
        </p>
      )}

      <label className="admin-field">
        <span>Cost per timestamp (USD)</span>
        <input
          className="wl-input"
          type="number"
          min="0"
          step="0.25"
          value={s.targetUsd}
          onChange={(e) => update({ targetUsd: Number(e.target.value) })}
        />
      </label>

      <label className="admin-field">
        <span>Your share ({s.payoutPercent}% — staker gets {100 - s.payoutPercent}%)</span>
        <input
          type="range"
          min="0"
          max="100"
          step="5"
          value={s.payoutPercent}
          onChange={(e) => update({ payoutPercent: Number(e.target.value) })}
        />
      </label>

      <div className="admin-preview">
        <div className="ts-hash-label">Preview at current price</div>
        {split && usdPerDivi ? (
          !s.address.trim() ? (
            <p className="wl-note">
              No payout address set, so anchors charge only the network minimum
              ({fmt(split.feeDivi)} DIVI) rather than quietly overpaying stakers.
            </p>
          ) : (
            <dl className="ts-meta">
              <dt>Total</dt>
              <dd>
                {fmt(split.totalDivi)} DIVI (${s.targetUsd.toFixed(2)})
              </dd>
              <dt>To your address</dt>
              <dd>{fmt(split.payoutDivi)} DIVI</dd>
              <dt>To the staker</dt>
              <dd>{fmt(split.feeDivi)} DIVI</dd>
              <dt>DIVI price</dt>
              <dd>${usdPerDivi.toFixed(8)}</dd>
            </dl>
          )
        ) : (
          <p className="wl-note">DIVI price unavailable, so the split can't be previewed.</p>
        )}
      </div>

      <p className="wl-note">
        {/* Be honest about what this is: a product rule, not a protocol one. */}
        This split is enforced by this app, not by the blockchain. Anyone running modified software
        could anchor a fingerprint while paying only the network minimum.
      </p>
    </div>
  );
}
