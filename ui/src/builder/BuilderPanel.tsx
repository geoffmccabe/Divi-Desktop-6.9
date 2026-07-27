import { useCallback, useEffect, useRef, useState } from "react";
import "./builder.css";
import {
  builderUrl, setBuilderUrl, health, createSession, sendMessage,
  type Account, type BuilderFile, type Health, type TurnEvent,
} from "./api";

// App Builder: describe an app, a model writes it, you pay for the tokens in DIVI.
//
// The service that does the work is a separate process and is not running for
// most people, so the honest default state of this panel is "not connected",
// with instructions, rather than a spinner or a fake chat.

type Line =
  | { kind: "you"; text: string }
  | { kind: "ai"; text: string }
  | { kind: "tool"; text: string }
  | { kind: "cost"; text: string }
  | { kind: "err"; text: string };

const STARTING_BALANCE = 500;

export function BuilderPanel() {
  const [probe, setProbe] = useState<{ state: "checking" | "up" | "down"; health?: Health; error?: string }>({
    state: "checking",
  });
  const [session, setSession] = useState<string | null>(null);
  const [account, setAccount] = useState<Account | null>(null);
  const [files, setFiles] = useState<BuilderFile[]>([]);
  const [lines, setLines] = useState<Line[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const logRef = useRef<HTMLDivElement | null>(null);

  const check = useCallback(() => {
    setProbe({ state: "checking" });
    health()
      .then((h) => setProbe({ state: "up", health: h }))
      .catch((e) => setProbe({ state: "down", error: e?.message ?? "no answer" }));
  }, []);

  useEffect(check, [check]);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [lines]);

  const start = async () => {
    try {
      const { id } = await createSession(STARTING_BALANCE);
      setSession(id);
      setLines([{ kind: "ai", text: "Ready. Describe the app you want and I will build it." }]);
    } catch (e) {
      setLines([{ kind: "err", text: (e as Error).message }]);
    }
  };

  const send = async () => {
    const message = draft.trim();
    if (!message || !session || busy) return;
    setDraft("");
    setLines((l) => [...l, { kind: "you", text: message }]);
    setBusy(true);
    try {
      const r = await sendMessage(session, message);
      const added: Line[] = [];
      for (const e of r.events) added.push(...renderEvent(e));
      if (r.stopped === "step_limit") {
        added.push({ kind: "err", text: "Stopped after too many steps without finishing." });
      }
      setLines((l) => [...l, ...added]);
      setFiles(r.files);
      setAccount(r.account);
    } catch (e) {
      setLines((l) => [...l, { kind: "err", text: (e as Error).message }]);
    } finally {
      setBusy(false);
    }
  };

  if (probe.state === "checking") {
    return <div className="bd"><p className="bd-note">Looking for the builder service…</p></div>;
  }

  if (probe.state === "down") {
    return <Offline error={probe.error} onRetry={check} />;
  }

  return (
    <div className="bd">
      <div className="bd-bar">
        <div className="bd-stat">
          <b className="bd-good">Connected</b>
          <span>{probe.health?.model}</span>
        </div>
        {!probe.health?.rateConfigured && (
          <div className="bd-stat">
            <b className="bd-warn">No DIVI rate set</b>
            <span>billing disabled</span>
          </div>
        )}
        <span className="bd-spacer" />
        {account && (
          <>
            <div className="bd-stat">
              <b>{account.balanceDivi.toLocaleString()} DIVI</b>
              <span>credit left</span>
            </div>
            <div className="bd-stat">
              <b>{account.spentDivi.toFixed(2)} DIVI</b>
              <span>spent, {account.turns} turns</span>
            </div>
          </>
        )}
        {!session && (
          <button type="button" className="wl-btn wl-btn-primary" onClick={start}>
            Start building
          </button>
        )}
      </div>

      {!session ? (
        <p className="bd-note">
          Start a session to begin. You are charged in DIVI for what the model
          actually uses, and the running total stays on screen.
        </p>
      ) : (
        <div className="bd-split">
          <div className="bd-chat">
            <div className="bd-log" ref={logRef}>
              {lines.map((l, i) => (
                <div key={i} className={`bd-msg bd-msg-${l.kind === "you" ? "you" : l.kind === "ai" ? "ai" : l.kind === "err" ? "err" : l.kind === "cost" ? "cost" : "tool"}`}>
                  {l.text}
                </div>
              ))}
              {busy && <div className="bd-msg bd-msg-tool">Working…</div>}
            </div>
            <div className="bd-compose">
              <textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void send(); }
                }}
                placeholder="Describe the app, or the change you want next…"
                disabled={busy}
              />
              <button type="button" className="wl-btn wl-btn-primary" disabled={busy || !draft.trim()} onClick={send}>
                Send
              </button>
            </div>
          </div>

          <div className="bd-files">
            <h4>Files</h4>
            {files.length === 0 ? (
              <p className="bd-empty">Nothing written yet.</p>
            ) : (
              files.map((f) => (
                <div className="bd-file" key={f.path}>
                  <span style={{ color: "hsl(var(--foreground))" }}>{f.path}</span>
                  <span>{f.bytes}</span>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function renderEvent(e: TurnEvent): Line[] {
  switch (e.type) {
    case "message":
      return e.text ? [{ kind: "ai", text: e.text }] : [];
    case "tool":
      return [{ kind: "tool", text: `${e.name}${e.path ? ` ${e.path}` : ""}` }];
    case "usage":
      return [{ kind: "cost", text: `step ${e.step}: ${e.divi.toFixed(2)} DIVI` }];
    case "billing_stopped":
      return [{ kind: "err", text: `Stopped: ${e.reason}` }];
    case "error":
      return [{ kind: "err", text: e.message }];
    default:
      return [];
  }
}

function Offline({ error, onRetry }: { error?: string; onRetry: () => void }) {
  const [url, setUrl] = useState(builderUrl());
  return (
    <div className="bd">
      <div className="bd-offline">
        <h3>The builder service is not running</h3>
        <p className="bd-note">
          App Builder needs a separate service, which is not part of the wallet
          and is not started automatically. It lives in{" "}
          <code>contrib/app-builder</code> in the Divi Desktop repository.
        </p>
        <p className="bd-note" style={{ marginTop: 8 }}>
          Start it with <code>node src/server.mjs</code>, with a model key and a
          DIVI rate set, then check again.
        </p>
        {error && <p className="bd-note bd-bad" style={{ marginTop: 8 }}>Last attempt: {error}</p>}
        <div className="bd-bar" style={{ marginTop: 14, background: "transparent", border: 0, padding: 0 }}>
          <input
            className="wl-input"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            spellCheck={false}
            aria-label="Builder service address"
          />
          <button type="button" className="wl-btn" onClick={() => { setBuilderUrl(url); onRetry(); }}>
            Check again
          </button>
        </div>
      </div>
    </div>
  );
}
