// The six curated grid characters that admins assign and everyone can choose.
//
// INTERIM STORAGE: these live in localStorage for now so the admin flow works
// end-to-end today. The permanent home is the scanner's public identity index
// (docs/NODE-IDENTITY-PLAN.md §0b) — this file is the seam that will later read
// the scanner manifest and write through the SSO superadmin gate. The shape here
// deliberately matches what that service will store.
//
// ⚠ The Kinetink apiKey is the one sensitive field. On the scanner it must stay
// server-side and reach the client only as the chat embed URL. Keeping it in
// localStorage is acceptable ONLY because this is the admin's own machine during
// development; it must NOT ship to ordinary users this way.

import { walletOwns } from "./api";

const KEY = "dd69.gridCharacters";
export const GRID_SIZE = 6;

// Geoff's two nodes. Admin controls appear only when the connected node's wallet
// holds one of these — i.e. "only if one of my two nodes is connected", the gate
// he specified. This is a convenience gate for the UI; real enforcement is the
// SSO superadmin role server-side once the scanner service exists.
// Any address each node owns works — the check uses validateaddress ismine, so
// it does not matter which is "main" or whether it has transaction activity.
const ADMIN_ADDRESSES = [
  "D6ohNJtUVbRsrfxUUC8phi6zXfUHQUYmuT", // home node (Costa Rica)
  "DPGxoAGLi6wciUcf2R2tDi1GqbNYMSRvoz", // Divi Love Scan (London)
];

export interface GridCharacter {
  name: string;
  description: string;
  thumb: string; // small WebP data URL for the tile
  apiKey: string; // Kinetink api_key — wires the character to its AI
}

export type GridSlots = (GridCharacter | null)[];

function normalize(v: unknown): GridSlots {
  const out: GridSlots = Array(GRID_SIZE).fill(null);
  if (Array.isArray(v)) {
    for (let i = 0; i < GRID_SIZE; i++) {
      const c = v[i];
      if (c && typeof c === "object") {
        out[i] = {
          name: String((c as GridCharacter).name ?? ""),
          description: String((c as GridCharacter).description ?? ""),
          thumb: String((c as GridCharacter).thumb ?? ""),
          apiKey: String((c as GridCharacter).apiKey ?? ""),
        };
      }
    }
  }
  return out;
}

export function loadGrid(): GridSlots {
  try {
    return normalize(JSON.parse(localStorage.getItem(KEY) || "null"));
  } catch {
    return Array(GRID_SIZE).fill(null);
  }
}

export function saveGrid(slots: GridSlots) {
  try {
    localStorage.setItem(KEY, JSON.stringify(slots.slice(0, GRID_SIZE)));
  } catch {
    /* storage full */
  }
  window.dispatchEvent(new Event("dd69-grid-changed"));
}

/** True when the connected node's wallet OWNS one of the admin addresses. */
export async function isAdminNode(): Promise<boolean> {
  try {
    return await walletOwns(ADMIN_ADDRESSES);
  } catch {
    return false;
  }
}
