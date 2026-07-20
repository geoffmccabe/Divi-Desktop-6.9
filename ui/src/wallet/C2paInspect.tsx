import { useRef, useState } from "react";
import { c2paInspect, type C2paSummary } from "./api";

// Reads C2PA "Content Credentials" out of a file — the provenance record that
// cameras and editors like Photoshop can attach, saying who made an image and
// what was done to it.
//
// Deliberate limits, kept visible in the wording:
//   * We READ credentials. We don't create or sign them, and nothing here makes
//     Divi a "C2PA compliant" product — that's a formal listing for tools that
//     GENERATE credentials.
//   * The library is built without remote-manifest fetching, so opening a file
//     never touches the network. Everything shown comes out of the file itself.
//   * A valid credential means the file matches what the signer claimed. It does
//     not mean the picture is true.

const prettyLabel = (l: string) => {
  if (l.startsWith("c2pa.")) return l.slice(5).replace(/[._]/g, " ");
  return l;
};

// The assertion labels that actually matter to a person looking at a photo.
const NOTABLE: Record<string, string> = {
  "c2pa.actions": "Records what was done to the file",
  "c2pa.training-mining": "States whether AI training is allowed",
  "c2pa.ai_generative_training": "Mentions generative AI training",
  "c2pa.hash.data": "Binds the credential to these exact bytes",
};

export function C2paInspect() {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [name, setName] = useState<string | null>(null);
  const [res, setRes] = useState<C2paSummary | null>(null);
  const [showRaw, setShowRaw] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const pick = async (f: File) => {
    setBusy(true);
    setErr(null);
    setRes(null);
    setName(f.name);
    try {
      const buf = new Uint8Array(await f.arrayBuffer());
      const ext = f.name.includes(".") ? f.name.split(".").pop()!.toLowerCase() : "";
      setRes(await c2paInspect(Array.from(buf), f.type || ext));
    } catch (e) {
      setErr(String(e));
    }
    setBusy(false);
  };

  const state = res?.state ?? "";
  // The SDK's own words: Trusted > Valid > Invalid. "Valid" means the maths
  // checks out but we don't recognise the signer — a real and separate thing.
  const good = state === "Trusted";
  const okish = state === "Valid";

  return (
    <div className="poe-pane">
      <p className="wl-note" style={{ marginBottom: 10 }}>
        Some cameras and editors attach <strong>Content Credentials</strong> — a signed record of who made a file and
        what was done to it. Drop one in to read it. The file stays on your computer.
      </p>

      <input
        ref={inputRef}
        type="file"
        style={{ display: "none" }}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) pick(f);
        }}
      />
      <button type="button" className="wl-btn" disabled={busy} onClick={() => inputRef.current?.click()}>
        {busy ? "Reading…" : "Choose a file"}
      </button>
      {name && <div className="wl-note" style={{ marginTop: 6 }}>{name}</div>}
      {err && <p className="wl-err">{err}</p>}

      {res && !res.present && (
        <div className="ts-proof" style={{ marginTop: 12 }}>
          <div className="ts-proof-title">No Content Credentials</div>
          <div>
            This file doesn't carry any. That isn't a problem — most files don't. It simply means there's no signed
            record of where it came from.
          </div>
        </div>
      )}

      {res && res.present && (
        <div
          className={"ts-proof " + (good ? "ts-proof-ok" : okish ? "" : "ts-proof-bad")}
          style={{ marginTop: 12 }}
        >
          <div className="ts-proof-title">
            {good ? "✓ Credentials valid, signer recognised" : okish ? "Credentials valid — signer unknown" : "✗ Credentials failed validation"}
          </div>

          {okish && (
            <div className="wl-note">
              The signature and the file match, but this signer isn't on the official C2PA trust list — so we can't
              vouch for who they are.
            </div>
          )}

          <div style={{ marginTop: 8, display: "grid", gap: 3, fontSize: "0.78rem" }}>
            {res.signer && <div><strong>Signed by:</strong> {res.signer}</div>}
            {res.signedAt && <div><strong>Signed:</strong> {new Date(res.signedAt).toLocaleString()}</div>}
            {res.generator && <div><strong>Made with:</strong> {res.generator}</div>}
            {res.title && <div><strong>Title:</strong> {res.title}</div>}
            {res.ingredients > 0 && (
              <div><strong>Built from:</strong> {res.ingredients} earlier file{res.ingredients === 1 ? "" : "s"}</div>
            )}
            {res.diviTxid && (
              <div><strong>Divi proof:</strong> <code>{res.diviTxid.slice(0, 16)}…</code></div>
            )}
          </div>

          {res.assertions.length > 0 && (
            <div style={{ marginTop: 8 }}>
              <div className="wl-note" style={{ marginBottom: 3 }}>What the credential states:</div>
              <ul style={{ margin: 0, paddingLeft: 18, fontSize: "0.75rem" }}>
                {res.assertions.map((a) => (
                  <li key={a}>
                    {prettyLabel(a)}
                    {NOTABLE[a] && <span className="wl-note"> — {NOTABLE[a]}</span>}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {res.issues.length > 0 && (
            <div style={{ marginTop: 8 }}>
              <div className="wl-note" style={{ marginBottom: 3 }}>Problems found:</div>
              <ul style={{ margin: 0, paddingLeft: 18, fontSize: "0.75rem" }}>
                {res.issues.map((i, n) => <li key={n}>{i}</li>)}
              </ul>
            </div>
          )}

          <button
            type="button"
            className="wl-link"
            style={{ marginTop: 8, fontSize: "0.72rem" }}
            onClick={() => setShowRaw((v) => !v)}
          >
            {showRaw ? "Hide" : "Show"} the full record
          </button>
          {showRaw && (
            <pre
              style={{
                marginTop: 6,
                maxHeight: 240,
                overflow: "auto",
                fontSize: "0.68rem",
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
              }}
            >
              {res.json}
            </pre>
          )}
        </div>
      )}

      <p className="wl-note" style={{ marginTop: 12, fontSize: "0.68rem", opacity: 0.75 }}>
        Valid credentials mean the file hasn't changed since it was signed and the signer is who they say. They don't
        make the content true — and a file with no credentials isn't suspicious, just unlabelled. Divi reads these; it
        doesn't issue them.
      </p>
    </div>
  );
}
