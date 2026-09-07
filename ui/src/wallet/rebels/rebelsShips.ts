// Your fleet, kept where you can lose your machine and not lose your ships.
//
// The colour scheme and the chosen hull already live in localStorage, and that
// stays: it is what makes the badge appear the instant the game opens, before
// any network has answered. Supabase is the copy that survives a reinstall, a
// second machine, or the browser storage being cleared.
//
// WHY IT IS WRITTEN AS A FLEET
// ----------------------------
// One hull and one scheme would fit in one row of preferences. It would also
// have to be thrown away the day anybody owns two, and Geoff asked for the
// framework now: several ships, each with its own name, each listable for sale
// later. So the table is one row per SHIP, and this is the client for it. The
// marketplace itself is not built and nothing here pretends otherwise.

import { SUPABASE_URL, SUPABASE_ANON_KEY } from "../exchanges";
import { playerName } from "./rebelsScores";
import type { ShipPaint } from "./shipColours";

const headers = {
  apikey: SUPABASE_ANON_KEY,
  Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
  "Content-Type": "application/json",
};

export interface FleetShip {
  id: string;
  model: string;
  tier: number;
  /** What the owner calls it, or empty for "whatever the class is". */
  name: string;
  paint: ShipPaint | Record<string, never>;
  isActive: boolean;
  /** Marketplace, for later. Never set by this client yet. */
  forSale: boolean;
  priceDivi: number | null;
}

/**
 * Save a ship and make it the one being flown.
 *
 * Fire and forget on purpose. A colour slider that waited for a round trip
 * before it moved would be a bad slider, and losing one save is losing nothing:
 * the next change writes the same state again. The local copy is the one the
 * game reads.
 */
export async function saveShip(
  model: string,
  tier: number,
  paint: ShipPaint,
  name = "",
): Promise<void> {
  const who = playerName();
  if (!who) return;
  try {
    await fetch(`${SUPABASE_URL}/rest/v1/rpc/rebels_ship_save`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        p_owner_key: who,
        p_owner_name: who,
        p_model: model,
        p_tier: tier,
        p_name: name,
        p_paint: paint,
      }),
    });
  } catch {
    /* Offline, or the wallet has no network. The local copy still holds. */
  }
}

/** Every ship this player owns, newest first. Empty when offline. */
export async function myFleet(who = playerName()): Promise<FleetShip[]> {
  if (!who) return [];
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/rebels_ships` +
        `?owner_key=eq.${encodeURIComponent(who.toLowerCase())}` +
        `&select=id,model,tier,name,paint,is_active,for_sale,price_divi` +
        `&order=acquired_at.desc`,
      { headers },
    );
    if (!res.ok) return [];
    const rows = (await res.json()) as Array<Record<string, unknown>>;
    return rows.map((r) => ({
      id: String(r.id),
      model: String(r.model),
      tier: Number(r.tier) || 1,
      name: String(r.name ?? ""),
      paint: (r.paint ?? {}) as ShipPaint,
      isActive: !!r.is_active,
      forSale: !!r.for_sale,
      priceDivi: r.price_divi === null || r.price_divi === undefined ? null : Number(r.price_divi),
    }));
  } catch {
    return [];
  }
}
