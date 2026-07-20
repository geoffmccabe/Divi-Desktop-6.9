import { useEffect, useState } from "react";
import { DMT_STUB, dmtSyncState, type SyncState } from "./dmt/api";
import { TokenList } from "./dmt/TokenList";
import { TokenSend } from "./dmt/TokenSend";
import { TokenCreate } from "./dmt/TokenCreate";
import "./dmt.css";

// Divi Meta Tokens (DMT). Spec: Divi-Blockchain_6.9 docs/DMT-TOKENS-SPEC.md.
// The wallet's obligations are §11 there, restated in docs/DMT-WALLET-INTERFACE.md.
//
// Note what is deliberately ABSENT: there is no coin-protection UI, no lock
// list, no "protected coin" marker. Tokens are tracked as address balances, so
// the hazard those would guard against does not exist — and showing guards would
// imply it does (spec §11.3).

type Tab = "holdings" | "send" | "create";

export function TokensPanel() {
  const [tab, setTab] = useState<Tab>("holdings");
  const [sync, setSync] = useState<SyncState | null>(null);

  useEffect(() => {
    let alive = true;
    const load = () =>
      dmtSyncState()
        .then((s) => alive && setSync(s))
        .catch(() => {
          /* the banner simply stays unknown */
        });
    load();
    const id = setInterval(load, 30000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  // Sending must be blocked whenever the index cannot be trusted: halted, or so
  // far behind that a balance could already be spent. A wallet that spends from
  // state it knows may be wrong is worse than one that stops (interface doc §4).
  const behind = sync ? Math.max(0, sync.tip - sync.height) : 0;
  const trustworthy = !DMT_STUB && sync != null && !sync.halted && behind <= 2;

  return (
    <div className="dmt">
      <header className="dmt-intro">
        <h3 className="ts-head">Divi Meta Tokens</h3>
        <p className="wl-note">
          Tokens issued on the Divi blockchain — currencies, tickets, passes, credits and community
          tokens. Balances are recorded and ordered by the Divi chain.
        </p>
      </header>

      {/* The index is not built yet. Say so plainly and make the numbers
          obviously fake — a believable placeholder is worse than none, because
          somebody could mistake it for their actual holdings. */}
      {DMT_STUB && (
        <div className="dmt-banner dmt-banner-preview">
          <strong>Preview only.</strong> The token index isn’t running yet, so the figures below are
          worked examples, not real holdings. Sending is disabled until it’s live.
        </div>
      )}

      {!DMT_STUB && sync?.halted && (
        <div className="dmt-banner dmt-banner-halt">
          <strong>Token index stopped.</strong> {sync.haltReason ?? "It can no longer be trusted."}{" "}
          Balances may be wrong, so sending is disabled.
        </div>
      )}

      {!DMT_STUB && sync && !sync.halted && behind > 2 && (
        <div className="dmt-banner dmt-banner-behind">
          Catching up — {behind.toLocaleString()} blocks behind. Balances may be out of date.
        </div>
      )}

      <nav className="dmt-tabs" role="tablist">
        <button
          className={"dmt-tab" + (tab === "holdings" ? " dmt-tab-on" : "")}
          onClick={() => setTab("holdings")}
          role="tab"
          aria-selected={tab === "holdings"}
        >
          My Tokens
        </button>
        <button
          className={"dmt-tab" + (tab === "send" ? " dmt-tab-on" : "")}
          onClick={() => setTab("send")}
          role="tab"
          aria-selected={tab === "send"}
        >
          Send
        </button>
        <button
          className={"dmt-tab" + (tab === "create" ? " dmt-tab-on" : "")}
          onClick={() => setTab("create")}
          role="tab"
          aria-selected={tab === "create"}
        >
          Create a Token
        </button>
      </nav>

      <section className="ts-section">
        {tab === "holdings" && <TokenList />}
        {tab === "send" && <TokenSend canSend={trustworthy} />}
        {tab === "create" && <TokenCreate canSend={trustworthy} />}
      </section>

      {sync && !DMT_STUB && (
        <p className="dmt-syncline">
          Indexed to block {sync.height.toLocaleString()}
          {sync.fingerprint && (
            <>
              {" · "}
              <span
                className="mono"
                title="A running fingerprint of the token ledger. Anyone running their own indexer should compute the same value — that is how two implementations detect a disagreement immediately."
              >
                {sync.fingerprint.slice(0, 12)}…
              </span>
            </>
          )}
        </p>
      )}
    </div>
  );
}
