import { useState } from "react";
import { PoeCreate } from "./PoeCreate";
import { PoeHistoryTab } from "./PoeHistoryTab";
import { C2paInspect } from "./C2paInspect";
import "./poe.css";
import { PoeVerify } from "./PoeVerify";
import { PoeInfoModal } from "./PoeInfoModal";
import { MoreInfoButton } from "./MoreInfoButton";
import { loadPoeHistory, type PoeRecord } from "./poeHistory";

// Proof-of-Existence. Three tabs: make a proof, review the ones you've made,
// and check one. The file NEVER leaves the machine: it's hashed in the browser
// and only the 32-byte fingerprint is written to the chain, so nobody can read
// the file from the blockchain, only confirm a hash matches.

type Tab = "create" | "history" | "verify" | "credentials";

export function TimestampPanel() {
  const [tab, setTab] = useState<Tab>("create");
  const [info, setInfo] = useState(false);
  // Set when the user jumps from History to Verify, so the target proof is known.
  const [prefill, setPrefill] = useState<PoeRecord | null>(null);
  // The Create tab widens the panel once a file is loaded so the preview fits.
  const [hasFile, setHasFile] = useState(false);

  const count = loadPoeHistory().length;
  const wide = tab === "create" && hasFile;

  const openVerify = (rec: PoeRecord) => {
    setPrefill(rec);
    setTab("verify");
  };

  return (
    <div
      className={"timestamp" + (wide ? " timestamp-wide" : "")}
      style={{ maxWidth: "none", width: "100%" }}
    >
      <header className="poe-intro">
        <div className="poe-intro-text">
          <h3 className="ts-head">PoE, Why It Matters</h3>
          {/* Section 1 intro (supplied). The deepfake-defense detail + its MORE
              INFO capsule now live under the file chooser, inside PoeCreate. */}
          <p className="wl-note">
            In an era where generative AI can effortlessly fabricate photos, video, and audio,
            proving authenticity is no longer about detecting a fake. It is about proving timeline
            priority. By anchoring a digital item’s cryptographic fingerprint onto an immutable
            blockchain the moment it is created, you establish an unalterable line in the sand: a
            timestamped proof that no future AI generation can backdate or manipulate.{" "}
            <MoreInfoButton onClick={() => setInfo(true)} />
          </p>
        </div>
      </header>

      <nav className="poe-tabs" role="tablist">
        <button
          className={"poe-tab" + (tab === "create" ? " poe-tab-on" : "")}
          onClick={() => setTab("create")}
          role="tab"
          aria-selected={tab === "create"}
        >
          Create a Timestamp
        </button>
        <button
          className={"poe-tab" + (tab === "history" ? " poe-tab-on" : "")}
          onClick={() => setTab("history")}
          role="tab"
          aria-selected={tab === "history"}
        >
          My Timestamps{count ? ` (${count})` : ""}
        </button>
        <button
          className={"poe-tab" + (tab === "verify" ? " poe-tab-on" : "")}
          onClick={() => setTab("verify")}
          role="tab"
          aria-selected={tab === "verify"}
        >
          Verify
        </button>
        <button
          className={"poe-tab" + (tab === "credentials" ? " poe-tab-on" : "")}
          onClick={() => setTab("credentials")}
          role="tab"
          aria-selected={tab === "credentials"}
        >
          Credentials
        </button>
      </nav>

      <section className="ts-section">
        {/* Create stays MOUNTED and is merely hidden, so the chosen file,
            its preview and any in-flight confirmation survive a trip to
            another tab. Unmounting it would throw the file away, and the browser
            gives no way to re-open one without the user picking it again.
            `contents` keeps the wrapper invisible to the flex layout.
            (App restart still clears it, which is the intended behaviour.) */}
        <div style={{ display: tab === "create" ? "contents" : "none" }}>
          <PoeCreate onFileState={setHasFile} onMoreInfo={() => setInfo(true)} />
        </div>
        {tab === "history" && <PoeHistoryTab onVerify={openVerify} />}
        {tab === "verify" && <PoeVerify prefill={prefill} />}
        {tab === "credentials" && <C2paInspect />}
      </section>

      {info && <PoeInfoModal onClose={() => setInfo(false)} />}
    </div>
  );
}
