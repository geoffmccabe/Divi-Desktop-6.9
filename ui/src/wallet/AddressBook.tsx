import { useEffect, useMemo, useState } from "react";
import { addressQr } from "./api";
import { Icon } from "../Icon";
import { Identicon } from "./Identicon";
import { ContactEditor } from "./ContactEditor";
import { setSendTarget } from "./sendTarget";
import {
  sortedContacts,
  removeContact,
  toggleFavorite,
  TYPE_LABEL,
  type Contact,
} from "./contacts";

function shortAddr(a: string): string {
  return a.length > 16 ? `${a.slice(0, 8)}…${a.slice(-6)}` : a;
}

function Avatar({ c }: { c: Contact }) {
  if (c.emoji) return <span className="cb-emoji-avatar">{c.emoji}</span>;
  return <Identicon address={c.addresses[0]?.address ?? c.id} size={34} />;
}

function QrOverlay({ address, name, onClose }: { address: string; name: string; onClose: () => void }) {
  const [qr, setQr] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    addressQr(address).then((s) => alive && setQr(s)).catch(() => alive && setQr(""));
    return () => {
      alive = false;
    };
  }, [address]);
  return (
    <div className="cb-qr-overlay" onClick={onClose}>
      <div className="cb-qr-card glass-panel" onClick={(e) => e.stopPropagation()}>
        <div className="cb-qr-name">{name}</div>
        {qr == null ? (
          <p className="wl-empty">Making QR…</p>
        ) : qr.startsWith("<svg") ? (
          <div className="cb-qr-img" dangerouslySetInnerHTML={{ __html: qr }} />
        ) : (
          <img className="cb-qr-img" src={qr} alt="address QR" />
        )}
        <div className="cb-qr-addr">{address}</div>
        <button type="button" className="wl-btn" onClick={onClose}>Close</button>
      </div>
    </div>
  );
}

function ContactCard({
  c,
  onChange,
  onEdit,
  onQr,
}: {
  c: Contact;
  onChange: (list: Contact[]) => void;
  onEdit: (c: Contact) => void;
  onQr: (address: string, name: string) => void;
}) {
  const [copied, setCopied] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const primary = c.addresses[0]?.address ?? "";

  const copy = async (a: string) => {
    try {
      await navigator.clipboard.writeText(a);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      /* clipboard unavailable */
    }
  };

  return (
    <div className="cb-card">
      <div className="cb-card-main">
        <Avatar c={c} />
        <div className="cb-card-id">
          <div className="cb-card-name">
            {c.name}
            <span className={"cb-type cb-type-" + c.type}>{TYPE_LABEL[c.type]}</span>
            {(c.sentCount ?? 0) > 0 && <span className="cb-known" title="You've sent here before">✓ known</span>}
          </div>
          <button className="cb-addr" title={copied ? "Copied!" : "Copy"} onClick={() => copy(primary)}>
            {shortAddr(primary)} <Icon name="copy" size={12} />
          </button>
          {c.note && <div className="cb-note-text">{c.note}</div>}
        </div>
        <button
          type="button"
          className={"cb-star" + (c.favorite ? " on" : "")}
          title={c.favorite ? "Unfavorite" : "Favorite"}
          onClick={() => onChange(toggleFavorite(c.id))}
        >
          ★
        </button>
      </div>

      {c.addresses.length > 1 && (
        <button type="button" className="wl-link cb-more" onClick={() => setExpanded((v) => !v)}>
          {expanded ? "Hide" : `+${c.addresses.length - 1} more address${c.addresses.length - 1 > 1 ? "es" : ""}`}
        </button>
      )}
      {expanded &&
        c.addresses.slice(1).map((a) => (
          <button key={a.address} className="cb-addr cb-addr-extra" onClick={() => copy(a.address)}>
            {a.label ? <span className="cb-addr-lbl">{a.label}</span> : null}
            {shortAddr(a.address)} <Icon name="copy" size={12} />
          </button>
        ))}

      <div className="cb-card-actions">
        <button type="button" className="wl-btn wl-btn-primary cb-send" onClick={() => setSendTarget(primary, c.name)}>
          <Icon name="send" size={13} /> Send
        </button>
        <button type="button" className="wl-btn" onClick={() => onQr(primary, c.name)} title="Show QR">
          QR
        </button>
        <button type="button" className="wl-btn" onClick={() => onEdit(c)} title="Edit">
          Edit
        </button>
        <button
          type="button"
          className="wl-btn cb-del"
          title="Delete"
          onClick={() => {
            if (confirm(`Delete contact "${c.name}"? This only removes the label, never any coins.`)) onChange(removeContact(c.id));
          }}
        >
          ✕
        </button>
      </div>
    </div>
  );
}

export function AddressBook() {
  const [list, setList] = useState<Contact[]>(() => sortedContacts());
  const [q, setQ] = useState("");
  const [editing, setEditing] = useState<Contact | "new" | null>(null);
  const [qr, setQr] = useState<{ address: string; name: string } | null>(null);

  const refresh = (l?: Contact[]) => setList(sortedContacts(l));

  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return list;
    return list.filter(
      (c) =>
        c.name.toLowerCase().includes(s) ||
        c.addresses.some((a) => a.address.toLowerCase().includes(s) || (a.label ?? "").toLowerCase().includes(s))
    );
  }, [list, q]);

  if (editing) {
    return (
      <ContactEditor
        contact={editing === "new" ? undefined : editing}
        onDone={(l) => {
          if (l) refresh(l);
          setEditing(null);
        }}
      />
    );
  }

  return (
    <div className="cb-panel">
      <div className="cb-toolbar">
        <input className="wl-input cb-search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search contacts…" />
        <button type="button" className="wl-btn wl-btn-primary" onClick={() => setEditing("new")}>
          + Add contact
        </button>
      </div>

      {list.length === 0 ? (
        <div className="wl-stub">
          <p>No contacts yet.</p>
          <p className="wl-note">Add the people, services, and your own other wallets you send to, so you pick a name instead of pasting an address.</p>
        </div>
      ) : shown.length === 0 ? (
        <p className="wl-empty">No contacts match “{q}”.</p>
      ) : (
        <div className="cb-list">
          {shown.map((c) => (
            <ContactCard key={c.id} c={c} onChange={refresh} onEdit={(x) => setEditing(x)} onQr={(address, name) => setQr({ address, name })} />
          ))}
        </div>
      )}

      {qr && <QrOverlay address={qr.address} name={qr.name} onClose={() => setQr(null)} />}
    </div>
  );
}
