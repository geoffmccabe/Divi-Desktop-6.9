// Which door the game is running behind.
//
// A door calls setPlatform once, before it creates the game. Everything in the
// game asks platform(). A registry rather than a parameter handed down, because
// several of the game's functions (scores, ships, loadout, forge) are called
// from places that have no game object to pass it along.
//
// Until a door registers, HEADLESS answers: a neutral stand-in that can do
// nothing wallet-shaped and so can never crash or pretend. Node tests that care
// which door they are behind register the one they mean.

import type { RebelsPlatform } from "./platform";
import { DEFAULT_ROOM_BASE, DESKTOP_DETAIL, LOCAL_STORAGE, NO_LIMITS } from "./defaults";
import { desktopInput } from "./desktopInput";

export const HEADLESS: RebelsPlatform = {
  id: "headless",
  identity: {
    name: () => "this node",
    joinFields: (selfIp: string) => ({ node: selfIp || "this node", name: "this node" }),
    accountKey: () => "this node",
  },
  storage: LOCAL_STORAGE,
  limits: NO_LIMITS,
  roomBase: DEFAULT_ROOM_BASE,
  wonStakeRecently: () => false,
  prices: { fetch: () => Promise.resolve({ prices: {} }) },
  money: {
    validateAddress: () => Promise.resolve(false),
    ownAddresses: () => Promise.resolve([]),
    PayWithDivi: null,
  },
  detail: DESKTOP_DETAIL,
  input: desktopInput,
};

let current: RebelsPlatform = HEADLESS;

/** Put the game behind this door. Called once by the door, before the game. */
export function setPlatform(p: RebelsPlatform): void {
  current = p;
}

/** The door the game is running behind. */
export function platform(): RebelsPlatform {
  return current;
}
