// The admin panels that work on a public web page, and only those.
//
// WHY THIS LIST IS WRITTEN OUT AGAIN rather than filtered from registry.tsx:
// importing that file imports every panel in it, and some of them talk to the
// desktop app's Rust side (Style, Value, AI, Payouts, Chain, Arweave). One
// import of the registry would therefore drag the app's bridge into the web
// page's bundle, which scripts/check-rebels-boundary.mjs refuses, and rightly:
// the game must be able to run where there is no app. So the web's list is its
// own list, and the four panels on it reach nothing but the game's own database.
//
// THE ORDER IS THE ORDER OF THE REASON FOR BEING HERE. NFDs first, because the
// collections panel is what the web door was opened for: the launch decisions
// for a set live there and could not be looked at anywhere else without a
// desktop build.
import type { AdminPanel } from "./registry";
import { RebelsNfdPanel } from "./panels/RebelsNfdPanel";
import { RebelsGamesPanel } from "./panels/RebelsGamesPanel";
import { RebelsEnemiesPanel } from "./panels/RebelsEnemiesPanel";
import { RebelsDropsPanel } from "./panels/RebelsDropsPanel";

export const WEB_PANELS: AdminPanel[] = [
  { id: "rebels-nfd", title: "Rebels NFDs", render: () => <RebelsNfdPanel /> },
  { id: "rebels-games", title: "Rebels Games", render: () => <RebelsGamesPanel /> },
  { id: "rebels-enemies", title: "Rebels Enemies", render: () => <RebelsEnemiesPanel /> },
  { id: "rebels-drops", title: "Rebels Drops", render: () => <RebelsDropsPanel /> },
];
