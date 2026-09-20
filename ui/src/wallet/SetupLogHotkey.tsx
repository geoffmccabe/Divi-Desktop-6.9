import { useEffect, useState } from "react";
import { saveSetupLog, setupLogReport } from "./api";

// ⌘L (Ctrl+L on Windows/Linux) copies the FULL first-run setup log to the
// clipboard, so a new user whose install stalls can paste the whole diagnostic
// back in one go — no back-and-forth. The same copy routine backs the visible
// "Copy setup log" button in the setup panel, so it works whether or not the
// shortcut is discovered.
//
// The report contains no secrets (never the wallet password, seed phrase, keys,
// or the node's rpcpassword) — it is safe to paste anywhere.

// ── WHY THIS KEEPS A COPY OF THE LOG IN MEMORY ─────────────────────────────
//
// WebKit only lets a page write to the clipboard while the keystroke that
// asked for it is still "live" — a few milliseconds of what the platform
// calls user activation. The old code pressed ⌘L, then went and FETCHED the
// log (a round trip into the Rust side), and only then tried to write. By
// then the activation had lapsed and WebKit refused, every time, which is
// what Geoff saw on 2026-Sep-20: "Could not copy the setup log".
//
// So the text is kept ready in advance and refreshed quietly in the
// background. When the key is pressed there is nothing to wait for and the
// write happens inside the keystroke, where it is allowed.

/** The most recent report, fetched ahead of time so ⌘L never has to wait. */
let ready = "";
let refreshing = false;

/** Fetch the report into `ready`. Safe to call often; overlapping calls fold. */
export async function refreshSetupLog(): Promise<void> {
  if (refreshing) return;
  refreshing = true;
  try {
    ready = await setupLogReport();
  } catch (e) {
    ready = `Could not read the setup log: ${String(e)}`;
  } finally {
    refreshing = false;
  }
}

export type CopyOutcome =
  | { ok: true }
  /** Not copied. `savedTo` is the file it was written to instead, if that
      worked; `why` always says what the clipboard's objection was. */
  | { ok: false; savedTo: string | null; why: string };

/**
 * Put the setup log on the clipboard.
 *
 * Must be called from inside a real click or keypress, and must not be
 * awaited on anything beforehand, or the clipboard write will be refused.
 * If it is refused anyway, the log is written to a file on the Desktop so
 * there is always some way to get it out of the app.
 */
export function copySetupLogNow(): Promise<CopyOutcome> {
  const text = ready || "(the setup log had not loaded yet — try again in a moment)";

  // Synchronous fallback first if the async API is missing entirely.
  const viaTextarea = (): boolean => {
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
  };

  const rescue = async (why: string): Promise<CopyOutcome> => {
    if (viaTextarea()) return { ok: true };
    try {
      return { ok: false, savedTo: await saveSetupLog(), why };
    } catch {
      return { ok: false, savedTo: null, why };
    }
  };

  if (!navigator.clipboard?.writeText) return rescue("this window cannot use the clipboard");
  // NOTE: no await before this line. That is the whole point.
  return navigator.clipboard
    .writeText(text)
    .then<CopyOutcome>(() => ({ ok: true }))
    .catch((e) => rescue(String(e)));
}

/** Kept for the existing callers; prefer copySetupLogNow, which says why. */
export async function copySetupLog(): Promise<boolean> {
  if (!ready) await refreshSetupLog();
  const r = await copySetupLogNow();
  return r.ok;
}

export default function SetupLogHotkey() {
  // A brief confirmation is intrinsic to the copy action the user just asked
  // for (⌘L), not an unsolicited notification: it tells them the paste is ready.
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    let hideTimer: number | undefined;

    // Keep the report warm so the keystroke has nothing to wait for. Thirty
    // seconds is plenty: this log changes only when the node is started,
    // stopped or reconfigured.
    void refreshSetupLog();
    const warm = window.setInterval(() => void refreshSetupLog(), 30_000);

    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.altKey) return;
      if (e.key.toLowerCase() !== "l") return;
      e.preventDefault();
      // Fired synchronously, inside the keystroke. See the note above.
      void copySetupLogNow().then((r) => {
        setNote(
          r.ok
            ? "Setup log copied — paste it to Geoff"
            : r.savedTo
              ? `Clipboard refused — saved it to ${r.savedTo} instead`
              : `Could not copy the setup log: ${r.why}`,
        );
        window.clearTimeout(hideTimer);
        // A file path takes longer to read than a three-word confirmation.
        hideTimer = window.setTimeout(() => setNote(null), r.ok ? 3200 : 9000);
      });
      // Next time round, start from fresh text.
      void refreshSetupLog();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.clearInterval(warm);
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
