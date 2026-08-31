import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { AdminOverlay } from "./AdminOverlay";
import { Icon } from "../Icon";

// The purple gear, fixed bottom-right, that opens the admin panels (Style/skins).
export function AdminGear() {
  const [open, setOpen] = useState(false);
  const [panel, setPanel] = useState<string | undefined>(undefined);

  // Anywhere in the app can send someone straight to the setting they need,
  // rather than describing where it is and hoping.
  useEffect(() => {
    const go = (e: Event) => {
      setPanel((e as CustomEvent<string>).detail);
      setOpen(true);
    };
    window.addEventListener("dd69:openadmin", go);
    return () => window.removeEventListener("dd69:openadmin", go);
  }, []);

  return (
    <>
      <button
        type="button"
        aria-label="Open admin settings"
        className="admin-gear"
        onClick={() => { setPanel(undefined); setOpen(true); }}
      >
        <Icon name="gear" size={14} />
      </button>
      {/* Portal to body: the sidebar's backdrop-filter would otherwise trap the
          fixed overlay inside the sidebar. */}
      {open &&
        createPortal(
          <AdminOverlay initialPanel={panel} onClose={() => setOpen(false)} />,
          document.body,
        )}
    </>
  );
}
