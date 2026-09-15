// The web door: how Divi Rebels answers its questions at divi.love/rebels.
//
// A guest for now: PLAY NOW gets straight into the shared sky with no sign-in.
// Signing in with LW-SSO comes next and is offered, never required; until then
// a guest's DIVI is banked on the server and cashing it out asks them to sign in.

import type { RebelsPlatform, RebelsStorage } from "../wallet/rebels/platform/platform";
import { DEFAULT_ACCOUNT, DEFAULT_ROOM_BASE, DESKTOP_DETAIL, LOCAL_STORAGE } from "../wallet/rebels/platform/defaults";
import { desktopInput } from "../wallet/rebels/platform/desktopInput";
import { isDiviAddress } from "./diviAddress";
import { fetchWebPrices } from "./webPrice";
import { guestName, guestId } from "./pilot";

/** What a guest is told wherever a ship would be changed. */
export const GUEST_SHIP_LIMIT = "Sign up to choose your ship, paint it, name it and fit upgrades to it. Everything you earn now is kept.";

export function createWebDoor(opts: {
  roomBase?: string; name?: () => string; guest?: () => string;
  /** IndexedDB, loaded before the game starts (webStore.ts). */
  storage?: RebelsStorage;
} = {}): RebelsPlatform {
  const name = opts.name ?? (() => guestName());
  const guest = opts.guest ?? (() => guestId());
  return {
    id: "web",
    identity: {
      name,
      joinFields: () => ({ node: "web-guest", name: name(), door: "web", guest: guest() }),
      /* Their private id, never the pilot number, so no two guests share rows. */
      accountKey: () => `guest:${guest()}`,
    },
    storage: opts.storage ?? LOCAL_STORAGE,
    /* A guest flies the first hull as it comes, until they sign up. */
    limits: { customiseShips: false, why: GUEST_SHIP_LIMIT },
    /* The same project and public key as the app; sign-in will add a credential. */
    account: DEFAULT_ACCOUNT,
    roomBase: opts.roomBase ?? DEFAULT_ROOM_BASE,
    /* No staking wallet on the web. */
    wonStakeRecently: () => false,
    prices: { fetch: () => fetchWebPrices() },
    money: {
      validateAddress: (address: string) => isDiviAddress(address),
      /* No wallet of their own here, so the address box starts empty. */
      ownAddresses: () => Promise.resolve([]),
      /* Sending DIVI needs a wallet; buying points stays in the app for now. */
      PayWithDivi: null,
    },
    detail: DESKTOP_DETAIL,
    input: desktopInput,
  };
}
