// A self-contained "blockies"-style identicon derived only from the address, so
// the same address always draws the same little picture. Humans compare a small
// image far faster and more reliably than a 34-character string, which is what
// makes it a real anti-mistake check. No external library, no network (CSP-safe).

// Deterministic PRNG seeded from the address (the classic blockies seeding).
function makeRand(seed: string) {
  const s = [0, 0, 0, 0];
  for (let i = 0; i < seed.length; i++) {
    const j = i % 4;
    s[j] = (s[j] << 5) - s[j] + seed.charCodeAt(i);
    s[j] |= 0; // keep it a 32-bit int
  }
  return () => {
    const t = s[0] ^ (s[0] << 11);
    s[0] = s[1];
    s[1] = s[2];
    s[2] = s[3];
    s[3] = (s[3] ^ (s[3] >> 19) ^ (t ^ (t >> 8))) | 0;
    return (s[3] >>> 0) / 4294967296;
  };
}

function hsl(rand: () => number): string {
  const h = Math.floor(rand() * 360);
  const sat = 55 + rand() * 30; // 55–85%
  const light = 45 + rand() * 20; // 45–65%
  return `hsl(${h} ${sat.toFixed(0)}% ${light.toFixed(0)}%)`;
}

export function Identicon({ address, size = 34 }: { address: string; size?: number }) {
  const grid = 5;
  const rand = makeRand(address || "?");
  const color = hsl(rand);
  const bg = hsl(rand);
  const spot = hsl(rand);

  // Build a left half and mirror it, so the glyph is symmetric like real blockies.
  const cells: { c: string; on: boolean }[] = [];
  const half = Math.ceil(grid / 2);
  const data: number[] = [];
  for (let y = 0; y < grid; y++) {
    const row: number[] = [];
    for (let x = 0; x < half; x++) {
      // 0 = background, 1 = main color, 2 = spot color (rarer)
      row[x] = Math.floor(rand() * 2.3);
    }
    for (let x = 0; x < grid; x++) {
      const v = x < half ? row[x] : row[grid - 1 - x];
      data.push(v);
    }
  }
  for (const v of data) cells.push({ c: v === 2 ? spot : color, on: v > 0 });

  const cs = size / grid;
  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      style={{ borderRadius: 6, display: "block", flex: "none" }}
      aria-hidden="true"
    >
      <rect width={size} height={size} fill={bg} />
      {cells.map((cell, i) =>
        cell.on ? (
          <rect
            key={i}
            x={(i % grid) * cs}
            y={Math.floor(i / grid) * cs}
            width={cs}
            height={cs}
            fill={cell.c}
          />
        ) : null
      )}
    </svg>
  );
}
