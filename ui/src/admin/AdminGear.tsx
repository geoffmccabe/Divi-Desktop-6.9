import { useState } from "react";
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
        <Icon name="gear" size={22} />
      </button>
      {open && <AdminOverlay onClose={() => setOpen(false)} />}
    </>
  );
}
