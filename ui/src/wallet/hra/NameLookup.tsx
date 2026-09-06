import { useEffect, useRef, useState } from "react";
import { hraResolve, hraSearch, type NameHit } from "./api";

// Look a name up. This is the highest-stakes screen in the wallet: a wrong
// answer here sends somebody's money to a stranger. So it does three things
// deliberately:
//
//  * The answer comes only from this machine's own node and its own index.
//    Nothing is asked of any server.
//  * The send-to address always comes from hraResolve, which REFUSES to answer
//    from an index that has not finished reading the chain. The search that
//    powers the match list carries no address for exactly this reason: a stale
//    address shown with a Copy button would send money to the wrong place.
//  * An exact match is shown first and in bold, with its address. Other names
//    that contain what you typed are listed below (names only, click to open),
//    so a near-miss is visible rather than silently treated as "not found".

export function NameLookup() {
  const [typed, setTyped] = useState("");
  const [hits, setHits] = useState<NameHit[]>([]);
  const [searched, setSearched] = useState(false);
  const [searchErr, setSearchErr] = useState("");

  // The authoritative, freshness-guarded answer for the exact match.
  const [addr, setAddr] = useState<string | null | undefined>(undefined);
  const [addrErr, setAddrErr] = useState("");
  const [copied, setCopied] = useState(false);

  const searchLive = useRef(true);
  const resolveLive = useRef(true);

  const exact = hits.find((h) => h.exact) ?? null;
  const others = hits.filter((h) => !h.exact);

  // Search for matches as the user types.
  useEffect(() => {
    const clean = typed.trim();
    if (!clean) {
      setHits([]);
      setSearched(false);
      setSearchErr("");
      return;
    }
    searchLive.current = true;
    const t = setTimeout(() => {
      hraSearch(clean)
        .then((h) => {
          if (!searchLive.current) return;
          setHits(h);
          setSearched(true);
          setSearchErr("");
        })
        .catch((e) => searchLive.current && setSearchErr(String(e)));
    }, 300);
    return () => {
      searchLive.current = false;
      clearTimeout(t);
    };
  }, [typed]);

  // Whenever there is an exact match, resolve its address through the guarded
  // path. This is the only place an address is ever produced on this screen.
  const exactName = exact?.name ?? "";
  useEffect(() => {
    if (!exactName) {
      setAddr(undefined);
      setAddrErr("");
      return;
    }
    resolveLive.current = true;
    setAddr(undefined);
    setAddrErr("");
    setCopied(false);
    hraResolve(exactName)
      .then((a) => resolveLive.current && setAddr(a))
      .catch((e) => resolveLive.current && setAddrErr(String(e)));
    return () => {
      resolveLive.current = false;
    };
  }, [exactName]);

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
          maxLength={32}
          spellCheck={false}
          autoCapitalize="off"
        />
      </label>

      {exact && (
        <div className="hra-answer">
          <div className="hra-answer-label">
            <strong className="mono">{exact.name.toLowerCase()}</strong> sends to
          </div>
          {addrErr ? (
            <p className="wl-err">{addrErr}</p>
          ) : typeof addr === "string" ? (
            <>
              <div className="mono hra-answer-addr">{addr}</div>
              <button className="wl-btn" onClick={() => { navigator.clipboard?.writeText(addr); setCopied(true); }}>
                {copied ? "Copied" : "Copy address"}
              </button>
              <p className="wl-note hra-dim">
                Check this against what the person told you before sending anything. A name is a
                convenience, not a guarantee.
              </p>
            </>
          ) : addr === null ? (
            <p className="wl-err">
              This name is registered but its owner has not pointed it at an address yet. Do not send
              anything to it.
            </p>
          ) : (
            <p className="wl-note">Reading the chain…</p>
          )}
        </div>
      )}

      {others.length > 0 && (
        <div className="hra-otherhits">
          <div className="hra-sub">{exact ? "Other names that contain that" : "Names that contain that"}</div>
          {others.map((h) => (
            <button key={h.name} className="hra-hit-row" onClick={() => setTyped(h.name.toLowerCase())}>
              <span className="mono hra-hit-name">{h.name.toLowerCase()}</span>
              <span className="hra-dim hra-hit-addr">
                {h.hasAddress ? "points at an address" : "not pointed anywhere yet"}
              </span>
            </button>
          ))}
        </div>
      )}

      {searched && hits.length === 0 && !searchErr && (
        <p className="wl-err">No names match that. Either nobody has registered one, or your node is still reading the chain.</p>
      )}

      {searchErr && <p className="wl-err">{searchErr}</p>}
    </div>
  );
}
