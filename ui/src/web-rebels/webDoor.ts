// The web door: how Divi Rebels answers its questions at divi.love/rebels.
//
// A guest for now: PLAY NOW gets straight into the shared sky with no sign-in.
// Signing in with LW-SSO comes next and is offered, never required; until then
// a guest's DIVI is banked on the server and cashing it out asks them to sign in.

import type { RebelsPlatform } from "../wallet/rebels/platform/platform";
import { DEFAULT_ROOM_BASE, DESKTOP_DETAIL } from "../wallet/rebels/platform/defaults";
import { desktopInput } from "../wallet/rebels/platform/desktopInput";
import { isDiviAddress } from "./diviAddress";
import { fetchWebPrices } from "./webPrice";
import { guestName } from "./pilot";

export function createWebDoor(opts: { roomBase?: string; name?: () => string } = {}): RebelsPlatform {
  const name = opts.name ?? (() => guestName());
  return {
    id: "web",
    identity: {
      name,
      joinFields: () => ({ node: "web-guest", name: name(), door: "web" }),
    },
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
