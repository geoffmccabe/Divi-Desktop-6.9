import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Icon } from "../Icon";
import { attachBroker, type BrokerLogEntry } from "./broker";
import { immersiveMode } from "./manifest";
import { grant, grantedFor, isFullyGranted } from "./grants";
import { sortForDisplay } from "./permissions";
import type { CatalogEntry } from "./catalog";

// Runs one community app.
//
// The frame carries `sandbox` WITHOUT `allow-same-origin`, which is the single
// most important line in this file. It puts the app in an opaque origin, so it
// cannot read the wallet's DOM, cannot touch its storage, and cannot see
// `window.__TAURI__`. Everything it can do arrives through the broker.
//
// Payment confirmation is drawn HERE, by the wallet, outside the frame. The app
// can ask; it cannot render the dialog, style it, or click it.

export function AppHost({
  entry,
  onExit,
  exitLabel = "Back to apps",
}: {
  entry: CatalogEntry;
  onExit: () => void;
  /** What leaving means here. "Back to apps" is wrong when previewing a build. */
  exitLabel?: string;
}) {
  const m = entry.manifest;
  const frameRef = useRef<HTMLIFrameElement | null>(null);
  const [consented, setConsented] = useState(() => isFullyGranted(m.id, m.permissions));
  const [immersive, setImmersive] = useState(() => immersiveMode(m) === "always");

  // Ask the shell to fold its chrome away. An overlay of our own cannot work
  // here: .main-panel has a backdrop-filter, which makes it the containing block
  // for any fixed-position child, so a "full window" layer is trapped inside the
  // panel and looks like a small box. Folding the chrome gives the app the real
  // window and keeps the wallet one click away.
  useEffect(() => {
    window.dispatchEvent(new CustomEvent("dd69:focusmode", { detail: immersive }));
    return () => {
      window.dispatchEvent(new CustomEvent("dd69:focusmode", { detail: false }));
    };
  }, [immersive]);
  const [pay, setPay] = useState<{ amount: number; reason: string; resolve: (ok: boolean) => void } | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  // An app's own crash report. Nothing outside a sandboxed frame can see an
  // error inside it, so without the app telling us, a broken app and a slow one
  // look exactly the same.
  const [crash, setCrash] = useState<{ message: string; where: string } | null>(null);

  const confirmPayment = useCallback(
    (amount: number, reason: string) =>
      new Promise<boolean>((resolve) => setPay({ amount, reason, resolve })),
    [],
  );

  const notify = useCallback((text: string) => {
    setToast(text);
    setTimeout(() => setToast(null), 4000);
  }, []);

  useEffect(() => {
    if (!consented) return;
    const frame = frameRef.current;
    if (!frame) return;
    const detach = attachBroker({
      frame,
      manifest: m,
      granted: grantedFor(m.id),
      ctx: { confirmPayment, notify },
      onAppError: (message, where) => setCrash({ message, where }),
      onLog: (e: BrokerLogEntry) => {
        // Kept quiet in normal use; the admin gates panel will surface these.
        if (e.outcome !== "ok") console.warn("[community app]", e.appId, e.method, e.reason);
      },
    });
    return detach;
  }, [consented, m, confirmPayment, notify]);

  if (!consented) {
    return <PermissionPrompt entry={entry} onAllow={() => { grant(m.id, m.permissions, m.version); setConsented(true); }} onCancel={onExit} />;
  }

  const canToggleImmersive = immersiveMode(m) === "on-demand";

  return (
    <div className={immersive ? "ca-host ca-host-focus" : "ca-host"}>
      <div className="ca-host-bar">
        <button type="button" className="wl-btn" onClick={onExit}>
          <Icon name="overview" size={14} /> {exitLabel}
        </button>
        <span className="ca-host-title">{m.name}</span>
        <span className="ca-host-spacer" />
        {toast && <span className="ca-count">{toast}</span>}
        {crash && (
          <span className="ca-crash" title={crash.where}>
            This app hit an error: {crash.message}
            {crash.where ? ` (${crash.where})` : ""}
          </span>
        )}
        {canToggleImmersive && (
          <button type="button" className="wl-btn" onClick={() => setImmersive((v) => !v)}>
            {immersive ? "Exit full window" : "Full window"}
          </button>
        )}
        {immersive && !canToggleImmersive && (
          <button type="button" className="wl-btn" onClick={onExit}>Close</button>
        )}
      </div>

      <iframe
        ref={frameRef}
        className="ca-frame"
        title={m.name}
        src={entry.base}
        // No allow-same-origin, on purpose. Adding it would hand the app the
        // wallet's origin and every protection here would become decorative.
        sandbox="allow-scripts allow-forms allow-pointer-lock"
        referrerPolicy="no-referrer"
        allow=""
      />

      {pay && (
        <PaymentConfirm
          appName={m.name}
          amount={pay.amount}
          reason={pay.reason}
          onDone={(ok) => { pay.resolve(ok); setPay(null); }}
        />
      )}
    </div>
  );
}

function PermissionPrompt({ entry, onAllow, onCancel }: {
  entry: CatalogEntry;
  onAllow: () => void;
  onCancel: () => void;
}) {
  const m = entry.manifest;
  const perms = sortForDisplay(m.permissions);
  return (
    <div className="ca">
      <div className="ca-surface ca-prompt">
        <h3 className="ca-host-title">{m.name}</h3>
        <p className="ca-author">by {m.author.name}</p>

        {perms.length === 0 ? (
          <p className="ca-perm-none">This app is not asking for anything. It cannot see your wallet at all.</p>
        ) : (
          <>
            <p className="ca-desc ca-prompt-lead">This app is asking to:</p>
            <div className="ca-perm-list">
              {perms.map((p) => (
                <div key={p.key} className={`ca-perm${p.kind === "capability" ? " ca-perm-cap" : ""}`}>
                  <div>
                    <div className="ca-perm-label">{p.label}</div>
                    <div className="ca-perm-detail">{p.detail}</div>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}

        {entry.preview ? (
          <p className="ca-perm-detail">
            This is your own app, running as it is right now. It goes through the
            same sandbox and the same checks a published app does, so what you
            see here is what someone else would get.
          </p>
        ) : entry.builtin ? (
          <p className="ca-perm-detail">
            This one ships with the wallet. It still runs in the same sandbox and
            through the same checks as any other app.
          </p>
        ) : !entry.verified ? (
          <p className="ca-perm-detail ca-perm-detail-warn">
            This app is not signed and will not be run.
          </p>
        ) : null}

        <div className="ca-row">
          <button type="button" className="wl-btn" onClick={onCancel}>Cancel</button>
          <button
            type="button"
            className="wl-btn wl-btn-primary"
            disabled={!entry.verified}
            onClick={onAllow}
          >
            Allow and open
          </button>
        </div>
      </div>
    </div>
  );
}

function PaymentConfirm({ appName, amount, reason, onDone }: {
  appName: string;
  amount: number;
  reason: string;
  onDone: (ok: boolean) => void;
}) {
  // Rendered into the document body rather than in place. Inside the main panel
  // a fixed-position layer is trapped by that panel's backdrop-filter, so a
  // confirmation the user must be able to see clearly would appear as a small
  // box inside the app's own area. Money decisions do not get to be subtle.
  return createPortal(
    <div className="ca-veil">
      <div className="ca-surface ca-dialog">
        <h3 className="ca-host-title">Payment request</h3>
        <p className="ca-desc ca-note-gap">
          <strong>{appName}</strong> is asking you to pay{" "}
          <strong>{amount.toLocaleString()} DIVI</strong>
          {reason ? ` for "${reason}"` : ""}.
        </p>
        <p className="ca-perm-detail ca-note-gap">
          The app cannot take this itself. Nothing moves unless you approve it here.
        </p>
        <div className="ca-row">
          <button type="button" className="wl-btn" onClick={() => onDone(false)}>Refuse</button>
          <button type="button" className="wl-btn wl-btn-primary" onClick={() => onDone(true)}>
            Approve {amount.toLocaleString()} DIVI
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
