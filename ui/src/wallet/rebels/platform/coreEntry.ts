// The game as a door sees it: what gets mounted, and nothing a door adds.
//
// scripts/check-rebels-boundary.mjs bundles THIS file and fails if any wallet
// or app-bridge file ends up inside the result. Anything a door needs from the
// game is exported here, so the check covers it.

export { createRebels, type RebelsController } from "../rebelsController";
export { RebelsHud } from "../RebelsHud";
export { setPlatform, platform, HEADLESS } from "./current";
export type * from "./platform";
