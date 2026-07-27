import { useCallback, useEffect, useRef, useState } from "react";
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

export function AppHost({ entry, onExit }: { entry: CatalogEntry; onExit: () => void }) {
  const m = entry.manifest;
  const frameRef = useRef<HTMLIFrameElement | null>(null);
  const [consented, setConsented] = useState(() => isFullyGranted(m.id, m.permissions));
  const [immersive, setImmersive] = useState(() => immersiveMode(m) === "always");
  const [pay, setPay] = useState<{ amount: number; reason: string; resolve: (ok: boolean) => void } | null>(null);
  const [toast, setToast] = useState<string | null>(null);

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
    <div className={immersive ? "ca-immersive" : "ca-host"}>
      <div className="ca-host-bar">
        <button type="button" className="wl-btn" onClick={onExit}>
          <Icon name="overview" size={14} /> Back to apps
        </button>
        <span className="ca-host-title">{m.name}</span>
        <span className="ca-host-spacer" />
        {toast && <span className="ca-count">{toast}</span>}
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
      <div className="glass-chip" style={{ padding: 18 }}>
        <h3 className="ca-host-title">{m.name}</h3>
        <p className="ca-author">by {m.author.name}</p>

        {perms.length === 0 ? (
          <p className="ca-perm-none">This app is not asking for anything. It cannot see your wallet at all.</p>
        ) : (
          <>
            <p className="ca-desc" style={{ marginTop: 10 }}>This app is asking to:</p>
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

        {entry.builtin ? (
          <p className="ca-perm-detail">
            This one ships with the wallet. It still runs in the same sandbox and
            through the same checks as any other app.
          </p>
        ) : !entry.verified ? (
          <p className="ca-perm-detail" style={{ color: "hsl(var(--destructive))" }}>
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
  return (
    <div className="ca-immersive" style={{ zIndex: 60, background: "hsl(var(--background) / 0.86)" }}>
      <div className="glass-chip" style={{ margin: "auto", padding: 22, maxWidth: 420 }}>
        <h3 className="ca-host-title">Payment request</h3>
        <p className="ca-desc" style={{ marginTop: 8 }}>
          <strong>{appName}</strong> is asking you to pay{" "}
          <strong>{amount.toLocaleString()} DIVI</strong>
          {reason ? ` for "${reason}"` : ""}.
        </p>
        <p className="ca-perm-detail" style={{ marginTop: 8 }}>
          The app cannot take this itself. Nothing moves unless you approve it here.
        </p>
        <div className="ca-row" style={{ marginTop: 14 }}>
          <button type="button" className="wl-btn" onClick={() => onDone(false)}>Refuse</button>
          <button type="button" className="wl-btn wl-btn-primary" onClick={() => onDone(true)}>
            Approve {amount.toLocaleString()} DIVI
          </button>
        </div>
      </div>
    </div>
  );
}
