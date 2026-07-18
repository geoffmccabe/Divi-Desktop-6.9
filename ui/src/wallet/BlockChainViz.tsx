import { useEffect, useRef, useState } from "react";
import { recentBlocks, walletAddresses, type Block } from "./api";
import { markUserWon } from "./stakeWin";
import nyan from "../assets/nyan_cat.webp";

// The block-chain visualization: a chain of translucent panels drifting slowly
// right→left across the map bottom at ONE CONSTANT speed (5 minutes to cross).
// Each block's WIDTH equals the real time it took (interval to the next block),
// so blocks tile the timeline seamlessly — never a gap, overlap, or pause, and a
// slower block is simply wider. Styled to match the map: translucent black with
// thin purple edges, like the node-connection lines.

const CROSS_MS = 5 * 60 * 1000; // 5 minutes to traverse the panel width
const NOMINAL_MS = 60 * 1000; // seed spacing (~1 block/min)

interface LiveBlock extends Block {
  born: number; // client time this block entered the chain (its timeline point)
}

function short(txid: string) {
  return txid.length > 14 ? `${txid.slice(0, 8)}…${txid.slice(-4)}` : txid;
}

export function BlockChainViz() {
  const [blocks, setBlocks] = useState<LiveBlock[]>([]);
  const wrapRef = useRef<HTMLDivElement>(null);
  const panelRefs = useRef<Map<number, HTMLDivElement>>(new Map());
  const lastHeight = useRef(0);
  const lastAdd = useRef(0);
  const userAddrs = useRef<Set<string>>(new Set());

  // The node-wallet's own addresses — used to tell if a block was won by the user.
  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const a = await walletAddresses();
        if (alive && a.length) userAddrs.current = new Set(a.map((x) => x.address));
      } catch {
        /* keep what we have */
      }
    };
    load();
    const id = setInterval(load, 120000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  useEffect(() => {
    let alive = true;
    let seeded = false;
    const poll = async () => {
      try {
        // Fetch a window (not just the tip) so no block is ever skipped when the
        // height jumps by more than one between polls.
        const bs = await recentBlocks(seeded ? 8 : 6);
        if (!alive || bs.length === 0) return;
        if (!seeded) {
          seeded = true;
          const now = Date.now();
          // seed spread ~1/min into the past so they tile the timeline
          const seedBlocks = bs.map((b, i) => ({ ...b, born: now - (bs.length - 1 - i) * NOMINAL_MS }));
          lastHeight.current = bs[bs.length - 1].height;
          lastAdd.current = now;
          setBlocks(seedBlocks);
        } else {
          const newOnes = bs.filter((b) => b.height > lastHeight.current).sort((a, b) => a.height - b.height);
          if (newOnes.length) {
            const now = Date.now();
            const gap = Math.max(1, now - lastAdd.current);
            // distribute the elapsed time across the new blocks, weighted by their
            // real block-time intervals → a slower block ends up wider.
            const intervals = newOnes.map((b, j) => (j === 0 ? 1 : Math.max(1, b.time - newOnes[j - 1].time)));
            const total = intervals.reduce((a, x) => a + x, 0);
            let acc = 0;
            const added = newOnes.map((b, j) => {
              acc += intervals[j];
              return { ...b, born: lastAdd.current + (acc / total) * gap };
            });
            lastHeight.current = newOnes[newOnes.length - 1].height;
            lastAdd.current = now;
            // If the user won any of these new blocks, flag it (lights up our node).
            if (added.some((b) => b.stakeWinner && userAddrs.current.has(b.stakeWinner))) markUserWon();
            setBlocks((prev) => [...prev, ...added]);
          }
        }
      } catch {
        /* keep what we have */
      }
    };
    poll();
    const id = setInterval(poll, 15000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const wrap = wrapRef.current;
      if (wrap && blocks.length) {
        const cw = wrap.clientWidth;
        const v = cw / CROSS_MS; // px per ms — one constant speed
        const now = Date.now();
        let anyOff = false;
        for (let i = 0; i < blocks.length; i++) {
          const b = blocks[i];
          const el = panelRefs.current.get(b.height);
          if (!el) continue;
          // block i owns the timeline slice [born(i), born(i+1)] (or → now for
          // the newest, which grows until the next block is found)
          const rightT = i < blocks.length - 1 ? blocks[i + 1].born : now;
          const xL = cw - (now - b.born) * v;
          const xR = cw - (now - rightT) * v;
          if (xR < 0) anyOff = true;
          el.style.transform = `translateX(${xL}px)`;
          el.style.width = `${Math.max(0, xR - xL)}px`;
        }
        if (anyOff) {
          setBlocks((prev) => {
            const n = Date.now();
            return prev.filter((_b, i) => {
              const rt = i < prev.length - 1 ? prev[i + 1].born : n;
              return cw - (n - rt) * v >= 0;
            });
          });
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [blocks]);

  return (
    <div className="bv-wrap" ref={wrapRef}>
      {blocks.map((b) => {
        const scroll = b.txids.length > 6;
        const list = scroll ? [...b.txids, ...b.txids] : b.txids;
        const wonByUser = !!(b.stakeWinner && userAddrs.current.has(b.stakeWinner));
        return (
          <div
            key={b.height}
            className={"bv-panel" + (wonByUser ? " bv-rainbow" : "")}
            ref={(el) => {
              if (el) panelRefs.current.set(b.height, el);
              else panelRefs.current.delete(b.height);
            }}
          >
            {wonByUser && <img className="bv-nyan" src={nyan} alt="" />}
            <div className="bv-height">Block #{b.height.toLocaleString()}</div>
            {b.stakeWinner && (
              <div className="bv-stake">
                {/* STAKE · +amount · sunglasses — the glasses inherit the gold via
                    currentColor (styles inline to stay out of the shared index.css) */}
                <div style={{ display: "flex", alignItems: "center", gap: 5, color: "hsl(var(--warning))" }}>
                  <span style={{ fontSize: "0.62rem", fontWeight: 700, letterSpacing: "0.06em" }}>
                    {wonByUser ? "STAKE WON BY YOU" : "STAKE"}
                  </span>
                  {b.stakeAmount != null && (
                    <span
                      style={{
                        fontSize: "0.7rem",
                        fontWeight: 600,
                        color: "hsl(var(--success))",
                        fontFamily: "ui-monospace, monospace",
                      }}
                    >
                      +{b.stakeAmount.toLocaleString(undefined, { maximumFractionDigits: 2 })} $DIVI
                    </span>
                  )}
                  <svg viewBox="0 0 24 14" width="16" height="9" aria-hidden style={{ fill: "currentColor", flexShrink: 0 }}>
                    <ellipse cx="6" cy="7" rx="5.5" ry="4.5" />
                    <ellipse cx="18" cy="7" rx="5.5" ry="4.5" />
                    <rect x="10.5" y="5.8" width="3" height="1.6" rx="0.6" />
                  </svg>
                </div>
                <div className="bv-stake-line">Winner: {short(b.stakeWinner)}</div>
              </div>
            )}
            <div className="bv-txs-hdr">Transactions ({b.txids.length})</div>
            <div className="bv-txs">
              <div
                className={"bv-txs-inner" + (scroll ? " bv-scrolling" : "")}
                style={scroll ? { animationDuration: `${b.txids.length * 2}s` } : undefined}
              >
                {list.map((t, i) => (
                  <div key={i} className="bv-tx">{short(t)}</div>
                ))}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
