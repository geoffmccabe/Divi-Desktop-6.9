import { useEffect, useState } from "react";
import { nfdFeeConfig, nfdSetFeeConfig } from "../../wallet/api";

// Admin: fees / treasury. Stores ONLY the public treasury address + per-action
// fee amounts — never any key (see Divi-Blockchain_6.9/docs/TREASURY-AND-FEES.md).
// Fees are paid to the treasury as an on-chain output when set; 0 / blank = off.

export function PayoutsPanel() {
  const [treasury, setTreasury] = useState("");
  const [nfdMint, setNfdMint] = useState("0");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const c = await nfdFeeConfig();
        setTreasury(c.treasuryAddress);
        setNfdMint(String(c.nfdMint));
      } catch {
        /* no config yet */
      }
    })();
  }, []);

  async function save() {
    setBusy(true);
    setMsg(null);
    try {
      await nfdSetFeeConfig(treasury.trim(), Number(nfdMint) || 0);
      setMsg("Saved ✓");
    } catch (e) {
      setMsg(String(e));
    }
    setBusy(false);
  }

  return (
    <div className="admin-panel-body">
      <p className="wl-note">
        Fees are paid to your public <strong>treasury address</strong> as an on-chain output. Only the
        address and amounts are stored here — <strong>never any key</strong>. Leave the fee at 0 (or the
        address blank) to disable.
      </p>

      <label className="pay-row">
        <span>Treasury address (public)</span>
        <input
          className="wl-input"
          value={treasury}
          placeholder="your treasury address"
          onChange={(e) => setTreasury(e.target.value)}
        />
      </label>
      <label className="pay-row">
        <span>NFD mint fee (DIVI)</span>
        <input className="wl-input" value={nfdMint} inputMode="decimal" onChange={(e) => setNfdMint(e.target.value)} />
      </label>

      <button className="wl-btn wl-btn-primary" disabled={busy} onClick={save}>
        {busy ? "Saving…" : "Save"}
      </button>
      {msg && <p className="wl-note">{msg}</p>}

      <p className="wl-note">
        Fees accumulate at the treasury address on-chain — track its balance in any explorer. Other fees
        (Proof of Existence, DMT tokens) will appear here as those features wire to the same treasury.
      </p>
    </div>
  );
}
