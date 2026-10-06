// PERC reveal — the on-screen stage. A full-panel overlay: a sealed pack (with
// its forged guarantee, if any), the sign → wait → reveal flow, and the layered
// FX + sound. Reusable: the caller supplies `run()`, which performs the real
// on-chain reveal (or, for a preview, resolves to a forced result).
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { createRevealFx, playRevealSound, primeAudio, type RevealFx } from "./revealFx";
import { lvl, intensity, colorFor, type RevealResult } from "./revealModel";
import "./reveal.css";

export interface RevealSealed {
  forged: boolean;
  floor: number;      // guaranteed minimum tier (forged)
  label?: string;     // e.g. "Skylie Perc"
}

export interface RevealStageProps {
  open: boolean;
  sealed?: RevealSealed;
  run: () => Promise<RevealResult>;  // sign + wait + roll -> result (or forced, for preview)
  muted?: boolean;
  onToggleMute?: () => void;
  onClose: () => void;
}

type Phase = "sealed" | "working" | "revealed";

export function RevealStage({ open, sealed, run, muted = false, onToggleMute, onClose }: RevealStageProps) {
  const baseRef = useRef<HTMLCanvasElement | null>(null);
  const overRef = useRef<HTMLCanvasElement | null>(null);
  const resultRef = useRef<HTMLDivElement | null>(null);
  const fxRef = useRef<RevealFx | null>(null);
  const [phase, setPhase] = useState<Phase>("sealed");
  const [status, setStatus] = useState("");
  const [res, setRes] = useState<RevealResult | null>(null);

  // reset each time the overlay opens
  useEffect(() => {
    if (open) { setPhase("sealed"); setRes(null); setStatus(""); }
  }, [open]);

  // engine lifecycle tied to the canvases being mounted
  useEffect(() => {
    if (!open || !baseRef.current || !overRef.current) return;
    fxRef.current = createRevealFx(baseRef.current, overRef.current);
    return () => { fxRef.current?.stop(); fxRef.current = null; };
  }, [open]);

  if (!open) return null;

  const rc = res ? colorFor(res) : sealed?.forged ? lvl(1).c[0] : "#6d7bff";
  const styleVars = { ["--rv-rc" as any]: rc } as CSSProperties;

  async function onOpenPack() {
    if (phase !== "sealed") return;
    primeAudio();
    setPhase("working");
    // Indeterminate progress while run() does the signing + block wait (or the
    // short preview delay). Messaging communicates that reveal is a transaction.
    setStatus("Signing reveal transaction…");
    const msgTimer = window.setTimeout(() => setStatus("Waiting for the Divi block that seeds the roll…"), 700);
    let result: RevealResult;
    try {
      result = await run();
    } catch (e) {
      window.clearTimeout(msgTimer);
      setStatus(String((e as Error)?.message || e || "Reveal failed."));
      setPhase("sealed");
      return;
    }
    window.clearTimeout(msgTimer);
    setRes(result);
    setPhase("revealed");
    setStatus(result.ur ? "ULTRA RARE pulled!" : result.floor
      ? `Revealed T${result.tier} — a +${result.jump} jump from the forge floor.`
      : `Revealed T${result.tier} — a +${result.jump} jump.`);

    // card pop scales with the jump
    const ov = 1 + 0.12 + intensity(result.jump) * 0.22;
    const card = resultRef.current;
    if (card && card.animate) {
      card.animate(
        [{ transform: "scale(.5)", opacity: 0 }, { transform: `scale(${ov.toFixed(2)})`, opacity: 1 }, { transform: "scale(1)", opacity: 1 }],
        { duration: 700, easing: "cubic-bezier(.18,.9,.2,1)" },
      );
    }
    fxRef.current?.play({ level: result.ur ? lvl(10) : lvl(result.jump), intensity: intensity(result.jump), ur: result.ur });
    playRevealSound(result.ur ? 1 : intensity(result.jump), result.ur, muted);
  }

  return (
    <div className="rv-overlay" style={styleVars} role="dialog" aria-modal="true" aria-label="PERC reveal">
      <div className={"rv-stage" + (phase !== "sealed" ? " rv-lit" : "")}>
        <div className="rv-glow" />
        <canvas ref={baseRef} className="rv-fx rv-fx-base" aria-hidden="true" />

        {phase !== "revealed" ? (
          <div className={"rv-card rv-pack" + (sealed?.forged ? " rv-forged" : "")}>
            {sealed?.forged && <span className="rv-forged-tag">Forged</span>}
            <span className="rv-sigil">◈</span>
            <span className="rv-pack-label">{sealed?.label || "Sealed PERC"}</span>
            {sealed?.forged && <span className="rv-guarantee">Guaranteed T{sealed.floor}+</span>}
          </div>
        ) : (
          <div ref={resultRef} className={"rv-card rv-result" + (res?.ur ? " rv-ur" : "")}>
            <div className="rv-art" />
            {res?.ur && <div className="rv-ur-flag">Ultra Rare</div>}
            <div className="rv-tiernum">{res && res.tier ? "T" + res.tier : "UR"}</div>
            <div className="rv-band">{res?.ur ? "Ultra Rare" : `+${res?.jump} tier${(res?.jump || 0) > 1 ? "s" : ""}`}</div>
            {!!res?.floor && <div className="rv-jump-note">forged · floor T{res.floor}</div>}
          </div>
        )}

        <canvas ref={overRef} className="rv-fx rv-fx-over" aria-hidden="true" />

        <div className="rv-foot">
          {phase === "working" && <div className="rv-bar"><i /></div>}
          <div className="rv-status">{status || (sealed?.forged ? "Sealed · forged, guaranteed minimum tier." : "Ready to open.")}</div>
          <div className="rv-actions">
            {phase === "sealed" && <button className="rv-cta" onClick={onOpenPack}>Open Pack</button>}
            {phase === "revealed" && <button className="rv-ghost" onClick={onClose}>Done</button>}
            {phase !== "working" && <button className="rv-ghost" onClick={onClose}>Close</button>}
            {onToggleMute && (
              <button className="rv-ghost" onClick={onToggleMute} aria-pressed={muted} title={muted ? "Unmute" : "Mute"}>
                {muted ? "🔇" : "🔊"}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
