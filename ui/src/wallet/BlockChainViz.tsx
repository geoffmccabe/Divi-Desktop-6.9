import { useEffect, useRef, useState } from "react";
import { recentBlocks, type Block } from "./api";

// The block-chain visualization: translucent panels (one per block) that drift
// slowly right→left across the bottom of the map, taking 5 minutes to cross, so
// ~5 recent blocks are on screen. Each shows its block number and the block's
// transactions (which scroll if they overflow). Styled to match the map: black
// 80% panels with thin purple edges, like the node-connection lines.

const CROSS_MS = 5 * 60 * 1000; // 5 minutes to traverse the panel

interface LiveBlock extends Block {
  born: number; // client time this block entered the view
}

function short(txid: string) {
  return txid.length > 14 ? `${txid.slice(0, 8)}…${txid.slice(-4)}` : txid;
}

export function BlockChainViz() {
  const [blocks, setBlocks] = useState<LiveBlock[]>([]);
  const wrapRef = useRef<HTMLDivElement>(null);
  const panelRefs = useRef<Map<number, HTMLDivElement>>(new Map());
  const lastHeight = useRef(0);

  // Poll for new blocks. On first load, seed ~5 recent blocks spread across the
  // 5-minute window; afterwards add at most the newest block per poll (so a
  // fast-syncing tip doesn't spam the chain).
  useEffect(() => {
    let alive = true;
    let seeded = false;
    const poll = async () => {
      try {
        const bs = await recentBlocks(seeded ? 1 : 5);
        if (!alive || bs.length === 0) return;
        if (!seeded) {
          seeded = true;
          const now = Date.now();
          const sert = bs.map((b, i) => ({ ...b, born: now - (bs.length - 1 - i) * (CROSS_MS / 5) }));
          lastHeight.current = bs[bs.length - 1].height;
          setBlocks(sert);
        } else {
          const newest = bs[bs.length - 1];
          if (newest.height > lastHeight.current) {
            lastHeight.current = newest.height;
            setBlocks((prev) => [...prev, { ...newest, born: Date.now() }]);
          }
        }
      } catch {
        /* keep what we have */
      }
    };
    poll();
    const id = setInterval(poll, 20000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  // Slide the panels each frame (slow, but smooth). Drop ones that have exited.
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const wrap = wrapRef.current;
      if (wrap) {
        const cw = wrap.clientWidth;
        const panelW = Math.max(150, cw * 0.18);
        const now = Date.now();
        let anyExpired = false;
        for (const b of blocks) {
          const el = panelRefs.current.get(b.height);
          if (!el) continue;
          const progress = (now - b.born) / CROSS_MS;
          if (progress > 1.05) anyExpired = true;
          const x = cw - progress * (cw + panelW);
          el.style.transform = `translateX(${x}px)`;
          el.style.width = `${panelW}px`;
        }
        if (anyExpired) {
          setBlocks((prev) => prev.filter((b) => (now - b.born) / CROSS_MS <= 1.05));
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
        return (
          <div
            key={b.height}
            className="bv-panel"
            ref={(el) => {
              if (el) panelRefs.current.set(b.height, el);
              else panelRefs.current.delete(b.height);
            }}
          >
            <div className="bv-height">#{b.height.toLocaleString()}</div>
            {b.stakeWinner && <div className="bv-stake">stake → {short(b.stakeWinner)}</div>}
            <div className="bv-txs">
              <div className={"bv-txs-inner" + (scroll ? " bv-scrolling" : "")} style={scroll ? { animationDuration: `${b.txids.length * 2}s` } : undefined}>
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
