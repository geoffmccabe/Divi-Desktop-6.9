import { useCallback, useEffect, useRef, useState } from "react";
import "./builder.css";
import {
  builderUrl, setBuilderUrl, health, createSession, sendMessage, setKey,
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
        {!probe.health?.keyConfigured && (
          <div className="bd-stat">
            <b className="bd-warn">No AI key yet</b>
            <span>add one in the gear, AI tab</span>
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
        {!session && probe.health?.keyConfigured && (
          <button type="button" className="wl-btn wl-btn-primary" onClick={start}>
            Start building
          </button>
        )}
      </div>

      {!session ? (
        probe.health?.keyConfigured ? (
          <p className="bd-note">
            Start a session to begin. You are charged in DIVI for what the model
            actually uses, and the running total stays on screen.
          </p>
        ) : (
          <KeyBox onSaved={check} />
        )
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
                  <span className="bd-file-name">{f.path}</span>
                  <span className="bd-file-size">{f.bytes}</span>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function KeyBox({ onSaved }: { onSaved: () => void }) {
  const [key, setKey_] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const save = async () => {
    setBusy(true);
    setErr(null);
    try {
      await setKey(key.trim());
      setKey_("");
      onSaved();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="bd-offline">
      <h3>One thing left to do</h3>
      <p className="bd-note">
        Paste an Anthropic key below and press Save. You only do this once each
        time the wallet is started. The key is kept in memory, never written to a
        file, and never sent anywhere except Anthropic.
      </p>
      <div className="bd-bar bd-bar-plain">
        <input
          className="wl-input"
          type="password"
          placeholder="sk-ant-..."
          value={key}
          onChange={(e) => setKey_(e.target.value)}
          spellCheck={false}
          autoComplete="off"
          aria-label="Anthropic key"
        />
        <button type="button" className="wl-btn wl-btn-primary" disabled={busy || key.trim().length < 20} onClick={save}>
          Save
        </button>
      </div>
      {err && <p className="bd-note bd-bad bd-note-gap">{err}</p>}
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
        <h3>App Builder is not switched on</h3>
        <p className="bd-note">
          The part that talks to the AI runs alongside the wallet, and it is not
          running at the moment. Nothing is broken and nothing has been lost.
        </p>
        <p className="bd-note bd-note-gap">
          It usually starts with the wallet. If it does not come back, ask for it
          to be restarted and everything here will pick up where it left off.
        </p>
        {error && <p className="bd-note bd-bad bd-note-gap">Details: {error}</p>}
        <div className="bd-bar bd-bar-plain">
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
