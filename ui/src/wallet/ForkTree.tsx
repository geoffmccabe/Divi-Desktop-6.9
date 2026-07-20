import type { SeenFork } from "./chainHealth";

// A collapsed fork tree: the chain as a single left-to-right line of blocks,
// with each stale block hanging below the block that beat it.
//
// The idea worth stealing (from 0xB10C's fork-observer, the open-source
// getchaintips visualiser) is that the along-chain axis is an INDEX, not the
// height. Long uninteresting runs collapse into a thin connector reading
// "847 blocks", so forks hundreds of blocks apart sit side by side with no dead
// space. Without that trick a chain forking 0.8% of the time draws as a long
// empty line, 99% of the pixels showing nothing happening.
//
// Depth is deliberately NOT given its own axis. On this chain a fork is almost
// always exactly one block deep, so depth is treated as an alarm channel: a
// two-block branch is longer, red, and thicker, and it should leap out of an
// otherwise uniform picture rather than blend into a scale.

const BLK_W = 13;
const BLK_H = 13;
const BLK_GAP = 3;
const RUN_W = 52; // width of a collapsed "N blocks" connector
const CTX = 1; // blocks of context drawn either side of a fork
const ROW_Y = 22;
const STUB_Y = 52;

type Cell = { kind: "block"; height: number } | { kind: "run"; count: number };

/** Blocks worth drawing, with everything boring between them collapsed. */
function layout(forkHeights: number[], tip: number): Cell[] {
  if (!forkHeights.length) return [];
  const wanted = new Set<number>();
  for (const h of forkHeights) {
    for (let i = h - CTX; i <= h + CTX; i++) if (i > 0 && i <= tip) wanted.add(i);
  }
  const shown = [...wanted].sort((a, b) => a - b);
  const cells: Cell[] = [];
  let prev: number | null = null;
  for (const h of shown) {
    if (prev !== null && h > prev + 1) cells.push({ kind: "run", count: h - prev - 1 });
    cells.push({ kind: "block", height: h });
    prev = h;
  }
  // The stretch from the newest fork up to the current tip.
  if (prev !== null && tip > prev) cells.push({ kind: "run", count: tip - prev });
  return cells;
}

// The store keeps up to 500 forks. Drawing all of them would be a ~35,000px
// SVG with thousands of nodes in it, so only the most recent stretch is drawn.
// The older ones still count towards the statistics above.
const MAX_DRAWN = 40;

export function ForkTree({ forks, tip }: { forks: SeenFork[]; tip: number }) {
  const all = [...forks].sort((a, b) => a.height - b.height);
  const asc = all.slice(-MAX_DRAWN);
  const hidden = all.length - asc.length;
  const byHeight = new Map(asc.map((f) => [f.height, f]));
  const cells = layout(asc.map((f) => f.height), tip);

  if (!cells.length) {
    return (
      <div style={{ fontSize: "0.72rem", opacity: 0.6, padding: "10px 0" }}>
        No forks recorded yet, the chain has been a single unbroken line for every block watched.
      </div>
    );
  }

  // Walk the cells once to assign x positions.
  let x = 0;
  const placed = cells.map((c) => {
    const at = x;
    x += c.kind === "block" ? BLK_W + BLK_GAP : RUN_W;
    return { c, x: at };
  });
  const width = Math.max(x, 10);
  const deep = asc.some((f) => f.branchLen >= 2);

  return (
    <div style={{ overflowX: "auto", overflowY: "hidden", padding: "4px 0 2px" }}>
      <svg width={width} height={76} style={{ display: "block" }}>
        {placed.map(({ c, x: cx }, i) => {
          if (c.kind === "run") {
            return (
              <g key={`run-${i}`}>
                <line
                  x1={cx}
                  y1={ROW_Y + BLK_H / 2}
                  x2={cx + RUN_W}
                  y2={ROW_Y + BLK_H / 2}
                  stroke="hsl(var(--border))"
                  strokeWidth={1}
                  strokeDasharray="2 3"
                />
                <text
                  x={cx + RUN_W / 2}
                  y={ROW_Y - 4}
                  textAnchor="middle"
                  fontSize="8"
                  fill="hsl(var(--muted-foreground))"
                  opacity={0.75}
                >
                  {c.count.toLocaleString()}
                </text>
              </g>
            );
          }
          const f = byHeight.get(c.height);
          const followed = !!f && f.status.includes("fork");
          const isDeep = !!f && f.branchLen >= 2;
          const stubH = f ? (isDeep ? BLK_H * 2 + 4 : BLK_H) : 0;
          const stubColor = isDeep ? "rgb(255, 90, 80)" : followed ? "rgb(255, 140, 125)" : "rgba(160, 170, 200, 0.75)";
          return (
            <g key={`b-${c.height}`}>
              {/* the block that is part of the real chain */}
              <rect
                x={cx}
                y={ROW_Y}
                width={BLK_W}
                height={BLK_H}
                rx={2}
                fill="hsl(var(--primary) / 0.55)"
                stroke="hsl(var(--primary))"
                strokeWidth={0.8}
              >
                <title>{`Block ${c.height.toLocaleString()}`}</title>
              </rect>
              {f && (
                <g>
                  {/* the loser, hanging off the same parent and dead-ending */}
                  <line
                    x1={cx + BLK_W / 2}
                    y1={ROW_Y + BLK_H}
                    x2={cx + BLK_W / 2}
                    y2={STUB_Y}
                    stroke={stubColor}
                    strokeWidth={isDeep ? 2 : 1}
                  />
                  <rect
                    x={cx}
                    y={STUB_Y}
                    width={BLK_W}
                    height={stubH}
                    rx={2}
                    fill={stubColor}
                    fillOpacity={0.35}
                    stroke={stubColor}
                    strokeWidth={isDeep ? 1.6 : 0.8}
                  >
                    <title>
                      {`Stale block at ${c.height.toLocaleString()}, ${
                        followed ? "our node followed this branch, then rolled back" : "seen but never followed"
                      }; ${f.branchLen} block${f.branchLen === 1 ? "" : "s"} long (${f.status})`}
                    </title>
                  </rect>
                </g>
              )}
            </g>
          );
        })}
      </svg>

      <div style={{ display: "flex", gap: 12, fontSize: "0.62rem", opacity: 0.75, marginTop: 2, flexWrap: "wrap" }}>
        <span><span style={{ color: "hsl(var(--primary))" }}>■</span> chain</span>
        <span><span style={{ color: "rgb(255, 140, 125)" }}>■</span> we rolled back</span>
        <span><span style={{ color: "rgba(160, 170, 200, 0.9)" }}>■</span> witnessed</span>
        {deep && <span style={{ color: "rgb(255, 90, 80)", fontWeight: 700 }}>■ deeper than 1 block</span>}
        {hidden > 0 && <span>+{hidden.toLocaleString()} older not drawn</span>}
        <span style={{ marginLeft: "auto" }}>numbers = blocks collapsed</span>
      </div>
    </div>
  );
}
