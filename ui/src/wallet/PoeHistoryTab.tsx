import { useEffect, useRef, useState } from "react";
import {
  buildPoeExport,
  loadPoeHistory,
  markPoeConfirmed,
  mergePoeImport,
  parsePoeExport,
  poeProjects,
  removePoeRecord,
  updatePoeRecord,
  type PoeRecord,
} from "./poeHistory";
import { poeVerify } from "./api";

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
  const [filter, setFilter] = useState<string>("");
  const [note, setNote] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const importRef = useRef<HTMLInputElement>(null);

  const projects = poeProjects(list);
  const shown = filter ? list.filter((r) => (r.project || "") === filter) : list;

  // One JSON file holding every proof, its labelling and any shareable preview.
  // This is the only backup of the context the chain cannot remember, so it is
  // also the answer to a lost laptop.
  function exportJson() {
    const data = buildPoeExport(list);
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `divi-proofs-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    setNote(`Exported ${data.count} proof${data.count === 1 ? "" : "s"}.`);
  }

  async function importJson(f: File) {
    const { records, error } = parsePoeExport(await f.text());
    if (error) {
      setNote(error);
      return;
    }
    const { added, updated, saved } = mergePoeImport(records);
    setList(loadPoeHistory());
    setNote(
      saved
        ? `Restored ${added} new proof${added === 1 ? "" : "s"}${updated ? `, kept ${updated} already here` : ""}.`
        : "Storage is full, so the import could not be saved.",
    );
  }

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

  function relabel(txid: string, patch: Partial<PoeRecord>) {
    updatePoeRecord(txid, patch);
    setList(loadPoeHistory());
  }

  const importControl = (
    <>
      <input
        ref={importRef}
        type="file"
        accept="application/json,.json"
        style={{ display: "none" }}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) importJson(f);
          e.target.value = "";
        }}
      />
      <button className="wl-btn" onClick={() => importRef.current?.click()}>
        Restore from JSON
      </button>
    </>
  );

  if (!list.length) {
    return (
      <div className="poe-hist">
        <p className="wl-note">
          No timestamps yet. Create one in the first tab and it will appear here with its picture and details.
        </p>
        <p className="wl-note">
          Already have proofs from another computer? Restore them from a JSON export and they come back with their
          projects, titles and previews.
        </p>
        <div style={{ marginTop: 8 }}>{importControl}</div>
        {note && <p className="wl-note">{note}</p>}
      </div>
    );
  }

  return (
    <div className="poe-hist">
      <p className="wl-note">
        Stored on this computer only. The blockchain records the fingerprint, not what the file was, so this list is
        the only copy of that context. Export it.
      </p>

      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", margin: "8px 0" }}>
        <button className="wl-btn" onClick={exportJson}>
          Export all as JSON
        </button>
        {importControl}
        {projects.length > 0 && (
          <select
            className="wl-input"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            style={{ marginLeft: "auto" }}
          >
            <option value="">All projects ({list.length})</option>
            {projects.map((p) => (
              <option key={p} value={p}>
                {p} ({list.filter((r) => r.project === p).length})
              </option>
            ))}
          </select>
        )}
      </div>
      {note && <p className="wl-note">{note}</p>}

      <div className="poe-hist-grid">
        {shown.map((r) => (
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
              {editing === r.txid ? (
                <div style={{ display: "grid", gap: 4, marginBottom: 4 }}>
                  <input
                    className="wl-input"
                    placeholder="Project"
                    defaultValue={r.project ?? ""}
                    onBlur={(e) => relabel(r.txid, { project: e.target.value.trim() || undefined })}
                  />
                  <input
                    className="wl-input"
                    placeholder="Title"
                    defaultValue={r.title ?? ""}
                    onBlur={(e) => relabel(r.txid, { title: e.target.value.trim() || undefined })}
                  />
                  <button className="wl-btn" onClick={() => setEditing(null)}>
                    Done
                  </button>
                </div>
              ) : (
                <>
                  {r.project && <div className="poe-card-sub" style={{ opacity: 0.8 }}>{r.project}</div>}
                  <div className="poe-card-name" title={r.title || r.name}>
                    {r.title || r.name}
                  </div>
                  {r.title && (
                    <div className="poe-card-sub" title={r.name}>
                      {r.name}
                    </div>
                  )}
                </>
              )}
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
                <button className="wl-btn" onClick={() => setEditing(editing === r.txid ? null : r.txid)}>
                  {editing === r.txid ? "Close" : "Label"}
                </button>
                <button
                  className="wl-btn poe-card-forget"
                  onClick={() => forget(r.txid)}
                  title="Remove from this list only. The proof stays on the blockchain forever."
                >
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
