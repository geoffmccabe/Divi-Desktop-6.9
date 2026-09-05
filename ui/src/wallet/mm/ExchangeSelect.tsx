// A custom exchange picker. A native <select>'s option list is OS-drawn (grey) on
// macOS WebKit and can't be themed, so this is a button + styled dropdown that
// matches the app. All exchanges are listed; unconnected ones are greyed, labeled
// "(not connected)", and not selectable.

import { useEffect, useRef, useState } from "react";
import type { Exchange } from "../exchanges";
import { Icon } from "../../Icon";
import "./exchange-select.css";

export function ExchangeSelect({ exchanges, connected, value, onChange }: {
  exchanges: Exchange[];
  connected: Record<string, boolean>;
  value: string;
  onChange: (slug: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const sel = exchanges.find((x) => x.slug === value);
  const label = (x: Exchange) => `${x.name}: ${x.pairs[0] ?? ""}`;

  return (
    <div className="xsel" ref={ref}>
      <button type="button" className="wl-input xsel-btn" onClick={() => setOpen((o) => !o)}>
        <span className="xsel-cur-label">{sel ? label(sel) : "Select exchange"}</span>
        <Icon name="chevronDown" size={14} />
      </button>
      {open && (
        <ul className="xsel-list">
          {exchanges.map((x) => {
            const on = connected[x.slug];
            return (
              <li key={x.slug}>
                <button
                  type="button"
                  className={"xsel-opt" + (on ? "" : " xsel-off") + (x.slug === value ? " xsel-sel" : "")}
                  disabled={!on}
                  onClick={() => { if (on) { onChange(x.slug); setOpen(false); } }}
                >
                  {label(x)}{on ? "" : "  (not connected)"}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
