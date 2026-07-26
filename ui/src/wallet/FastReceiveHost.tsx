import { useEffect, useRef, useState } from "react";
import { fmtDivi } from "../status";
import { startFastReceive, useFastReceive, getRecord } from "./fastReceiveStore";
import { RatingMeter } from "./FastReceiveCard";
import { playArrival, playConflict } from "./tone";

// Always-on host: starts the incoming-payment watcher, and the moment a new Fast
// Send is detected it chimes and pops a modal. Mounted once at the app root so it
// fires no matter which view is open.
export function FastReceiveHost({ onGoto }: { onGoto: (view: string) => void }) {
  const { detectSeq, latestTxid } = useFastReceive();
  const seenSeq = useRef(0);
  const [modalTxid, setModalTxid] = useState<string | null>(null);

  useEffect(() => {
    startFastReceive();
  }, []);

  useEffect(() => {
    if (detectSeq > seenSeq.current) {
      seenSeq.current = detectSeq;
      const rec = getRecord(latestTxid);
      if (rec?.status === "conflicted") playConflict();
      else playArrival();
      setModalTxid(latestTxid);
    }
  }, [detectSeq, latestTxid]);

  // Re-read live so the modal's confirmations/rating update while it's open.
  useFastReceive();
  const rec = getRecord(modalTxid);
  if (!modalTxid || !rec) return null;

  return (
    <div className="fr-modal-scrim" onClick={() => setModalTxid(null)}>
      <div className="fr-modal" onClick={(e) => e.stopPropagation()}>
        <div className="fr-modal-badge">⚡ FAST SEND!</div>
        <div className="fr-modal-amt">+{fmtDivi(rec.amount)} DIVI</div>
        <div className="fr-modal-status">
          {rec.status === "conflicted"
            ? "Conflict detected — do not accept."
            : rec.status === "confirmed"
              ? "Fully confirmed."
              : "Payment detected — in process."}
        </div>
        {rec.tier !== "conflicted" && <RatingMeter rec={rec} />}
        {rec.warnings.length > 0 && (
          <ul className="fr-warns">
            {rec.warnings.map((w, i) => (
              <li key={i}>⚠ {w}</li>
            ))}
          </ul>
        )}
        <p className="fr-caveat">Preliminary rating — your node's view only. Only a confirmation is final.</p>
        <div className="fr-modal-actions">
          <button
            type="button"
            className="wl-btn wl-btn-primary"
            onClick={() => {
              onGoto("overview");
              setModalTxid(null);
            }}
          >
            View details
          </button>
          <button type="button" className="wl-btn" onClick={() => setModalTxid(null)}>
            Dismiss
          </button>
        </div>
      </div>
    </div>
  );
}
