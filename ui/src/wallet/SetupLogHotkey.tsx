import { useEffect, useState } from "react";
import { setupLogReport } from "./api";

// ⌘L (Ctrl+L on Windows/Linux) copies the FULL first-run setup log to the
// clipboard, so a new user whose install stalls can paste the whole diagnostic
// back in one go — no back-and-forth. The same copy routine backs the visible
// "Copy setup log" button in the setup panel, so it works whether or not the
// shortcut is discovered.
//
// The report contains no secrets (never the wallet password, seed phrase, keys,
// or the node's rpcpassword) — it is safe to paste anywhere.

/** Copy the setup log to the clipboard. Returns true on success. */
export async function copySetupLog(): Promise<boolean> {
  let text = "";
  try {
    text = await setupLogReport();
  } catch (e) {
    text = `Could not read the setup log: ${String(e)}`;
  }
  // Preferred path (secure context, which the Tauri app is).
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall through to the textarea fallback */
  }
  // Fallback for any context where the async clipboard API is unavailable.
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("style", "position:fixed;left:-9999px;top:0;opacity:0");
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

export default function SetupLogHotkey() {
  // A brief confirmation is intrinsic to the copy action the user just asked
  // for (⌘L), not an unsolicited notification: it tells them the paste is ready.
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    let hideTimer: number | undefined;
    const onKey = async (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.altKey) return;
      if (e.key.toLowerCase() !== "l") return;
      e.preventDefault();
      const ok = await copySetupLog();
      setNote(ok ? "Setup log copied — paste it to Geoff" : "Could not copy the setup log");
      window.clearTimeout(hideTimer);
      hideTimer = window.setTimeout(() => setNote(null), 3200);
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.clearTimeout(hideTimer);
    };
  }, []);

  if (!note) return null;
  return (
    <div
      style={{
        position: "fixed",
        bottom: 18,
        left: "50%",
        transform: "translateX(-50%)",
        zIndex: 99999,
        padding: "8px 16px",
        borderRadius: 10,
        background: "rgba(20,14,30,0.94)",
        border: "1px solid rgba(233,64,181,0.55)",
        boxShadow: "0 4px 18px rgba(233,64,181,0.28)",
        color: "#f3e9ff",
        font: "13px/1.2 ui-sans-serif, system-ui, sans-serif",
        pointerEvents: "none",
      }}
    >
      {note}
    </div>
  );
}
