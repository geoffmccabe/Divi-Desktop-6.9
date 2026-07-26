import { fmtDivi } from "../status";
import { useFastReceive, type FastRec } from "./fastReceiveStore";

const FULLY = 6;

export function tierColor(tier: FastRec["tier"]): string {
  switch (tier) {
    case "confirmed":
    case "high":
      return "hsl(145 65% 52%)";
    case "medium":
      return "hsl(43 96% 56%)";
    case "low":
      return "hsl(25 95% 56%)";
    case "conflicted":
      return "hsl(0 78% 60%)";
    default:
      return "hsl(var(--muted-foreground))";
  }
}

export function RatingMeter({ rec }: { rec: FastRec }) {
  const c = tierColor(rec.tier);
  return (
    <div className="fr-meter" title="Preliminary confidence, this node only">
      <div className="fr-meter-track">
        <div className="fr-meter-fill" style={{ width: `${rec.score * 10}%`, background: c }} />
      </div>
      <span className="fr-meter-num" style={{ color: c }}>
        {rec.score.toFixed(1)}
        <span className="fr-meter-max">/10</span>
      </span>
    </div>
  );
}

function statusLine(rec: FastRec): string {
  switch (rec.status) {
    case "incoming":
      return "In process — payment seen on your node, not yet in a block.";
    case "confirming":
      return `Confirming — ${rec.confirmations} of ${FULLY} confirmations.`;
    case "confirmed":
      return "FULLY CONFIRMED.";
    case "conflicted":
      return "CONFLICT — do not accept this payment.";
  }
}

function Card({ rec }: { rec: FastRec }) {
  return (
    <div className={"fr-card " + rec.tier}>
      <div className="fr-card-top">
        <span className="fr-badge">⚡ FAST SEND</span>
        <span className="fr-amt">+{fmtDivi(rec.amount)} DIVI</span>
      </div>
      <div className="fr-status">{statusLine(rec)}</div>

      {rec.tier !== "conflicted" && <RatingMeter rec={rec} />}

      {rec.warnings.length > 0 && (
        <ul className="fr-warns">
          {rec.warnings.map((w, i) => (
            <li key={i}>⚠ {w}</li>
          ))}
        </ul>
      )}

      <details className="fr-how">
        <summary>How this rating is calculated</summary>
        <ul className="fr-factors">
          {rec.factors.map((f, i) => (
            <li key={i} className={f.ok ? "ok" : "bad"}>
              <span className="fr-f-mark">{f.ok ? "✓" : "✗"}</span>
              <span className="fr-f-label">{f.label}</span>
              <span className="fr-f-note">{f.note}</span>
            </li>
          ))}
        </ul>
        <p className="fr-caveat">
          Preliminary — this is your own node's view. A network-wide rating (many nodes cross-checking) arrives in a
          later phase. Only a confirmation is final.
        </p>
      </details>

      <div className="fr-conf-row">
        {Array.from({ length: FULLY }, (_, i) => (
          <span key={i} className={"fr-pip" + (rec.confirmations > i ? " on" : "")} />
        ))}
        <span className="fr-conf-txt">
          {rec.status === "confirmed" ? "Fully confirmed" : `${Math.max(0, rec.confirmations)} / ${FULLY}`}
        </span>
      </div>
    </div>
  );
}

// Shown at the top of Overview. Renders nothing when there's no live activity.
export function FastReceiveCard() {
  const { records } = useFastReceive();
  if (records.length === 0) return null;
  return (
    <div className="fr-cards">
      {records.map((r) => (
        <Card key={r.txid} rec={r} />
      ))}
    </div>
  );
}
