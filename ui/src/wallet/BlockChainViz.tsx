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

// Each block is a FIXED 20% of the panel — exactly 5 across — positioned purely by
// order (no block timestamps, no animation loop), so nothing can drift or compound
// over time. CSS transitions the slide when a new block appears.
const BLOCK_PCT = 20; // one block's width, % of the panel
const MAX_BLOCKS = 8; // a few past the 5 visible, for a smooth slide-off the left
const EXPECTED_MS = 60_000; // Divi's ~1-minute block time — the drift the strip covers between blocks
// A stale block sits at the fork point as a narrow 1:3 marker (the wrap is
// 130px tall). These are genuinely rare — measured ~0.8% of blocks — so this
// is a seldom-seen event marker, not a regular feature of the display.
const ORPHAN_W = 43;

function short(txid: string) {
  return txid.length > 14 ? `${txid.slice(0, 8)}…${txid.slice(-4)}` : txid;
}

export function BlockChainViz() {
  const [blocks, setBlocks] = useState<Block[]>([]);
  const [orphans, setOrphans] = useState<StaleBlock[]>([]);
  const wrapRef = useRef<HTMLDivElement>(null);
  const panelRefs = useRef<Map<number, HTMLDivElement>>(new Map());
  const orphanRefs = useRef<Map<number, HTMLDivElement>>(new Map());
  const lastHeight = useRef(0);
  const lastAddTime = useRef(0); // client time the newest block arrived — drives the continuous drift
  const blocksRef = useRef<Block[]>([]);
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
          const sorted = [...bs].sort((a, b) => a.height - b.height);
          lastHeight.current = sorted[sorted.length - 1].height;
          lastAddTime.current = performance.now();
          setBlocks(sorted.slice(-MAX_BLOCKS));
        } else {
          const newOnes = bs.filter((b) => b.height > lastHeight.current).sort((a, b) => a.height - b.height);
          if (newOnes.length) {
            lastHeight.current = newOnes[newOnes.length - 1].height;
            lastAddTime.current = performance.now();
            // If the user won any of these new blocks, flag it (lights up our node).
            if (newOnes.some((b) => b.stakeWinner && userAddrs.current.has(b.stakeWinner))) markUserWon();
            setBlocks((prev) => [...prev, ...newOnes].slice(-MAX_BLOCKS));
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

  // Continuous right→left drift, but ANCHORED to order so it can never drift or
  // compound (the bug the fixed-slot version was avoiding). Each block's slot is
  // order-based; between blocks the whole strip creeps left by up to one slot,
  // driven by `frac` ∈ [0,1] = how far we are toward the next expected block.
  // When a block lands, N grows and `frac` resets to 0 — and because the newest
  // block's slot is exactly where the drift had carried the previous one, the
  // hand-off is seamless with no jump.
  const N = blocks.length;
  const leftPctOf = (i: number, frac: number) => 100 - (N - i + frac) * BLOCK_PCT; // newest, frac 0 → 80%
  const shownHeights = new Set(blocks.map((b) => b.height));
  blocksRef.current = blocks;

  useEffect(() => {
    let raf = 0;
    // The strip drifts one slot per minute, so repositioning at the display's
    // full frame rate was pure waste — continuous layout work the entire time
    // the window was open. 10 updates a second is indistinguishable for a
    // movement this slow, and requestAnimationFrame still pauses everything
    // when the window is hidden.
    let lastPaint = 0;
    const tick = () => {
      const now = performance.now();
      if (now - lastPaint >= 100) {
        lastPaint = now;
        const bs = blocksRef.current;
        const n = bs.length;
        const frac = Math.min(1, Math.max(0, (now - lastAddTime.current) / EXPECTED_MS));
        for (let i = 0; i < n; i++) {
          const b = bs[i];
          const left = 100 - (n - i + frac) * BLOCK_PCT;
          const el = panelRefs.current.get(b.height);
          if (el) el.style.left = `${left}%`;
          const oel = orphanRefs.current.get(b.height);
          if (oel) oel.style.left = `calc(${left}% - ${ORPHAN_W}px)`;
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

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
              // sit at the left edge of the winning block; the rAF keeps it there
              left: `-${ORPHAN_W}px`,
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
      {blocks.map((b, i) => {
        const scroll = b.txids.length > 6;
        const list = scroll ? [...b.txids, ...b.txids] : b.txids;
        const wonByUser = !!(b.stakeWinner && userAddrs.current.has(b.stakeWinner));
        return (
          <div
            key={b.height}
            className={"bv-panel" + (wonByUser ? " bv-rainbow" : "")}
            style={{ left: `${leftPctOf(i, 0)}%`, width: `${BLOCK_PCT}%` }}
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
