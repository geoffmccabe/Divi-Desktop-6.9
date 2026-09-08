// A section with a clickable title that folds its body away. Matches the app's
// ts-section / ts-head styling so it looks native. Used for Run Market Maker and
// Trade History, both default-open.

import { useState, type ReactNode } from "react";
import "./collapsible.css";

export function Collapsible({ title, defaultOpen = true, children }: {
  title: string; defaultOpen?: boolean; children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="ts-section clp">
      <button type="button" className="clp-head" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <span className={"clp-chevron" + (open ? " clp-open" : "")}>▸</span>
        <h3 className="ts-head clp-title">{title}</h3>
      </button>
      {open && <div className="clp-body">{children}</div>}
    </section>
  );
}
