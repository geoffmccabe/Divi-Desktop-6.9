// The values every door starts from, kept apart from any door so that the game,
// the app door and the web door can all read them without importing each other.

import type { RebelsAccountConnection, RebelsDetail, RebelsLimits, RebelsStorage } from "./platform";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "../../../supabaseProject";

/** The multiplayer server. One world, everyone in it. */
export const DEFAULT_ROOM_BASE = "wss://divi-rebels-room.geoff-de3.workers.dev";

/** Today's globe detail, exactly: 24 peer links, 120 network links, and a
 *  pixel ratio of one while flying. */
export const DESKTOP_DETAIL: RebelsDetail = { peerLinks: 24, meshLinks: 120, pixelRatio: 1 };

/** localStorage, as the game always used it. Every call fails soft: a browser
 *  that blocks storage still plays, it just does not remember. */
export const LOCAL_STORAGE: RebelsStorage = {
  getItem(key) {
    try { return typeof localStorage === "undefined" ? null : localStorage.getItem(key); } catch { return null; }
  },
  setItem(key, value) {
    try { if (typeof localStorage !== "undefined") localStorage.setItem(key, value); } catch { /* full or blocked */ }
  },
  removeItem(key) {
    try { if (typeof localStorage !== "undefined") localStorage.removeItem(key); } catch { /* blocked */ }
  },
};

/** Everything open: the app, where the player is a node owner. */
export const NO_LIMITS: RebelsLimits = { customiseShips: true, why: "" };

/** The Divi Desktop Supabase project with its public key: every door's account
 *  connection until a player signs in. */
export const DEFAULT_ACCOUNT: RebelsAccountConnection = { url: SUPABASE_URL, anonKey: SUPABASE_ANON_KEY };
