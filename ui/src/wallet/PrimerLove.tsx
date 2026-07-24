import { usePrimer } from "./primerStore";
import logo from "../assets/divi-logo.png";

// PrimerLove: the fast-loader screen, shown over the block stream at the bottom of
// the map while the blockchain is being pulled in one-month chunks. Frosted glass
// + purple to match the rest of the app.
export function PrimerLove() {
  const p = usePrimer();
  if (!p.active) return null;

  // A compact segmented bar — one notch per monthly chunk (done / active / pending).
  const segs = Math.min(p.chunkTotal, 120);
  const activeSeg = Math.round(((p.chunkIndex - 1) / Math.max(1, p.chunkTotal)) * segs);

  return (
    <div className="primer">
      <div className="primer-panel glass-panel">
        <img className="primer-heart" src={logo} alt="" />
        <div className="primer-body">
          <div className="primer-head">
            <span className="primer-title">PrimerLove</span>
            {p.preview && <span className="primer-preview">preview</span>}
          </div>
          <div className="primer-sub">We are fast loading the blockchain in one-month chunks.</div>

          <div className="primer-now">
            Loading <strong>{p.chunkDate}</strong>
            <span className="primer-count"> · chunk {p.chunkIndex.toLocaleString()} of {p.chunkTotal.toLocaleString()}</span>
            {p.phase && <span className="primer-phase"> · {p.phase}</span>}
          </div>

          <div className="primer-segs" aria-hidden>
            {Array.from({ length: segs }).map((_, i) => (
              <span
                key={i}
                className={"primer-seg" + (i < activeSeg ? " done" : i === activeSeg ? " active" : "")}
              />
            ))}
          </div>

          <div className="primer-bottom">
            <div className="primer-bar">
              <div className="primer-bar-fill" style={{ width: `${p.overallPct}%` }} />
            </div>
            <span className="primer-pct">{p.overallPct}%</span>
          </div>
        </div>
      </div>
    </div>
  );
}
