import { useState } from "react";
import { createPortal } from "react-dom";
import { AdminOverlay } from "./AdminOverlay";
import { Icon } from "../Icon";

// The purple gear, fixed bottom-right, that opens the admin panels (Style/skins).
export function AdminGear() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        aria-label="Open admin settings"
        className="admin-gear"
        onClick={() => setOpen(true)}
      >
        <Icon name="gear" size={14} />
      </button>
      {/* Portal to body: the sidebar's backdrop-filter would otherwise trap the
          fixed overlay inside the sidebar. */}
      {open && createPortal(<AdminOverlay onClose={() => setOpen(false)} />, document.body)}
    </>
  );
}
