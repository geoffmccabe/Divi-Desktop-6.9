import { useState } from "react";
import { validateAddress } from "./api";
import { upsertContact, TYPE_LABEL, type Contact, type ContactType } from "./contacts";

type Valid = "unknown" | "checking" | "ok" | "bad";

// Add or edit a contact. Addresses are validated against the node so a typo is
// caught before you ever save it (and long before you ever send to it).
export function ContactEditor({
  contact,
  onDone,
}: {
  contact?: Contact;
  onDone: (list?: Contact[]) => void;
}) {
  const [name, setName] = useState(contact?.name ?? "");
  const [type, setType] = useState<ContactType>(contact?.type ?? "person");
  const [emoji, setEmoji] = useState(contact?.emoji ?? "");
  const [note, setNote] = useState(contact?.note ?? "");
  const [rows, setRows] = useState<{ address: string; label: string }[]>(
    contact?.addresses.length
      ? contact.addresses.map((a) => ({ address: a.address, label: a.label ?? "" }))
      : [{ address: "", label: "" }]
  );
  const [valid, setValid] = useState<Record<number, Valid>>({});
  const [err, setErr] = useState<string | null>(null);

  const setRow = (i: number, patch: Partial<{ address: string; label: string }>) =>
    setRows((r) => r.map((x, j) => (j === i ? { ...x, ...patch } : x)));

  const check = async (i: number) => {
    const a = rows[i]?.address.trim();
    if (!a) return setValid((v) => ({ ...v, [i]: "unknown" }));
    setValid((v) => ({ ...v, [i]: "checking" }));
    try {
      const ok = await validateAddress(a);
      setValid((v) => ({ ...v, [i]: ok ? "ok" : "bad" }));
    } catch {
      setValid((v) => ({ ...v, [i]: "unknown" }));
    }
  };

  const save = async () => {
    setErr(null);
    if (!name.trim()) return setErr("Give this contact a name.");
    const addrs = rows.map((r) => ({ address: r.address.trim(), label: r.label.trim() || undefined })).filter((r) => r.address);
    if (!addrs.length) return setErr("Add at least one address.");
    // Validate every address against the node now, not just the ones that were
    // blurred, so a pasted typo can't slip in unchecked. If the node is
    // unreachable we allow the save (send-time validation is the backstop).
    for (const a of addrs) {
      try {
        if (!(await validateAddress(a.address))) return setErr(`Not a valid DIVI address: ${a.address}`);
      } catch {
        /* node unreachable; let it save and rely on send-time validation */
      }
    }
    const list = upsertContact({
      id: contact?.id,
      name: name.trim(),
      type,
      emoji: emoji.trim() || undefined,
      note: note.trim() || undefined,
      addresses: addrs,
      favorite: contact?.favorite,
      sentCount: contact?.sentCount,
      lastSentAt: contact?.lastSentAt,
    });
    onDone(list);
  };

  return (
    <div className="cb-editor glass-panel">
      <div className="cb-editor-head">{contact ? "Edit contact" : "New contact"}</div>

      <label className="send-field">
        <span className="send-label">Name</span>
        <input className="wl-input" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Alice, DiviGo, My laptop" autoFocus />
      </label>

      <div className="send-field">
        <span className="send-label">Type</span>
        <div className="send-mode cb-types">
          {(Object.keys(TYPE_LABEL) as ContactType[]).map((t) => (
            <button key={t} type="button" className={type === t ? "on" : ""} onClick={() => setType(t)}>
              {TYPE_LABEL[t]}
            </button>
          ))}
        </div>
      </div>

      <label className="send-field">
        <span className="send-label">Avatar emoji (optional)</span>
        <input className="wl-input cb-emoji" value={emoji} onChange={(e) => setEmoji([...e.target.value].slice(0, 2).join(""))} placeholder="🙂 (leave blank for an identicon)" />
      </label>

      <div className="send-field">
        <span className="send-label">Addresses</span>
        {rows.map((r, i) => (
          <div className="cb-addr-row" key={i}>
            <input
              className="wl-input"
              value={r.address}
              onChange={(e) => setRow(i, { address: e.target.value })}
              onBlur={() => check(i)}
              placeholder="D…"
              spellCheck={false}
            />
            <input className="wl-input cb-addr-label" value={r.label} onChange={(e) => setRow(i, { label: e.target.value })} placeholder="label" />
            <span className={"cb-valid cb-" + (valid[i] ?? "unknown")}>
              {valid[i] === "ok" ? "✓" : valid[i] === "bad" ? "✕" : valid[i] === "checking" ? "…" : ""}
            </span>
            {rows.length > 1 && (
              <button type="button" className="icon-btn" title="Remove" onClick={() => setRows((rr) => rr.filter((_, j) => j !== i))}>
                ✕
              </button>
            )}
          </div>
        ))}
        <button type="button" className="wl-link" onClick={() => setRows((r) => [...r, { address: "", label: "" }])}>
          + Add another address
        </button>
      </div>

      <label className="send-field">
        <span className="send-label">Note (optional)</span>
        <textarea className="wl-input cb-note" value={note} onChange={(e) => setNote(e.target.value)} rows={2} placeholder="Anything you want to remember about them" />
      </label>

      {err && <p className="wl-err">{err}</p>}
      <div className="send-actions">
        <button type="button" className="wl-btn" onClick={() => onDone()}>Cancel</button>
        <button type="button" className="wl-btn wl-btn-primary" onClick={save}>Save contact</button>
      </div>
    </div>
  );
}
