import { useEffect, useRef, useState } from "react";
import { recentBlocks, walletAddresses, chainOrphans, type Block, type StaleBlock } from "./api";
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
// A stale block sits at the fork point as a narrow 1:3 marker (the wrap is
// 130px tall). These are genuinely rare — measured ~0.8% of blocks — so this
// is a seldom-seen event marker, not a regular feature of the display.
const ORPHAN_W = 43;

interface LiveBlock extends Block {
  born: number; // client time this block entered the chain (its timeline point)
}

function short(txid: string) {
  return txid.length > 14 ? `${txid.slice(0, 8)}…${txid.slice(-4)}` : txid;
}

export function BlockChainViz() {
  const [blocks, setBlocks] = useState<LiveBlock[]>([]);
  const [orphans, setOrphans] = useState<StaleBlock[]>([]);
  const wrapRef = useRef<HTMLDivElement>(null);
  const panelRefs = useRef<Map<number, HTMLDivElement>>(new Map());
  const orphanRefs = useRef<Map<number, HTMLDivElement>>(new Map());
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

  // Stale blocks our node has seen. Polled slowly — they appear a couple of
  // times a day, so there is nothing to gain from asking often.
  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const r = await chainOrphans();
        if (alive && r) setOrphans(r.stale);
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
        // Park each stale block against the left edge of the block that beat
        // it — that boundary is exactly where the chain forked.
        for (const o of orphans) {
          const el = orphanRefs.current.get(o.height);
          if (!el) continue;
          const b = blocks.find((x) => x.height === o.height);
          if (!b) {
            el.style.display = "none";
            continue;
          }
          el.style.display = "";
          el.style.transform = `translateX(${cw - (now - b.born) * v - ORPHAN_W}px)`;
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
  }, [blocks, orphans]);

  const shownHeights = new Set(blocks.map((b) => b.height));

  return (
    <div className="bv-wrap" ref={wrapRef}>
      {/* Stale blocks — only those whose winning block is currently on screen.
          Styled inline: index.css is the shared collision hotspot. */}
      {orphans
        .filter((o) => shownHeights.has(o.height))
        .map((o) => (
          <div
            key={`orphan-${o.height}`}
            ref={(el) => {
              if (el) orphanRefs.current.set(o.height, el);
              else orphanRefs.current.delete(o.height);
            }}
            title={`Stale block at height ${o.height.toLocaleString()} — minted, then beaten by the block next to it (${o.status}${o.branchLen > 1 ? `, ${o.branchLen}-block branch` : ""}). Seen by this node only.`}
            style={{
              position: "absolute",
              top: 0,
              height: "100%",
              width: ORPHAN_W,
              boxSizing: "border-box",
              background: "rgba(0, 0, 0, 0.5)",
              border: "1px solid rgba(255, 120, 105, 0.55)",
              borderRadius: 8,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              overflow: "hidden",
              pointerEvents: "auto",
              willChange: "transform",
              zIndex: 5,
            }}
          >
            <span
              style={{
                writingMode: "vertical-rl",
                transform: "rotate(180deg)",
                fontSize: "0.58rem",
                fontWeight: 700,
                letterSpacing: "0.14em",
                color: "rgba(255, 140, 125, 0.92)",
                whiteSpace: "nowrap",
              }}
            >
              ORPHAN BLOCK
            </span>
          </div>
        ))}
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
                {/* [node badge] STAKE · +amount — the badge is a purple node circle
                    wearing the black glasses, drawn at exactly the map's proportions
                    (r=6, glasses half-width r*1.5, seated at -r*0.35) so the link to
                    the winning node on the map is unmistakable. Styles are inline on
                    purpose: index.css is the shared collision hotspot. */}
                <div style={{ display: "flex", alignItems: "center", gap: 5, color: "hsl(var(--warning))" }}>
                  <svg viewBox="-9 -7 18 14" width="18" height="14" aria-hidden style={{ flexShrink: 0 }}>
                    <circle cx="0" cy="0" r="6" fill="hsl(var(--primary))" />
                    {/* Glasses shrunk to 80% and dropped ~1px, pivoting on their own
                        centre (y≈-2.1) so they stay seated on the face. */}
                    <g transform="translate(0 -1.1) scale(0.8) translate(0 2.1)">
                      <ellipse cx="-4.5" cy="-2.1" rx="3.78" ry="3.06" fill="rgba(8,8,12,0.95)" />
                      <ellipse cx="4.5" cy="-2.1" rx="3.78" ry="3.06" fill="rgba(8,8,12,0.95)" />
                      <line x1="-1.854" y1="-2.712" x2="1.854" y2="-2.712" stroke="rgba(8,8,12,0.95)" strokeWidth="1.44" />
                      <ellipse cx="-5.634" cy="-3.018" rx="0.945" ry="0.612" fill="rgba(255,255,255,0.25)" />
                      <ellipse cx="3.366" cy="-3.018" rx="0.945" ry="0.612" fill="rgba(255,255,255,0.25)" />
                    </g>
                  </svg>
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
