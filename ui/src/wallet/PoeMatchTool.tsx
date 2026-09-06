// "Find Matches": drop in a suspect image and check it against your own
// timestamps two ways —
//   • EXACT MATCH  (SHA-256): the byte-for-byte same file.
//   • CLOSE MATCH  (perceptual dHash): a resized / re-compressed / re-saved copy.
// Everything runs locally; the image you check never leaves the machine, and it
// only searches THIS wallet's timestamps (a public registry is a separate step).

import { useState, type ChangeEvent } from "react";
import { loadPoeHistory, type PoeRecord } from "./poeHistory";
import { phashFromFile, hamming, closeness, CLOSE_MATCH_MAX } from "./phash";

async function sha256Hex(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  const digest = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export function PoeMatchTool() {
  const [busy, setBusy] = useState(false);
  const [checked, setChecked] = useState(false);
  const [name, setName] = useState<string | null>(null);
  const [exact, setExact] = useState<PoeRecord[]>([]);
  const [close, setClose] = useState<{ rec: PoeRecord; dist: number }[]>([]);
  const [couldPhash, setCouldPhash] = useState(true);

  async function pick(e: ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    setBusy(true);
    setChecked(false);
    setName(f.name);
    const list = loadPoeHistory();
    const hash = await sha256Hex(f);
    setExact(list.filter((r) => r.hash === hash));
    const ph = f.type.startsWith("image/") ? await phashFromFile(f) : null;
    setCouldPhash(!!ph);
    if (ph) {
      setClose(
        list
          .filter((r) => r.phash)
          .map((r) => ({ rec: r, dist: hamming(ph, r.phash!) }))
          .filter((x) => x.dist <= CLOSE_MATCH_MAX && x.rec.hash !== hash)
          .sort((a, b) => a.dist - b.dist),
      );
    } else {
      setClose([]);
    }
    setBusy(false);
    setChecked(true);
    e.target.value = "";
  }

  const Match = ({ rec, dist }: { rec: PoeRecord; dist?: number }) => (
    <li className="ts-match-row">
      {rec.thumb ? <img className="ts-match-thumb" src={rec.thumb} alt="" /> : <div className="ts-match-noimg" />}
      <div className="ts-match-info">
        <span className="ts-match-name">{rec.title?.trim() || rec.name}</span>
        {dist !== undefined && (
          <span className="ts-match-dist">
            {closeness(dist).label} · {dist} bits different
          </span>
        )}
        <code className="ts-match-txid">{rec.txid}</code>
      </div>
    </li>
  );

  return (
    <div className="ts-match">
      <p className="wl-note" style={{ marginBottom: 10 }}>
        Check a suspect image against your timestamps. <strong>Exact match</strong> finds the identical
        file; <strong>close match</strong> finds a resized or re-saved copy. Both run on this device — the
        image you drop in never leaves your machine.
      </p>
      <label className="wl-btn wl-btn-primary ts-match-pick">
        {busy ? "Checking…" : "Choose an image to check"}
        <input type="file" accept="image/*" hidden onChange={pick} disabled={busy} />
      </label>

      {checked && (
        <div className="ts-match-results">
          {name && <p className="wl-note">Checked: <strong>{name}</strong></p>}

          <h4 className="ts-match-head">Exact match</h4>
          {exact.length ? (
            <ul className="ts-match-list">{exact.map((r) => <Match key={r.txid} rec={r} />)}</ul>
          ) : (
            <p className="wl-note">No exact match — this isn't byte-for-byte one of your timestamped files.</p>
          )}

          <h4 className="ts-match-head">Close match</h4>
          {!couldPhash ? (
            <p className="wl-note">Close match works on images only.</p>
          ) : close.length ? (
            <ul className="ts-match-list">{close.map((c) => <Match key={c.rec.txid} rec={c.rec} dist={c.dist} />)}</ul>
          ) : (
            <p className="wl-note">
              No close match among your timestamps. (Note: close match catches resized/re-saved copies, but
              not crops, rotations, heavy edits, or deliberate evasion.)
            </p>
          )}
        </div>
      )}
    </div>
  );
}
