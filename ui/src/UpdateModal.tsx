import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { invoke } from "./tauri";
import { securityTools, updateInstall, type UpdateInfo } from "./wallet/api";

// The center modal opened from the flashing "UPDATE TO vX.Y.Z" in the sidebar.
// Built on the app's own modal shell (poe-modal-*) so it matches every other
// dialog in the wallet.
//
// The update installs IN PLACE via the Tauri updater: no browser download, so
// macOS never re-applies the quarantine tag and the user doesn't have to
// re-approve the app. Every byte is verified against our public key first.
// Progress arrives as `dd69://update-progress` events while it downloads.
//
// A manual download stays available as a fallback if the in-place update fails.

type Phase = "idle" | "working" | "ready" | "failed";

const mb = (n: number) => `${(n / 1_048_576).toFixed(1)} MB`;

export function UpdateModal({ info, onClose }: { info: UpdateInfo; onClose: () => void }) {
  const [tools, setTools] = useState<string[] | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [got, setGot] = useState(0);
  const [total, setTotal] = useState<number | null>(null);
  const [err, setErr] = useState("");
  const unlisten = useRef<Array<() => void>>([]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && phase !== "working" && onClose();
    window.addEventListener("keydown", onKey);
    securityTools().then(setTools).catch(() => setTools([]));

    // Subscribe to the updater's progress. Uses the global Tauri event API
    // (withGlobalTauri); guarded so a missing API can never break the modal.
    const ev = (window as unknown as { __TAURI__?: { event?: { listen: (n: string, cb: (e: { payload: unknown }) => void) => Promise<() => void> } } }).__TAURI__?.event;
    if (ev) {
      ev.listen("dd69://update-progress", (e) => {
        const p = e.payload as { downloaded?: number; total?: number | null };
        if (typeof p?.downloaded === "number") setGot(p.downloaded);
        setTotal(typeof p?.total === "number" ? p.total : null);
      }).then((u) => unlisten.current.push(u)).catch(() => {});
      ev.listen("dd69://update-ready", () => setPhase("ready"))
        .then((u) => unlisten.current.push(u)).catch(() => {});
    }
    return () => {
      window.removeEventListener("keydown", onKey);
      unlisten.current.forEach((u) => { try { u(); } catch { /* already gone */ } });
      unlisten.current = [];
    };
  }, [onClose, phase]);

  const run = async () => {
    setPhase("working"); setErr(""); setGot(0);
    try {
      await updateInstall();
      setPhase("ready");
    } catch (e) {
      setErr(String(e)); setPhase("failed");
    }
  };

  const isMac = info.os === "mac";
  const isWin = info.os === "windows";
  const url = info.downloadUrl;
  const pct = total && total > 0 ? Math.min(100, (got / total) * 100) : null;

  return createPortal(
    <div className="poe-modal-backdrop" onClick={() => phase !== "working" && onClose()} role="presentation">
      <div
        className="poe-modal upd-modal"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Software update"
      >
        <div className="poe-modal-head">
          <h3>{phase === "ready" ? "Update installed" : "Update available"}</h3>
          {phase !== "working" && (
            <button className="wl-btn poe-modal-x" onClick={onClose} aria-label="Close">✕</button>
          )}
        </div>

        <div className="poe-modal-body">
          <div className="upd-jump">
            <span className="upd-cur">v{info.current}</span>
            <span className="upd-arrow">→</span>
            <span className="upd-new">v{info.latest}</span>
          </div>

          {phase === "ready" ? (
            <p className="wl-note">
              Version {info.latest} is installed. <strong>Quit and reopen Divi Desktop</strong> to
              finish — your node keeps running in the meantime.
            </p>
          ) : (
            <>
              {/* Firewall / antivirus pre-warning. */}
              {tools && tools.length > 0 && (
                <div className="upd-warn">
                  <b>Heads up:</b> you have <strong>{tools.join(", ")}</strong> installed. It may ask
                  about network access after the update — choose <strong>Allow</strong> so the wallet
                  can reach the Divi network. That's expected.
                </div>
              )}
              {isMac && (
                <p className="wl-note">
                  This updates in place, so macOS won't ask you to approve the app again.
                </p>
              )}
              {isWin && (
                <p className="wl-note">
                  This updates in place. Windows may show a permission prompt for the installer —
                  that's normal.
                </p>
              )}
            </>
          )}

          {/* Live download progress. */}
          {phase === "working" && (
            <div className="upd-prog">
              <div className="upd-bar">
                <div className="upd-bar-fill" style={pct == null ? { width: "100%", opacity: 0.5 } : { width: `${pct}%` }} />
              </div>
              <span className="upd-prog-text">
                {total ? `${mb(got)} of ${mb(total)}${pct != null ? ` · ${pct.toFixed(0)}%` : ""}` : `${mb(got)} downloaded…`}
              </span>
            </div>
          )}

          {phase === "failed" && (
            <div className="upd-warn">
              <b>The in-place update didn't work:</b> {err}
              {url ? " You can still download it manually below." : ""}
            </div>
          )}

          <div className="upd-actions">
            {phase === "idle" && (
              <button className="upd-go" onClick={run}>Update now</button>
            )}
            {phase === "working" && <span className="wl-note">Downloading and installing…</span>}
            {phase === "failed" && url && (
              <button className="upd-go" onClick={() => invoke("open_url", { url })}>
                Download v{info.latest} manually
              </button>
            )}
            {phase !== "working" && (
              <button className="wl-btn" onClick={onClose}>
                {phase === "ready" ? "Close" : "Later"}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
