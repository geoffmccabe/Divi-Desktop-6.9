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
    "Add Credentials for Free",
    "https://contentcredentials.org/",
    "Use the free web tool, or toggle Content Credentials on in Photoshop and Lightroom settings.",
  ],
  [
    "Verify a File",
    "https://verify.contentauthenticity.org/",
    "Check any file’s lineage with Adobe’s public Verify tool.",
  ],
  [
    "Learn the Tech",
    "https://c2pa.org/",
    "Explore the underlying open standard.",
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
      {/* Section 2 copy (supplied). No em-dashes: house rule. */}
      <p className="wl-note" style={{ marginBottom: 8 }}>
        Content Credentials are digital labels embedded directly inside your files that
        cryptographically prove <strong>who created a file</strong> and <strong>how it was edited</strong>.
        Backed by the open C2PA standard (supported by Adobe, Microsoft, the BBC, and others), they
        provide an auditable history right at the source.
      </p>
      <p className="wl-note" style={{ marginBottom: 10 }}>
        When you pair a Content Credential with a Divi blockchain timestamp, you get complete
        defense: the credential proves origin and context, while the timestamp independently proves
        the timeline.
      </p>

      <h4 className="poe-intro-sub">How Content Credentials Protect You</h4>
      <ul className="poe-points">
        <li>
          <strong>Source-Level Integrity.</strong> Created automatically by supporting cameras (like
          select Leica, Sony, and Nikon models) or design tools (like Photoshop and Lightroom),
          credentials cryptographically sign your file the moment it is shot or exported.
        </li>
        <li>
          <strong>Tamper-Evident Security.</strong> A valid credential guarantees the file hasn’t
          been altered since it was signed. If anyone tampers with the pixels or metadata, the
          signature breaks.
        </li>
        <li>
          <strong>Zero-Knowledge Privacy.</strong> Checking credentials happens entirely on your
          local device. Your private files are never uploaded to an external server.
        </li>
      </ul>

      <p className="poe-takeaway">
        <strong>Key Takeaway.</strong> Credentials prove <em>authorship and process</em>, but they
        don’t guarantee <em>truth</em>. Anyone can sign a fake. That is why pairing them with an
        immutable Divi timestamp is critical to prove your original existed first.
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

      {/* Quick Resources (supplied). The explanation lives at the top of the tab;
          this is just where to act on it. */}
      <div style={{ marginTop: 22, paddingTop: 14, borderTop: "1px solid hsl(var(--border) / 0.5)" }}>
        <div className="poe-intro-sub" style={{ marginTop: 0 }}>Quick Resources</div>
        <div style={{ display: "grid", gap: 6, margin: "8px 0" }}>
          {LINKS.map(([label, url, why]) => (
            <div key={url}>
              <button type="button" className="wl-link" onClick={() => openUrl(url)}>
                {label}
              </button>
              <div className="wl-note" style={{ fontSize: "0.72rem" }}>{why}</div>
            </div>
          ))}
        </div>
        <p className="wl-note" style={{ marginTop: 8, fontSize: "0.72rem", opacity: 0.75 }}>
          One note on the results above: only the software vendor can be formally certified, not you. That is what
          decides whether a signer shows as recognised, or merely valid. Your file is read on this computer only and
          never uploaded.
        </p>
      </div>
    </div>
  );
}
