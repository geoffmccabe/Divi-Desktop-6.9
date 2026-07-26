import { useCallback, useEffect, useRef, useState } from "react";
import { hraMyNames, hraSync, type HraSync, type OwnedName } from "./hra/api";
import { NameRegister } from "./hra/NameRegister";
import { NameList } from "./hra/NameList";
import { NameLookup } from "./hra/NameLookup";
import "./hra.css";

// Human Readable Addresses, branded Divi Names.
//
// Plan: Divi-Blockchain_6.9 docs/DIVI-NAMES-PLAN.md. Rules and record encoding
// live in the vendored name-registry crate, so this panel, an explorer and any
// third-party indexer agree by construction rather than by convention.
//
// One namespace covers both human readable addresses and token tickers, so
// GEOFF the person and GEOFF the token can never be two different objects
// owned by two different people.

type Tab = "mine" | "get" | "lookup";

export function HraPanel() {
  const [tab, setTab] = useState<Tab>("mine");
  const [sync, setSync] = useState<HraSync | null>(null);
  const [names, setNames] = useState<OwnedName[]>([]);
  const [loading, setLoading] = useState(true);
  const syncing = useRef(false);

  const refresh = useCallback(() => {
    hraMyNames()
      .then(setNames)
      .catch(() => setNames([]))
      .finally(() => setLoading(false));
  }, []);

  // Read the chain a chunk at a time. Keeping it in the panel rather than a
  // background service means it only runs while somebody is looking at it,
  // which is the right trade for a feature most users open rarely.
  useEffect(() => {
    let alive = true;
    const step = async () => {
      if (syncing.current) return;
      syncing.current = true;
      try {
        const s = await hraSync();
        if (!alive) return;
        setSync(s);
        if (s.activated && s.caughtUp) refresh();
      } catch {
        /* the banner just stays as it was */
      } finally {
        syncing.current = false;
      }
    };
    step();
    const id = setInterval(step, 4000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [refresh]);

  useEffect(refresh, [refresh]);

  // Registering is only safe when the index can be trusted: activated, readable,
  // fee destination known, and actually up to date. Anything less and the
  // availability answer could be stale, which means paying for a taken name.
  const canRegister =
    !!sync?.activated && sync.txindex && sync.caughtUp && sync.treasuryConfigured;

  return (
    <div className="hra">
      <header className="hra-intro">
        <h3 className="ts-head">Human Readable Addresses</h3>
        <p className="wl-note">
          A short name instead of a long string of characters. Own it, point it at your wallet, hang
          your other details off it, and sell it if you want to.
        </p>
      </header>

      {sync && !sync.activated && (
        <div className="hra-banner hra-banner-preview">
          <strong>Not open on the main network yet.</strong> {sync.note}
        </div>
      )}

      {sync?.activated && !sync.txindex && (
        <div className="hra-banner hra-banner-halt">
          <strong>Your node cannot read names yet.</strong> {sync.note}
        </div>
      )}

      {sync?.activated && sync.txindex && !sync.treasuryConfigured && (
        <div className="hra-banner hra-banner-halt">
          <strong>Names are switched off.</strong> {sync.note}
        </div>
      )}

      {sync?.activated && sync.txindex && sync.treasuryConfigured && !sync.caughtUp && (
        <div className="hra-banner hra-banner-behind">
          {sync.note ||
            `Reading the chain: block ${sync.scannedHeight.toLocaleString()} of ${sync.tip.toLocaleString()}.`}
        </div>
      )}

      <nav className="hra-tabs" role="tablist">
        {(
          [
            ["mine", "My Names"],
            ["get", "Get a Name"],
            ["lookup", "Look Up a Name"],
          ] as [Tab, string][]
        ).map(([id, label]) => (
          <button
            key={id}
            className={"hra-tab" + (tab === id ? " hra-tab-on" : "")}
            onClick={() => setTab(id)}
            role="tab"
            aria-selected={tab === id}
          >
            {label}
          </button>
        ))}
      </nav>

      <section className="ts-section">
        {tab === "mine" && (
          <NameList names={names} tip={sync?.tip ?? 0} loading={loading} onChanged={refresh} />
        )}
        {tab === "get" && <NameRegister canRegister={canRegister} onChanged={refresh} />}
        {tab === "lookup" && <NameLookup />}
      </section>

      {/* The honesty line, on every screen. The chain records and orders these
          entries; it does not vouch for them. Saying otherwise would be the
          single most misleading thing this panel could do. */}
      <p className="hra-footnote">
        Names are recorded and put in order by the Divi blockchain. The network itself does not
        police who owns what, so always check the address before sending.
        {sync?.activated && sync.namesKnown > 0 && (
          <> {sync.namesKnown.toLocaleString()} names known, read from your own node.</>
        )}
      </p>
    </div>
  );
}
