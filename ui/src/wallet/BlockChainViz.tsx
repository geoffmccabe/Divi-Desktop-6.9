import { useEffect, useRef, useState } from "react";
import { recentBlocks, type Block } from "./api";

// The block-chain visualization: a chain of translucent panels (one per block)
// that drifts slowly right→left across the bottom of the map. Panels are evenly
// spaced by CHAIN POSITION (not arrival time), so they read as a chain and never
// overlap; between blocks the whole chain drifts smoothly. Styled to match the
// map: translucent black with thin purple edges, like the node-connection lines.

const PER_BLOCK_MS = 60 * 1000; // nominal one block per minute → smooth drift rate

interface LiveBlock extends Block {
  slot: number; // ever-increasing chain position (newest = highest)
}

function short(txid: string) {
  return txid.length > 14 ? `${txid.slice(0, 8)}…${txid.slice(-4)}` : txid;
}

export function BlockChainViz() {
  const [blocks, setBlocks] = useState<LiveBlock[]>([]);
  const wrapRef = useRef<HTMLDivElement>(null);
  const panelRefs = useRef<Map<number, HTMLDivElement>>(new Map());
  const lastHeight = useRef(0);
  const slotCounter = useRef(0);
  const lastAdd = useRef(0);

  useEffect(() => {
    let alive = true;
    let seeded = false;
    const poll = async () => {
      try {
        const bs = await recentBlocks(seeded ? 1 : 6);
        if (!alive || bs.length === 0) return;
        if (!seeded) {
          seeded = true;
          const seedBlocks = bs.map((b, i) => ({ ...b, slot: i }));
          slotCounter.current = bs.length - 1;
          lastHeight.current = bs[bs.length - 1].height;
          lastAdd.current = Date.now();
          setBlocks(seedBlocks);
        } else {
          const newest = bs[bs.length - 1];
          if (newest.height > lastHeight.current) {
            lastHeight.current = newest.height;
            slotCounter.current += 1;
            lastAdd.current = Date.now();
            setBlocks((prev) => [...prev, { ...newest, slot: slotCounter.current }]);
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

  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const wrap = wrapRef.current;
      if (wrap && blocks.length) {
        const cw = wrap.clientWidth;
        const panelW = Math.max(140, cw * 0.15);
        const slot = panelW + 6; // small gap → chain links
        const rightStart = cw - panelW;
        const maxSlot = slotCounter.current;
        // Smooth drift between block arrivals (0 → one slot over ~a minute).
        const drift = Math.min(slot, ((Date.now() - lastAdd.current) / PER_BLOCK_MS) * slot);
        let anyOff = false;
        for (const b of blocks) {
          const el = panelRefs.current.get(b.slot);
          if (!el) continue;
          const x = rightStart - (maxSlot - b.slot) * slot - drift;
          if (x < -panelW) anyOff = true;
          el.style.transform = `translateX(${x}px)`;
          el.style.width = `${panelW}px`;
        }
        if (anyOff) {
          setBlocks((prev) =>
            prev.filter((b) => rightStart - (maxSlot - b.slot) * slot - drift >= -panelW)
          );
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
            key={b.slot}
            className="bv-panel"
            ref={(el) => {
              if (el) panelRefs.current.set(b.slot, el);
              else panelRefs.current.delete(b.slot);
            }}
          >
            <div className="bv-height">#{b.height.toLocaleString()}</div>
            {b.stakeWinner && <div className="bv-stake">stake → {short(b.stakeWinner)}</div>}
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
