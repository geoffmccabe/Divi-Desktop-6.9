import { useState } from "react";
import {
  KEY,
  KEY_INFO,
  displayValue,
  evmToHex,
  hraClearRecord,
  hraSetDiviAddress,
  hraSetRecord,
  keyLabel,
  textToHex,
  type OwnedName,
} from "./api";

// What a name points at. This is the ENS "resolver profile" idea: one name
// carrying a set of details, each of which anyone can look up.
//
// Two rules are enforced here and again in the Rust layer, because they are the
// two ways this feature could hurt somebody:
//
//  1. A phone number never goes on the chain in the clear. The chain is
//     permanent and public: you could not delete it later even if you wanted
//     to, and it is a gift to anyone running a SIM-swap.
//  2. Everything else you add here is public forever too, and the panel says so
//     next to each field rather than in small print at the bottom.

export function NameRecords({ name, onChanged }: { name: OwnedName; onChanged: () => void }) {
  const [key, setKey] = useState<number>(KEY.DIVI_ADDRESS);
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState("");

  const info = KEY_INFO.find((k) => k.key === key)!;
  const blocked = key === KEY.PHONE;

  const save = async () => {
    setBusy(true);
    setError("");
    setDone("");
    try {
      if (key === KEY.DIVI_ADDRESS) {
        await hraSetDiviAddress(name.name, value.trim());
      } else if (key === KEY.EVM_ADDRESS) {
        const hex = evmToHex(value);
        if (!hex) throw new Error("That is not a valid Ethereum address. It should be 0x then 40 characters.");
        await hraSetRecord(name.name, key, hex);
      } else {
        const clean = value.trim();
        if (!clean) throw new Error("Nothing to save.");
        await hraSetRecord(name.name, key, textToHex(clean));
      }
      setDone("Saved. It appears here once the transaction is in a block.");
      setValue("");
      onChanged();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (k: number) => {
    setBusy(true);
    setError("");
    setDone("");
    try {
      await hraClearRecord(name.name, [k]);
      setDone("Removed. It clears once the transaction is in a block.");
      onChanged();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="hra-records">
      <h4 className="hra-sub">What {name.name.toLowerCase()} points at</h4>

      {name.records.length === 0 && (
        <p className="wl-note">
          Nothing yet. Add a Divi address first: that is what lets someone send to this name instead
          of a long string of characters.
        </p>
      )}

      {name.records.length > 0 && (
        <table className="hra-table">
          <tbody>
            {name.records.map(([k, hex]) => (
              <tr key={k}>
                <th>{keyLabel(k)}</th>
                <td className="mono hra-val">{displayValue(k, hex)}</td>
                <td className="hra-rowaction">
                  <button className="wl-btn" disabled={busy} onClick={() => remove(k)}>
                    Remove
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <div className="hra-addrow">
        <label className="hra-field">
          <span>Add or replace</span>
          <select className="wl-input" value={key} onChange={(e) => setKey(Number(e.target.value))}>
            {KEY_INFO.map((k) => (
              <option key={k.key} value={k.key}>
                {k.label}
              </option>
            ))}
          </select>
        </label>

        <label className="hra-field">
          <span>Value</span>
          <input
            className="wl-input mono"
            placeholder={info.placeholder}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            disabled={blocked}
            spellCheck={false}
          />
        </label>
      </div>

      <p className={blocked ? "wl-err" : "wl-note"}>{info.hint}</p>

      <button className="wl-btn wl-btn-primary" disabled={busy || blocked || !value.trim()} onClick={save}>
        {busy ? "Saving…" : "Save"}
      </button>

      {done && <p className="wl-note">{done}</p>}
      {error && <p className="wl-err">{error}</p>}
    </div>
  );
}
