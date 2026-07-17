import { useEffect, useState } from "react";
import { type AddrInfo } from "./api";
import { loadNames, setName } from "./addressNames";
import { Icon } from "../Icon";

function AddressRow({ a }: { a: AddrInfo }) {
  const [names, setNames] = useState<Record<string, string>>(() => loadNames());
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(a.address);
    } catch {
      /* clipboard unavailable */
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  };

  return (
    <li className="addr-row">
      <div className="addr-row-top">
        <input
          className="addr-name"
          placeholder="Name this address…"
          value={names[a.address] ?? ""}
          onChange={(e) => setNames(setName(a.address, e.target.value))}
        />
        {a.isMain && <span className="addr-main-badge">Main</span>}
        <button type="button" className="icon-btn" title={copied ? "Copied!" : "Copy address"} onClick={copy}>
          <Icon name="copy" size={14} />
        </button>
      </div>
      <div className="addr-full">{a.address}</div>
      <div className="addr-counts">
        <span>{a.receives} received</span>
        <span>{a.sends} sent</span>
        <span>{a.stakes} stakes</span>
      </div>
    </li>
  );
}

export function AddressDropdown({
  open,
  addresses,
}: {
  open: boolean;
  addresses: AddrInfo[] | null;
}) {
  // Keep it mounted so the max-height transition can animate open/closed.
  const [render, setRender] = useState(open);
  useEffect(() => {
    if (open) setRender(true);
  }, [open]);

  if (!render) return null;
  const list = addresses ?? [];

  return (
    <div
      className={"addr-dropdown glass-panel" + (open ? " addr-dropdown-open" : "")}
      onTransitionEnd={() => {
        if (!open) setRender(false);
      }}
    >
      <div className="addr-dropdown-inner">
        {list.length === 0 ? (
          <p className="wl-empty">Loading addresses…</p>
        ) : (
          <ul className="addr-list">
            {list.map((a) => (
              <AddressRow key={a.address} a={a} />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
