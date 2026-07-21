import { useEffect, useState } from "react";
import { aiStatus, aiSetKey, aiClearKey, type AiStatus } from "../../wallet/api";

// Admin → AI. Wires the LLMs that power each node's agent.
//
// SECURITY: a desktop app cannot keep a shared secret — any key inside it can be
// extracted and abused. So there are two honest paths, and only one belongs in
// the client:
//   1. Bring-your-own-key (here): the local user's OWN Claude/Grok key, stored
//      in the OS keychain, used only on this machine. Never bundled or shared.
//   2. The DD69 AI Gateway (a URL here): for giving ALL users access under a
//      subscription, DD69 calls YOUR server, which holds the real keys, checks
//      the subscription, meters usage, and calls the LLM. That server is where
//      billing (DIVI / card / PayPal) lives. This panel only points at it.

interface KeyRowProps {
  label: string;
  provider: string;
  hint: string;
  set: boolean;
  onChanged: () => void;
}

function KeyRow({ label, provider, hint, set, onChanged }: KeyRowProps) {
  const [val, setVal] = useState("");
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    try {
      await aiSetKey(provider, val.trim());
      setVal("");
      onChanged();
    } finally {
      setBusy(false);
    }
  };
  const clear = async () => {
    setBusy(true);
    try {
      await aiClearKey(provider);
      onChanged();
    } finally {
      setBusy(false);
    }
  };

  return (
    <label className="admin-field">
      <span>
        {label} {set ? <em className="ai-set">✓ key saved</em> : <em className="ai-unset">not set</em>}
      </span>
      <div className="ai-key-row">
        <input
          className="wl-input"
          type="password"
          placeholder={set ? "Enter a new key to replace…" : hint}
          value={val}
          onChange={(e) => setVal(e.target.value)}
          spellCheck={false}
          autoComplete="off"
        />
        <button type="button" className="wl-btn wl-btn-primary" disabled={busy || !val.trim()} onClick={save}>
          Save
        </button>
        {set && (
          <button type="button" className="wl-btn" disabled={busy} onClick={clear}>
            Remove
          </button>
        )}
      </div>
    </label>
  );
}

export function AiPanel() {
  const [status, setStatus] = useState<AiStatus | null>(null);
  const [gateway, setGateway] = useState("");
  const [savedGateway, setSavedGateway] = useState(false);

  const refresh = () => {
    aiStatus()
      .then((s) => {
        setStatus(s);
        setGateway(s.gateway);
      })
      .catch(() => setStatus({ claude: false, grok: false, gateway: "" }));
  };
  useEffect(refresh, []);

  const saveGateway = async () => {
    await aiSetKey("gateway", gateway.trim());
    setSavedGateway(true);
    setTimeout(() => setSavedGateway(false), 1500);
    refresh();
  };

  return (
    <div className="admin-panel">
      <p className="wl-note">
        Power the AI agent that runs on this node. Each node's agent can have a character and
        personality, talk to its user or other nodes, and help with analysis.
      </p>

      <h3 className="ai-section-head">Your own keys (this machine only)</h3>
      <p className="wl-note ai-security">
        Stored in the OS keychain and used only on this computer — never bundled into the app or
        shared with other users. A client app can't safely hold a key everyone shares, so for a
        subscription that gives <em>all</em> users access, use the Gateway below instead.
      </p>

      <KeyRow
        label="Anthropic (Claude)"
        provider="claude"
        hint="sk-ant-…"
        set={!!status?.claude}
        onChanged={refresh}
      />
      <KeyRow
        label="xAI (Grok)"
        provider="grok"
        hint="xai-…"
        set={!!status?.grok}
        onChanged={refresh}
      />

      <h3 className="ai-section-head">DD69 AI Gateway (for all users + subscriptions)</h3>
      <p className="wl-note ai-security">
        To let every DD69 user access the LLMs under a subscription, point them at a server you
        control. That server holds the real keys, checks each user's subscription, meters usage, and
        bills (DIVI / card / PayPal). This is the only safe way to share one key across users.
      </p>
      <label className="admin-field">
        <span>Gateway URL {savedGateway && <em className="ai-set">✓ saved</em>}</span>
        <div className="ai-key-row">
          <input
            className="wl-input"
            placeholder="https://ai.divi… (leave empty to use your own keys above)"
            value={gateway}
            onChange={(e) => setGateway(e.target.value)}
            spellCheck={false}
          />
          <button type="button" className="wl-btn wl-btn-primary" onClick={saveGateway}>
            Save
          </button>
        </div>
      </label>

      <p className="wl-note">
        The gateway server itself (subscription + billing + key custody) is a separate backend piece,
        not part of this app. This panel only stores where to reach it.
      </p>
    </div>
  );
}
