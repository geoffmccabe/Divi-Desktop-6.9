import { useCallback, useEffect, useReducer, useRef } from "react";
import { mempoolSnapshot, type MemEntry } from "./api";

// A live view of the node's mempool. It polls quickly while open and keeps
// itself current; the node stays synced from its peers over P2P (a wallet can't
// force peers to hand over their mempool, so "the network mempool" here means
// everything our node has heard). New or changed txs flash bold; anything
// touching the user's wallet shows bright orange. A new block clears the txs it
// confirmed and shows a "Block N Written" banner.

interface Row {
  txid: string;
  size: number;
  feeSats: number;
  time: number;
  firstSeen: number; // ms, when THIS client first saw it (for sort + flash)
  hotUntil: number; // ms, flash/bold until this time
  mine: boolean;
  category: string;
  hasData: boolean;
  amountMine: number;
}

const POLL_MS = 2500; // refresh the mempool
const TICK_MS = 350; // decay the flash highlight promptly between polls
const FLASH_MS = 1500;
const BLOCK_MS = 6000; // how long the "Block N Written" banner lingers

function shortTxid(t: string): string {
  return t.length > 14 ? `${t.slice(0, 6)}…${t.slice(-6)}` : t;
}
function fmtFee(sats: number): string {
  return sats > 0 ? `${(sats / 1e8).toFixed(sats < 1e6 ? 5 : 3)}` : "0";
}

export function Mempool({ onClose }: { onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const rowsRef = useRef<Map<string, Row>>(new Map());
  const tipRef = useRef<number>(0);
  const blockMsgRef = useRef<{ height: number; until: number } | null>(null);
  const loadingRef = useRef(true);
  const [, force] = useReducer((x) => x + 1, 0);

  // Don't let scroll/click inside the panel zoom or pan the map.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const stop = (e: Event) => e.stopPropagation();
    el.addEventListener("wheel", stop, { passive: false });
    el.addEventListener("mousedown", stop);
    return () => {
      el.removeEventListener("wheel", stop);
      el.removeEventListener("mousedown", stop);
    };
  }, []);

  const merge = useCallback((snap: { tip: number; entries: MemEntry[] }) => {
    const now = Date.now();
    const map = rowsRef.current;
    const seen = new Set<string>();

    // A new block that moved the tip: announce it, and the confirmed txs below
    // will simply drop out of the mempool on this same refresh.
    if (tipRef.current && snap.tip > tipRef.current) {
      blockMsgRef.current = { height: snap.tip, until: now + BLOCK_MS };
    }
    tipRef.current = snap.tip;

    for (const e of snap.entries) {
      seen.add(e.txid);
      const prev = map.get(e.txid);
      if (!prev) {
        map.set(e.txid, {
          txid: e.txid,
          size: e.size,
          feeSats: e.feeSats,
          time: e.time,
          firstSeen: now,
          hotUntil: loadingRef.current ? 0 : now + FLASH_MS, // no flash on the first fill
          mine: e.mine,
          category: e.category,
          hasData: e.hasData,
          amountMine: e.amountMine,
        });
      } else {
        const changed = prev.size !== e.size || prev.feeSats !== e.feeSats;
        prev.size = e.size;
        prev.feeSats = e.feeSats;
        prev.time = e.time;
        if (e.decoded) {
          prev.mine = e.mine;
          prev.category = e.category;
          prev.hasData = e.hasData;
          prev.amountMine = e.amountMine;
        }
        if (changed && !loadingRef.current) prev.hotUntil = now + FLASH_MS;
      }
    }
    // Drop txids that left the mempool (mined or evicted).
    for (const txid of [...map.keys()]) if (!seen.has(txid)) map.delete(txid);

    loadingRef.current = false;
    force();
  }, []);

  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const snap = await mempoolSnapshot([...rowsRef.current.keys()]);
        if (alive && snap) merge(snap);
      } catch {
        /* keep last */
      }
      if (alive) timer = setTimeout(poll, POLL_MS);
    };
    poll();
    // Fast display tick so flashes clear on time even between network polls.
    const tick = setInterval(force, TICK_MS);
    return () => {
      alive = false;
      clearTimeout(timer);
      clearInterval(tick);
    };
  }, [merge]);

  const now = Date.now();
  const rows = [...rowsRef.current.values()].sort(
    (a, b) => (b.time || b.firstSeen / 1000) - (a.time || a.firstSeen / 1000) || b.firstSeen - a.firstSeen
  );
  const block = blockMsgRef.current && blockMsgRef.current.until > now ? blockMsgRef.current : null;

  return (
    <div className="mempool" ref={ref}>
      <div className="fn-head">
        <span className="fn-title">Mempool</span>
        <span className="mp-count">{rows.length}</span>
        <button type="button" className="fn-close" onClick={onClose} title="Close">
          ×
        </button>
      </div>
      <div className="fn-note">Live from this node, refreshing every {POLL_MS / 1000}s.</div>
      {block && (
        <div className="mp-block">Block {block.height.toLocaleString()} Written</div>
      )}
      <div className="fn-cols mp-cols">
        <span>Txid</span>
        <span>bytes</span>
        <span className="fn-ms-h">fee</span>
      </div>
      <div className="fn-list">
        {loadingRef.current ? (
          <div className="fn-empty">Reading the mempool…</div>
        ) : rows.length === 0 ? (
          <div className="fn-empty">Mempool is empty.</div>
        ) : (
          rows.map((r) => {
            const hot = r.hotUntil > now;
            const cls =
              "mp-row" +
              (r.mine ? " mine" : "") +
              (hot ? " hot" : "");
            const tag = r.mine
              ? r.hasData
                ? r.category === "receive"
                  ? "incoming message"
                  : "message"
                : r.category === "receive"
                  ? "incoming"
                  : "outgoing"
              : r.hasData
                ? "data"
                : "";
            return (
              <div key={r.txid} className={cls} title={r.txid}>
                <span className="mp-txid">
                  {shortTxid(r.txid)}
                  {tag && <span className="mp-tag">{tag}</span>}
                </span>
                <span className="mp-size">{r.size.toLocaleString()}</span>
                <span className="mp-fee">{fmtFee(r.feeSats)}</span>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
