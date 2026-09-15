// The game as a door sees it: what gets mounted, and nothing a door adds.
//
// scripts/check-rebels-boundary.mjs bundles THIS file and fails if any wallet
// or app-bridge file ends up inside the result. Anything a door needs from the
// game is exported here, so the check covers it.

export { createRebels, type RebelsController } from "../rebelsController";
export { RebelsHud } from "../RebelsHud";
export { setPlatform, platform, HEADLESS } from "./current";
export type * from "./platform";

/* For a phone door and its layout: touch in place of keyboard and mouse, and the
   cockpit's state and pieces to arrange for a small screen (RebelsHud is the
   desktop arrangement of the same pieces). */
export { createTouchInput, TOUCH_ACTIONS, type TouchInput, type TouchPicture, type TouchStick } from "./touchInput";
export { desktopInput } from "./desktopInput";
export { useCockpit, type Cockpit } from "../cockpit/useCockpit";
export { FlightReadout, CornerInfo, HeldRow, DockPanel, ScoreCorner, GaugeBars } from "../cockpit/readouts";
export { HitFlash, DiedBanner, WaveBanner, AimMarks, ExitButton, NoteLine, OfflineBanner } from "../cockpit/overlays";
export { NoLaunchCard, CockpitPanels, LaunchCard, DeathCard } from "../cockpit/cards";
export { PhoneHud } from "../cockpit/PhoneHud";
