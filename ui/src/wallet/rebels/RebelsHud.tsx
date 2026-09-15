// The cockpit. Everything you can see through it is the Node Map's own globe.
//
// Drawn in the DOM rather than in the 3D scene: it is flat, it never moves with
// the world, and this way it uses the same theme tokens as every other surface
// in the wallet, so a skin restyles the cockpit along with everything else.
//
// This is the desktop layout. What the cockpit knows lives in
// cockpit/useCockpit.ts and each thing it draws is a piece in cockpit/, so a
// phone layout can arrange the same pieces for a small screen.

import "./orbit.css";
import type { RebelsController } from "./rebelsController";
import { RebelsHealthBar } from "./RebelsHealthBar";
import { useCockpit } from "./cockpit/useCockpit";
import { FlightReadout, CornerInfo, DockPanel, ScoreCorner, GaugeBars } from "./cockpit/readouts";
import { HitFlash, DiedBanner, WaveBanner, AimMarks, ExitButton, NoteLine, OfflineBanner } from "./cockpit/overlays";
import { NoLaunchCard, CockpitPanels, LaunchCard, DeathCard } from "./cockpit/cards";

export function RebelsHud({ ctl, onExit }: { ctl: RebelsController; onExit: () => void }) {
  const c = useCockpit(ctl, onExit);
  const { hud } = c;
  return (
    <div className="orbit-hud" ref={c.wrapRef}>
      <FlightReadout hud={hud} />
      <CornerInfo hud={hud} />
      <HitFlash on={c.flashing} />
      <DiedBanner hud={hud} />
      <WaveBanner shown={c.waveShown} waveAt={hud.waveAt} opacity={c.waveOpacity} />
      <AimMarks hud={hud} crossRef={c.crossRef} />
      <DockPanel hud={hud} />
      <ScoreCorner hud={hud} />
      <GaugeBars hud={hud} />
      <ExitButton hud={hud} onExit={onExit} />
      <NoLaunchCard hud={hud} />
      <NoteLine hud={hud} />
      <OfflineBanner hud={hud} />
      <RebelsHealthBar />
      <CockpitPanels c={c} />
      <LaunchCard ctl={ctl} c={c} />
      <DeathCard ctl={ctl} c={c} />
    </div>
  );
}
