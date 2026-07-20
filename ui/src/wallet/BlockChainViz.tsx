import { useEffect, useRef, useState } from "react";
import { recentBlocks, walletAddresses, type Block, type StaleBlock } from "./api";
import { loadHealth } from "./chainHealth";
import { markUserWon } from "./stakeWin";
import nyan from "../assets/nyan_cat.webp";

// The block-chain visualization: a chain of translucent panels drifting slowly
// right→left across the map bottom at ONE CONSTANT speed (5 minutes to cross).
// Each block's WIDTH equals the real time it took (interval to the next block),
// so blocks tile the timeline seamlessly — never a gap, overlap, or pause, and a
// slower block is simply wider. Styled to match the map: translucent black with
// thin purple edges, like the node-connection lines.

const CROSS_MS = 5 * 60 * 1000; // 5 minutes to traverse the panel width
// Divi's PoS block timestamps are far too jittery to use as widths (they swing
// wildly and can even run backwards), so each block gets a UNIFORM one-minute
// slice — exactly 5 across the 5-minute window — and simply slides in as it's
// found. This is timestamp-independent, so nothing (noise, backgrounding) distorts it.
const NOMINAL_MS = 60 * 1000;
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
  const lastBorn = useRef(0); // uniform timeline point (left edge) of the newest block
  const chainNow = useRef(0); // eased right-edge position; slides to follow new blocks
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

  // Stale blocks. Read from the stored history rather than asking the node:
  // getchaintips costs ~18 seconds and stalls the node's block processing, so
  // it is fetched only when the user opens Settings → Chain Health. Orphans
  // appear a couple of times a day, so nothing is lost by reading a cache.
  useEffect(() => {
    const read = () =>
      setOrphans(loadHealth().forks.map((f) => ({ height: f.height, status: f.status, branchLen: f.branchLen })));
    read();
    const id = setInterval(read, 60000);
    return () => clearInterval(id);
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
          // Uniform one-minute slices, tiled by order (height). No timestamps.
          const sorted = [...bs].sort((a, b) => a.height - b.height);
          const seedBlocks = sorted.map((b, i) => ({ ...b, born: i * NOMINAL_MS }));
          lastHeight.current = sorted[sorted.length - 1].height;
          lastBorn.current = (sorted.length - 1) * NOMINAL_MS;
          chainNow.current = lastBorn.current + NOMINAL_MS; // newest block's right edge
          setBlocks(seedBlocks);
        } else {
          const newOnes = bs.filter((b) => b.height > lastHeight.current).sort((a, b) => a.height - b.height);
          if (newOnes.length) {
            // Each new block gets the next uniform slice; the strip slides to reveal it.
            let born = lastBorn.current;
            const added = newOnes.map((b) => {
              born += NOMINAL_MS;
              return { ...b, born };
            });
            lastHeight.current = newOnes[newOnes.length - 1].height;
            lastBorn.current = born;
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
        const v = cw / CROSS_MS; // px per ms
        // Ease the right edge toward the newest block so new blocks slide in; snap
        // if it has fallen far behind (e.g. returning from the background) rather
        // than crawling for a long time.
        const now = chainNow.current;
        const target = lastBorn.current + NOMINAL_MS;
        if (target - now > CROSS_MS) chainNow.current = target - CROSS_MS;
        chainNow.current += (target - chainNow.current) * 0.06;
        const cn = chainNow.current;
        let anyOff = false;
        for (let i = 0; i < blocks.length; i++) {
          const b = blocks[i];
          const el = panelRefs.current.get(b.height);
          if (!el) continue;
          // every block is one uniform minute wide
          const rightT = b.born + NOMINAL_MS;
          const xL = cw - (cn - b.born) * v;
          const xR = cw - (cn - rightT) * v;
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
          el.style.transform = `translateX(${cw - (cn - b.born) * v - ORPHAN_W}px)`;
        }
        if (anyOff) {
          setBlocks((prev) => {
            const n = chainNow.current;
            return prev.filter((b) => cw - (n - (b.born + NOMINAL_MS)) * v >= 0);
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
