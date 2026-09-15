// Who a player is, and what they may do.
//
// Moved out of room.ts (2026-Sep-15) because this is the part that grows: app
// players are known by the address they connect from, web guests by a private id
// made in their browser, and signed-in players (next) by a verified session. The
// rules for each live here, in one place, rather than scattered through the room.

import { guestIdOk } from "./protocol";

/** The hull a web guest flies: the first one (shipChoice's DEFAULT_SHIP). */
export const GUEST_SHIP = "space_SM_Ship_Fighter_01";

/** What a web guest is told about cashing out, on every purse it is sent. */
export const GUEST_CASH_OUT = "Sign in to cash out DIVI earned on the web. It stays banked to you until you do.";

export interface Who {
  /** The ledger account everything this player earns is banked under. */
  account: string;
  /** A web guest: banked to its own account, cannot cash out or cheat, flies the
   *  first hull. */
  guest: boolean;
}

/**
 * Who is joining.
 *
 * `from` is the address the socket connected from ("" in a local run or a test,
 * when the declared node stands in). An app player's account is that address.
 * A web guest's is its private id when it sends a sound one, and its address,
 * marked as the web's, when it does not: so a guest and an app player behind the
 * same router never share a balance.
 */
export function whoJoins(from: string, node: string, m: { door?: unknown; guest?: unknown }): Who {
  const base = from || node;
  if (m.door !== "web") return { account: base, guest: false };
  return { account: (guestIdOk(m.guest) ? `guest:${m.guest}` : `web:${base}`).slice(0, 80), guest: true };
}

/** May this player use the test cheats? Never a web guest: "21" is a real dragon
 *  that leaves a real egg, and any browser console can send the message. */
export function mayCheat(who: Who): boolean {
  return !who.guest;
}

/** May this player cash out? A guest's DIVI is real and stays banked, but paying
 *  it out waits for a signed-in account. */
export function mayCashOut(who: Who): boolean {
  return !who.guest;
}

/** The hull this player is shown in: a guest's is the first one, whatever its
 *  page asked for. */
export function shipFor(who: Who, asked: string): string {
  return who.guest ? GUEST_SHIP : asked;
}
