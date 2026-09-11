import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { invoke } from "./tauri";
import { securityTools, type UpdateInfo } from "./wallet/api";

// The center modal opened from the flashing "UPDATE TO vX.Y.Z" in the sidebar.
// It shows the version jump, warns about any firewall/antivirus that might
// prompt when the new build runs, and offers the download.
//
// NOTE: the seamless in-place download WITH a live KB/MB progress bar is the
// next slice — it needs the Tauri updater (signing key + CI manifest) so the
// app can replace itself without re-triggering the OS "unidentified app" block.
// Until that lands, this hands the user the correct installer for their OS. The
// firewall pre-warning is the part that's fully live now.

export function UpdateModal({ info, onClose }: { info: UpdateInfo; onClose: () => void }) {
  const [tools, setTools] = useState<string[] | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    securityTools().then(setTools).catch(() => setTools([]));
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const isMac = info.os === "mac";
  const isWin = info.os === "windows";

  return createPortal(
    <div className="dl-backdrop" onClick={onClose} role="presentation">
      <div className="upd-modal panel" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Software update">
        <div className="dl-head">
          <h3>Update available</h3>
          <button className="linkbtn" onClick={onClose} aria-label="Close">✕</button>
        </div>

        <div className="upd-body">
          <div className="upd-jump">
            <span className="upd-cur">v{info.current}</span>
            <span className="upd-arrow">→</span>
            <span className="upd-new">v{info.latest}</span>
          </div>

          {/* Firewall / antivirus pre-warning — the live part. */}
          {tools && tools.length > 0 && (
            <div className="upd-warn">
              <b>Heads up:</b> you have <strong>{tools.join(", ")}</strong> installed. When the
              updated app first runs, it may ask about network access — choose <strong>Allow</strong>
              {" "}so the wallet can reach the Divi network. That's expected, not a problem.
            </div>
          )}

          {/* OS-specific note. In-place updates usually skip the OS re-block; a
              fresh download may prompt once. */}
          {isMac && (
            <p className="upd-note">
              On macOS, if you re-download and it warns about an unidentified developer, open
              Terminal and run the one-line unlock from the download page, then open it once.
            </p>
          )}
          {isWin && (
            <p className="upd-note">
              On Windows, if SmartScreen shows a blue warning, click <strong>More info</strong> then{" "}
              <strong>Run anyway</strong> — the build is unsigned but safe.
            </p>
          )}

          <div className="upd-actions">
            {info.downloadUrl ? (
              <button className="upd-go" onClick={() => invoke("open_url", { url: info.downloadUrl })}>
                Download v{info.latest}
              </button>
            ) : (
              <span className="upd-note">Couldn't reach the download server — try again shortly.</span>
            )}
            <button className="linkbtn" onClick={onClose}>Later</button>
          </div>

          <p className="upd-soon">One-click in-app update (with a live progress bar, no re-download) is coming next.</p>
        </div>
      </div>
    </div>,
    document.body,
  );
}
