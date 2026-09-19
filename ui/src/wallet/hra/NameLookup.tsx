import { useState } from "react";
import { hraResolve } from "./api";

// Look a name up. This is the highest-stakes screen in the wallet: a wrong
// answer here sends somebody's money to a stranger. So it does three things
// deliberately:
//
//  * The answer comes only from this machine's own node and its own index.
//    Nothing is asked of any server.
//  * The raw address is always shown in full, never abbreviated behind the
//    name. A name is a convenience, never a substitute for looking.
//  * "Not found" is stated as not found. It never degrades into a guess.

export function NameLookup() {
  const [typed, setTyped] = useState("");
  const [answer, setAnswer] = useState<string | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);

  const look = async () => {
    setBusy(true);
    setError("");
    setAnswer(undefined);
    setCopied(false);
    try {
      setAnswer(await hraResolve(typed.trim()));
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="hra-form">
      <p className="wl-note">
        Find out which Divi address a name points at. The answer comes from your own node, not from
        any website or service.
      </p>

      <label className="hra-field">
        <span>Name</span>
        <input
          className="wl-input mono"
          placeholder="e.g. geoff"
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && typed.trim() && look()}
          maxLength={32}
          spellCheck={false}
          autoCapitalize="off"
        />
      </label>

      <button className="wl-btn wl-btn-primary" disabled={busy || !typed.trim()} onClick={look}>
        {busy ? "Looking…" : "Look up"}
      </button>

      {answer === null && (
        <p className="wl-err">
          No address is recorded for that name. Either nobody owns it, or the owner has not pointed
          it anywhere yet. Do not send anything.
        </p>
      )}

      {typeof answer === "string" && (
        <div className="hra-answer">
          <div className="hra-answer-label">Sends to this address</div>
          <div className="mono hra-answer-addr">{answer}</div>
          <button
            className="wl-btn"
            onClick={() => {
              navigator.clipboard?.writeText(answer);
              setCopied(true);
            }}
          >
            {copied ? "Copied" : "Copy address"}
          </button>
          <p className="wl-note hra-dim">
            Check this against what the person told you before sending anything. A name is a
            convenience, not a guarantee.
          </p>
        </div>
      )}

      {error && <p className="wl-err">{error}</p>}
    </div>
  );
}
