import { useState } from "react";
import { PoeCreate } from "./PoeCreate";
import { PoeHistoryTab } from "./PoeHistoryTab";
import { C2paInspect } from "./C2paInspect";
import "./poe.css";
import { PoeVerify } from "./PoeVerify";
import { PoeInfoModal } from "./PoeInfoModal";
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
    <div className={"timestamp" + (wide ? " timestamp-wide" : "")}>
      <header className="poe-intro">
        <div className="poe-intro-text">
          <h3 className="ts-head">
            PoE, Why It Matters
            <button
              className="poe-help"
              onClick={() => setInfo(true)}
              aria-label="What is Proof of Existence?"
              title="What is this for?"
            >
              ?
            </button>
          </h3>
          {/* The heading used to repeat the panel title word for word, which
              told the user nothing twice. This says why they should care. */}
          <p className="wl-note">
            Anyone can now generate a convincing fake, so the question has shifted from “is this
            real?” to “who had it first?”. Timestamp your work the day you make it and no
            imitation, however good, can ever show an earlier date. A contract, a photo of damage,
            a piece of art: your file stays on this computer, only its fingerprint goes on the Divi
            blockchain, and the block’s time is the proof.
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
          <PoeCreate onFileState={setHasFile} />
        </div>
        {tab === "history" && <PoeHistoryTab onVerify={openVerify} />}
        {tab === "verify" && <PoeVerify prefill={prefill} />}
        {tab === "credentials" && <C2paInspect />}
      </section>

      {info && <PoeInfoModal onClose={() => setInfo(false)} />}
    </div>
  );
}
