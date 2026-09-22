import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { restoreReplace, restoreSecondNode, seedCheck, walletHoldings, type Holdings, type SeedCheck } from "./api";
import { fmtDivi } from "../status";

// Restore a wallet from its seed phrase. Two ways out:
//   1. Create a second node in the app: a new local node on the restored
//      wallet, alongside the current one. Nothing here is touched.
//   2. Replace this node's wallet: the current wallet file is renamed and
//      kept, and the node runs on the restored one from then on. Anything
//      in the current wallet becomes unreachable unless ITS seed phrase was
//      written down. So the app shows what is in it, and asks twice.
//
// The phrase is read in whatever shape it was pasted (spaces, commas, lines,
// numbering), checked against the word list and its checksum, and shown
// alongside its other form, the 64-hex-byte private key. Same secret, two
// spellings. Neither is stored by this screen.

type Path = "second" | "replace";
type Stage = "type" | "choose" | "confirm" | "working" | "done";

const NFD_STORE_KEY = "nfd.collectibles.v1";
function localNfdCount(): number {
  try {
    const v = JSON.parse(localStorage.getItem(NFD_STORE_KEY) || "[]");
    return Array.isArray(v) ? v.length : 0;
  } catch {
    return 0;
  }
}

export function RestoreFromSeed({ nodeLabel, onDone }: { nodeLabel: string; onDone: () => void }) {
  const [phrase, setPhrase] = useState("");
  const [chk, setChk] = useState<SeedCheck | null>(null);
  const [stage, setStage] = useState<Stage>("type");
  const [path, setPath] = useState<Path | null>(null);
  const [label, setLabel] = useState("Restored wallet");
  const [holdings, setHoldings] = useState<Holdings | null>(null);
  const [tick, setTick] = useState(false); // the in-panel confirmation
  const [modal, setModal] = useState(false); // the second, modal confirmation
  const [progress, setProgress] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const debounce = useRef<number | undefined>(undefined);

  // Check the phrase as it is typed, a moment after the last keystroke.
  useEffect(() => {
    window.clearTimeout(debounce.current);
    if (!phrase.trim()) return setChk(null);
    debounce.current = window.setTimeout(() => {
      seedCheck(phrase).then(setChk).catch(() => setChk(null));
    }, 350);
    return () => window.clearTimeout(debounce.current);
  }, [phrase]);

  useEffect(() => {
    if (stage !== "choose") return;
    walletHoldings().then(setHoldings).catch(() => setHoldings(null));
  }, [stage]);

  useEffect(() => {
    const ev = (window as unknown as { __TAURI__?: { event?: { listen: (n: string, cb: (e: { payload: { stage?: string } }) => void) => Promise<() => void> } } }).__TAURI__?.event;
    let off: (() => void) | undefined;
    ev?.listen("dd69://restore-progress", (e) => setProgress(e.payload?.stage ?? "")).then((u) => (off = u)).catch(() => {});
    return () => off?.();
  }, []);

  const copyHex = () => {
    if (!chk?.seedHex) return;
    navigator.clipboard?.writeText(chk.seedHex).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    });
  };

  const nfds = localNfdCount();
  const hasSomething = (holdings?.divi ?? 0) > 0 || nfds > 0;

  const run = async () => {
    if (!path) return;
    setModal(false);
    setStage("working");
    setMsg(null);
    try {
      if (path === "replace") {
        setProgress("Stopping the node, restoring the wallet, then finding its coins on the chain. This can take a long while.");
        const r = await restoreReplace(phrase);
        setMsg(r);
      } else {
        const id = await restoreSecondNode(phrase, label);
        setMsg(`Created "${label}" and switched to it (${id}). It is finding its coins now.`);
      }
      setPhrase("");
      setChk(null);
      setStage("done");
      onDone();
    } catch (e) {
      setMsg(String(e));
      setStage("choose");
    }
  };

  if (stage === "done") {
    return (
      <div className="pw-box">
        <p className="pw-msg">{msg}</p>
        <button type="button" className="wl-btn" onClick={() => setStage("type")}>Restore another</button>
      </div>
    );
  }

  if (stage === "working") {
    return (
      <div className="pw-box">
        <p className="set-note">{progress || "Working…"}</p>
        <p className="pw-msg">Leave the app open. Finding every coin means reading the whole blockchain.</p>
      </div>
    );
  }

  return (
    <div className="pw-box rs-box">
      <h4 className="pw-sub">Restore from a seed phrase</h4>
      <textarea
        className="wl-input rs-phrase"
        rows={3}
        placeholder="Paste or type the 12 words. Spaces, commas or one per line all work."
        value={phrase}
        onChange={(e) => { setPhrase(e.target.value); setStage("type"); setPath(null); setTick(false); }}
        spellCheck={false}
        autoComplete="off"
      />
      {chk && !chk.ok && <p className="pw-msg rs-bad">{chk.problem}</p>}
      {chk?.ok && (
        <>
          <p className="pw-msg rs-good">{chk.wordCount} words, a valid seed phrase.</p>
          <div className="rs-key">
            <span className="rs-key-label">The same key in its other form (private key, hex):</span>
            <code className="rs-key-hex">{chk.seedHex}</code>
            <button type="button" className="wl-btn" onClick={copyHex}>{copied ? "Copied" : "Copy"}</button>
          </div>
        </>
      )}

      {chk?.ok && stage === "type" && (
        <button type="button" className="wl-btn wl-btn-primary" onClick={() => setStage("choose")}>
          Continue
        </button>
      )}

      {chk?.ok && (stage === "choose" || stage === "confirm") && (
        <div className="rs-choose">
          <label className={"rs-option" + (path === "second" ? " on" : "")}>
            <input type="radio" name="rs-path" checked={path === "second"} onChange={() => { setPath("second"); setTick(false); }} />
            <span>
              <b>Create a second node in the app</b>
              <small>A new node on the restored wallet, alongside <b>{nodeLabel}</b>. Nothing here changes.</small>
            </span>
          </label>
          <label className={"rs-option" + (path === "replace" ? " on" : "")}>
            <input type="radio" name="rs-path" checked={path === "replace"} onChange={() => { setPath("replace"); setTick(false); }} />
            <span>
              <b>Replace this node’s wallet</b>
              <small>
                <b>{nodeLabel}</b> switches to the restored wallet. Its current wallet file is kept, renamed, but the app
                stops using it.
              </small>
            </span>
          </label>

          {path === "second" && (
            <input className="wl-input" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Name for the new node" maxLength={40} />
          )}

          {path === "replace" && (
            <div className="rs-warn">
              {holdings?.known ? (
                <>
                  The wallet on <b>{nodeLabel}</b> currently holds <b>{fmtDivi(holdings.divi)} DIVI</b>
                  {nfds > 0 ? <> and <b>{nfds} collectible{nfds === 1 ? "" : "s"}</b></> : null}.
                  {hasSomething
                    ? " After replacing, they are unreachable from this app unless you have written down THAT wallet’s seed phrase."
                    : " It is empty."}
                </>
              ) : (
                <>Could not read what the wallet on <b>{nodeLabel}</b> holds. Treat it as if it holds something.</>
              )}
              <label className="pw-check">
                <input type="checkbox" checked={tick} onChange={(e) => setTick(e.target.checked)} />
                I understand. I have the current wallet’s seed phrase written down, or I accept losing what is in it.
              </label>
            </div>
          )}

          <button
            type="button"
            className="wl-btn wl-btn-primary"
            disabled={!path || (path === "replace" && !tick) || (path === "second" && !label.trim())}
            onClick={() => (path === "replace" ? setModal(true) : run())}
          >
            {path === "replace" ? "Replace this wallet" : "Create the node"}
          </button>
        </div>
      )}
      {msg && <p className="pw-msg">{msg}</p>}

      {modal &&
        createPortal(
          <div className="poe-modal-backdrop" onClick={() => setModal(false)} role="presentation">
            <div className="poe-modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Confirm replacing the wallet">
              <div className="poe-modal-head"><h3>Last check</h3></div>
              <div className="poe-modal-body">
                <p className="wl-note">
                  You are about to replace the wallet on <b>{nodeLabel}</b>.
                  {holdings?.known && hasSomething ? (
                    <> It holds <b>{fmtDivi(holdings.divi)} DIVI</b>{nfds > 0 ? <> and <b>{nfds} collectible{nfds === 1 ? "" : "s"}</b></> : null}. Without that wallet’s own seed phrase, written down, they are lost.</>
                  ) : (
                    <> Without that wallet’s own seed phrase, written down, anything in it is lost.</>
                  )}
                </p>
                <div className="upd-actions">
                  <button type="button" className="upd-go" onClick={run}>Yes, replace it</button>
                  <button type="button" className="wl-btn" onClick={() => setModal(false)}>Cancel</button>
                </div>
              </div>
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}
