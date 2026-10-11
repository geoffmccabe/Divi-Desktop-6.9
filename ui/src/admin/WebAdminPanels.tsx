// The drawer the web door opens. Its own file so that it, the four panels and
// their stylesheets are a chunk the page loads only when an admin asks for it.
import { AdminOverlay } from "./AdminOverlay";
import { WEB_PANELS } from "./webPanels";

export default function WebAdminPanels({ onClose }: { onClose: () => void }) {
  return <AdminOverlay panels={WEB_PANELS} onClose={onClose} />;
}
