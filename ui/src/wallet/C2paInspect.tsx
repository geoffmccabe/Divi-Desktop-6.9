import { useRef, useState } from "react";
import { c2paInspect, openUrl, type C2paSummary } from "./api";

// Reads C2PA "Content Credentials" out of a file: the provenance record that
// cameras and editors like Photoshop can attach, saying who made an image and
// what was done to it.
//
// Deliberate limits, kept visible in the wording:
//   * We READ credentials. We don't create or sign them, and nothing here makes
//     Divi a "C2PA compliant" product. Compliance is a formal listing for tools
//     that GENERATE credentials.
//   * The library is built without remote-manifest fetching, so opening a file
//     never touches the network. Everything shown comes out of the file itself.
//   * A valid credential means the file matches what the signer claimed. It does
//     not mean the picture is true.
//
// NOTE: no em-dashes in any user-facing string here. House rule.

const prettyLabel = (l: string) => {
  if (l.startsWith("c2pa.")) return l.slice(5).replace(/[._]/g, " ");
  if (l.startsWith("stds.schema-org.")) return l.slice(16);
  return l;
};

// Matched by PREFIX: real labels carry a version suffix (the reference sample
// uses "c2pa.actions.v2"), so exact-match lookups silently miss the assertion
// that matters most, the record of what was done to the file.
const NOTABLE: Array<[string, string]> = [
  ["c2pa.actions", "Records what was done to the file"],
  ["c2pa.training-mining", "States whether AI training is allowed"],
  ["c2pa.ai_generative_training", "Mentions generative AI training"],
  ["c2pa.hash", "Binds the credential to these exact bytes"],
  ["stds.schema-org", "Standard descriptive metadata"],
  ["stds.exif", "Camera and EXIF details"],
];
const noteFor = (label: string) => NOTABLE.find(([k]) => label.startsWith(k))?.[1];

const LINKS: Array<[string, string, string]> = [
  [
    "contentcredentials.org",
    "https://contentcredentials.org/",
    "The official site. Explains Content Credentials and has a free web app that can add them to your own files.",
  ],
  [
    "Verify a file online",
    "https://contentcredentials.org/verify",
    "Adobe's public checker. Useful as a second opinion against what this panel says.",
  ],
  [
    "Adobe Content Authenticity",
    "https://helpx.adobe.com/creative-cloud/help/content-credentials.html",
    "How to switch Content Credentials on in Photoshop and Lightroom.",
  ],
  [
    "The C2PA standard",
    "https://c2pa.org/",
    "The technical standard itself, and the list of tools that have been formally certified to issue credentials.",
  ],
];

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
  // checks out but we don't recognise the signer, which is a separate thing.
  const good = state === "Trusted";
  const okish = state === "Valid";

  return (
    <div className="poe-pane">
      {/* Action first. One line of orientation, then the control — the reference
          material lives below the result, where it informs without blocking the
          one thing this panel exists to do. */}
      <p className="wl-note" style={{ marginBottom: 10 }}>
        Check whether a file carries <strong>Content Credentials</strong>: a signed record of who made it and how. Divi
        reads them; it doesn't create them.
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
        {busy ? "Reading…" : "Choose a file to check"}
      </button>
      {name && <div className="wl-note" style={{ marginTop: 6 }}>{name}</div>}
      {err && <p className="wl-err">{err}</p>}

      {res && !res.present && (
        <div className="ts-proof" style={{ marginTop: 12 }}>
          <div className="ts-proof-title">No Content Credentials</div>
          <div>
            This file doesn't carry any. That isn't a problem, and most files don't. It simply means there's no signed
            record of where it came from. A Divi timestamp still proves when it existed.
          </div>
        </div>
      )}

      {res && res.present && (
        <div className={"ts-proof " + (good ? "ts-proof-ok" : okish ? "" : "ts-proof-bad")} style={{ marginTop: 12 }}>
          <div className="ts-proof-title">
            {good
              ? "✓ Credentials valid, signer recognised"
              : okish
                ? "Credentials valid, signer not recognised"
                : "✗ Credentials failed validation"}
          </div>

          {okish && (
            <div className="wl-note">
              The signature matches the file, so nothing has been altered since signing. But this signer isn't on the
              official C2PA list of certified issuers, so we can't confirm who they are. That is common for files
              signed with test or self-issued certificates.
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
            {res.diviTxid && <div><strong>Divi proof:</strong> <code>{res.diviTxid.slice(0, 16)}…</code></div>}
          </div>

          {res.assertions.length > 0 && (
            <div style={{ marginTop: 8 }}>
              <div className="wl-note" style={{ marginBottom: 3 }}>What the credential states:</div>
              <ul style={{ margin: 0, paddingLeft: 18, fontSize: "0.75rem" }}>
                {res.assertions.map((a) => (
                  <li key={a}>
                    {prettyLabel(a)}
                    {noteFor(a) && <span className="wl-note"> ({noteFor(a)})</span>}
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

      {/* ── Reference. Everything a first-time reader needs, kept out of the way
             of everything a repeat user needs. ────────────────────────────── */}
      <div style={{ marginTop: 22, paddingTop: 14, borderTop: "1px solid hsl(var(--border) / 0.5)" }}>
        <div className="ts-proof-title" style={{ marginBottom: 6 }}>About Content Credentials</div>

        <p className="wl-note" style={{ marginBottom: 8 }}>
          A signed label carried inside a file, saying who made it and what was done to it. Some cameras add them the
          moment a photo is taken, and editors like Photoshop can add them as you work. They use an open standard
          called <strong>C2PA</strong>, backed by Adobe, Microsoft, the BBC and others.
        </p>
        <p className="wl-note" style={{ marginBottom: 8 }}>
          Pair one with a Divi timestamp and you cover both halves of the story: the credential says who made a file
          and how, and your timestamp independently proves it existed by a certain moment.
        </p>

        <div className="wl-note" style={{ fontWeight: 600, marginTop: 12, marginBottom: 4 }}>
          Getting credentials onto your own work
        </div>
        <p className="wl-note" style={{ marginBottom: 4 }}>
          There's nothing to apply for and nothing to buy. Credentials are issued by the <strong>tool</strong> you
          create with, so you get them by working in one that supports the standard:
        </p>
        <ul className="wl-note" style={{ paddingLeft: 18, margin: "4px 0 8px" }}>
          <li><strong>Photoshop and Lightroom.</strong> Turn Content Credentials on and they attach as you export.</li>
          <li><strong>The free web app</strong> at contentcredentials.org, which adds them to files you upload.</li>
          <li><strong>Certain cameras</strong> (Leica, Sony and Nikon models) sign photographs as they're taken, which
            is the strongest form.</li>
        </ul>
        <p className="wl-note" style={{ marginBottom: 8 }}>
          Only the software vendor can be formally certified, not you. That certification decides whether a signer
          shows above as recognised, or merely valid.
        </p>

        <div style={{ display: "grid", gap: 6, margin: "10px 0" }}>
          {LINKS.map(([label, url, why]) => (
            <div key={url}>
              <button type="button" className="wl-link" style={{ fontSize: "0.75rem" }} onClick={() => openUrl(url)}>
                {label}
              </button>
              <div className="wl-note" style={{ fontSize: "0.68rem" }}>{why}</div>
            </div>
          ))}
        </div>

        <p className="wl-note" style={{ marginTop: 10, fontSize: "0.68rem", opacity: 0.75 }}>
          Valid credentials mean a file hasn't changed since it was signed and the signer is who they claim. They don't
          make the content true, and a file without them isn't suspicious, just unlabelled. Your file is read on this
          computer only and never uploaded.
        </p>
      </div>
    </div>
  );
}
