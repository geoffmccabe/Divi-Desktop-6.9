import { useEffect, useState } from "react";
import { loadPoeHistory, removePoeRecord, type PoeRecord } from "./poeHistory";
import { poeVerify } from "./api";
import { markPoeConfirmed } from "./poeHistory";

// History tab: every proof this wallet has created, with the picture and the
// details the chain can't remember.

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} bytes`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

export function PoeHistoryTab({ onVerify }: { onVerify: (rec: PoeRecord) => void }) {
  const [list, setList] = useState<PoeRecord[]>(() => loadPoeHistory());
  const [copied, setCopied] = useState<string | null>(null);

  // Anything still unconfirmed when the tab opens gets one check, so a proof
  // created moments ago doesn't sit looking pending forever.
  useEffect(() => {
    let alive = true;
    const pending = list.filter((r) => !r.confirmedAt);
    if (!pending.length) return;
    (async () => {
      let changed = false;
      for (const r of pending) {
        try {
          const p = await poeVerify(r.txid, r.hash);
          if (p.matched && p.block_time) {
            markPoeConfirmed(r.txid, p.block_time);
            changed = true;
          }
        } catch {
          /* offline or still unconfirmed */
        }
      }
      if (alive && changed) setList(loadPoeHistory());
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function copy(txid: string) {
    try {
      await navigator.clipboard.writeText(txid);
    } catch {
      /* still visible on screen */
    }
    setCopied(txid);
    setTimeout(() => setCopied(null), 1500);
  }

  function forget(txid: string) {
    removePoeRecord(txid);
    setList(loadPoeHistory());
  }

  if (!list.length) {
    return (
      <p className="wl-note">
        No timestamps yet. Create one in the first tab and it will appear here with its picture and
        details.
      </p>
    );
  }

  return (
    <div className="poe-hist">
      <p className="wl-note">
        Stored on this computer only — the blockchain records the fingerprint, not what the file was.
        Click any entry to check it against the original file.
      </p>

      <div className="poe-hist-grid">
        {list.map((r) => (
          <article key={r.txid} className="poe-card">
            <button
              className="poe-card-thumb"
              onClick={() => onVerify(r)}
              title="Verify this proof against the original file"
            >
              {r.thumb ? (
                <img src={r.thumb} alt={r.name} />
              ) : (
                <span className="poe-card-ext">{(r.name.split(".").pop() ?? "file").toUpperCase()}</span>
              )}
            </button>

            <div className="poe-card-body">
              <div className="poe-card-name" title={r.name}>
                {r.name}
              </div>
              <div className="poe-card-sub">
                {fmtBytes(r.size)}
                {r.width && r.height ? ` · ${r.width}×${r.height}` : ""}
              </div>
              <div className={r.confirmedAt ? "poe-card-when ok" : "poe-card-when pending"}>
                {r.confirmedAt
                  ? `Proven ${new Date(r.confirmedAt * 1000).toLocaleDateString()}`
                  : "Awaiting confirmation"}
              </div>
              <code className="poe-card-txid" title={r.txid}>
                {r.txid.slice(0, 10)}…{r.txid.slice(-8)}
              </code>
              <div className="poe-card-actions">
                <button className="wl-btn" onClick={() => onVerify(r)}>
                  Verify
                </button>
                <button className="wl-btn" onClick={() => copy(r.txid)}>
                  {copied === r.txid ? "Copied ✓" : "Copy id"}
                </button>
                <button className="wl-btn poe-card-forget" onClick={() => forget(r.txid)} title="Remove from this list only — the proof stays on the blockchain forever">
                  Forget
                </button>
              </div>
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}
