// The values every door starts from, kept apart from any door so that the game,
// the app door and the web door can all read them without importing each other.

import type { RebelsDetail } from "./platform";

/** The multiplayer server. One world, everyone in it. */
export const DEFAULT_ROOM_BASE = "wss://divi-rebels-room.geoff-de3.workers.dev";

/** Today's globe detail, exactly: 24 peer links, 120 network links, and a
 *  pixel ratio of one while flying. */
export const DESKTOP_DETAIL: RebelsDetail = { peerLinks: 24, meshLinks: 120, pixelRatio: 1 };
