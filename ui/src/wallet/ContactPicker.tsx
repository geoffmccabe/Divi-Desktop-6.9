import { useEffect, useRef, useState } from "react";
import { Identicon } from "./Identicon";
import { sortedContacts, TYPE_LABEL, type Contact } from "./contacts";

function short(a: string): string {
  return a.length > 16 ? `${a.slice(0, 6)}…${a.slice(-6)}` : a;
}

// A compact "pick from Contacts" dropdown for the Send field, so you fill the
// recipient by name instead of pasting. Disabled state mirrors the field.
export function ContactPicker({
  onPick,
  disabled,
}: {
  onPick: (address: string, name: string) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const list = sortedContacts();

  // Close the menu when clicking anywhere outside it.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  if (list.length === 0) return null;

  const pick = (c: Contact) => {
    const a = c.addresses[0]?.address;
    if (a) onPick(a, c.name);
    setOpen(false);
  };

  return (
    <div className="cp-wrap" ref={wrapRef}>
      <button type="button" className="cp-btn" disabled={disabled} onClick={() => setOpen((v) => !v)}>
        Contacts ▾
      </button>
      {open && (
        <div className="cp-menu glass-panel">
          {list.map((c) => (
            <button key={c.id} type="button" className="cp-item" onClick={() => pick(c)}>
              {c.emoji ? <span className="cb-emoji-avatar cp-emoji">{c.emoji}</span> : <Identicon address={c.addresses[0]?.address ?? c.id} size={22} />}
              <span className="cp-item-id">
                <span className="cp-item-name">
                  {c.name}
                  <span className={"cb-type cb-type-" + c.type}>{TYPE_LABEL[c.type]}</span>
                </span>
                <span className="cp-item-addr">{short(c.addresses[0]?.address ?? "")}</span>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
