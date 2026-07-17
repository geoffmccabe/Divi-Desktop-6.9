// Ported from Kinet.ink's AnimatedBackdrop: a pulsing white/black hex-grid over
// a deep indigo radial gradient. Fixed behind everything; frosted-glass panels
// layer on top. This is the shared "look" for all Divi Desktop surfaces.

const WHITE_HEX = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='56' height='100' viewBox='0 0 56 100'%3E%3Cpath d='M28 66L0 50L0 16L28 0L56 16L56 50L28 66L28 100' fill='none' stroke='white' stroke-width='1'/%3E%3Cpath d='M28 0L28 34L0 50L0 84L28 100L56 84L56 50L28 34' fill='none' stroke='white' stroke-width='1'/%3E%3C/svg%3E")`;
const BLACK_HEX = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='56' height='100' viewBox='0 0 56 100'%3E%3Cpath d='M28 66L0 50L0 16L28 0L56 16L56 50L28 66L28 100' fill='none' stroke='black' stroke-width='1'/%3E%3Cpath d='M28 0L28 34L0 50L0 84L28 100L56 84L56 50L28 34' fill='none' stroke='black' stroke-width='1'/%3E%3C/svg%3E")`;

export function AnimatedBackdrop({ animated = true }: { animated?: boolean }) {
  return (
    <div
      className="fixed inset-0 pointer-events-none"
      style={{ zIndex: 0, backgroundColor: "hsl(var(--background))" }}
      aria-hidden
    >
      <div
        className="absolute inset-0"
        style={{
          background:
            "radial-gradient(ellipse at center, hsl(247 25% 28% / 0.55) 0%, hsl(247 20% 15% / 0.7) 70%, hsl(247 20% 10% / 0.85) 100%)",
        }}
      />
      <div
        className="absolute inset-0"
        style={{
          backgroundImage: WHITE_HEX,
          backgroundSize: "56px 100px",
          animation: animated ? "hex-grid-white-pulse 20s steps(200) infinite" : "none",
          opacity: animated ? undefined : 0.125,
        }}
      />
      <div
        className="absolute inset-0"
        style={{
          backgroundImage: BLACK_HEX,
          backgroundSize: "56px 100px",
          animation: animated ? "hex-grid-black-pulse 20s steps(200) infinite" : "none",
          opacity: animated ? undefined : 0.125,
        }}
      />
    </div>
  );
}
