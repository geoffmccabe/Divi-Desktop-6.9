// The six curated grid characters that admins assign and everyone can choose.
//
// SECURITY — the public character and its secret API key are stored SEPARATELY,
// on purpose. The public part (name, description, thumbnail) is what gets
// published to the scanner and served to every user. The Kinet.ink api_key is a
// secret that authorises chat and its spend; it must NEVER reach a user. Keeping
// them in one object invited a one-line mistake in Phase 1 (publish the object →
// leak every key), so they are split at the storage layer: loadGrid() returns
// only public data, loadKeys() is the admin-only secret store, and the two never
// travel together.
//
// INTERIM: both live in localStorage so the admin flow works today. The public
// characters move to the scanner's identity index; the keys move server-side to
// the gateway (which mints chat embed URLs). See docs/NODE-IDENTITY-PLAN.md.

import { walletOwns } from "./api";

const KEY_PUBLIC = "dd69.gridCharacters";
const KEY_SECRET = "dd69.gridKeys"; // ⚠ admin-only, never published
export const GRID_SIZE = 6;

// Geoff's two nodes. Admin controls appear only when the connected node's wallet
// holds one of these — the "only if one of my two nodes is connected" gate.
// This is a CONVENIENCE gate on the UI only; the scanner must enforce writes
// server-side (SSO superadmin / signed admin address). Any owned address works —
// the check uses validateaddress ismine, independent of tx activity.
const ADMIN_ADDRESSES = [
  "D6ohNJtUVbRsrfxUUC8phi6zXfUHQUYmuT", // home node (Costa Rica)
  "DPGxoAGLi6wciUcf2R2tDi1GqbNYMSRvoz", // Divi Love Scan (London)
];

/** Public character data — safe to publish. NO secrets here, by construction. */
export interface GridCharacter {
  name: string;
  description: string;
  thumb: string; // small WebP data URL for the tile
}

export type GridSlots = (GridCharacter | null)[];

function normalizePublic(v: unknown): GridSlots {
  const out: GridSlots = Array(GRID_SIZE).fill(null);
  if (Array.isArray(v)) {
    for (let i = 0; i < GRID_SIZE; i++) {
      const c = v[i];
      if (c && typeof c === "object") {
        out[i] = {
          name: String((c as GridCharacter).name ?? ""),
          description: String((c as GridCharacter).description ?? ""),
          thumb: String((c as GridCharacter).thumb ?? ""),
        };
      }
    }
  }
  return out;
}

export function loadGrid(): GridSlots {
  try {
    return normalizePublic(JSON.parse(localStorage.getItem(KEY_PUBLIC) || "null"));
  } catch {
    return Array(GRID_SIZE).fill(null);
  }
}

export function saveGrid(slots: GridSlots) {
  try {
    // Defensive: strip anything that isn't a known public field, so a stray
    // secret can never ride along even if a caller passes extra keys.
    const clean = slots.slice(0, GRID_SIZE).map((s) =>
      s ? { name: s.name, description: s.description, thumb: s.thumb } : null,
    );
    localStorage.setItem(KEY_PUBLIC, JSON.stringify(clean));
  } catch {
    /* storage full */
  }
  window.dispatchEvent(new Event("dd69-grid-changed"));
}

// ── Secret API keys, kept apart from anything publishable ────────────────────

export function loadKeys(): (string | null)[] {
  try {
    const v = JSON.parse(localStorage.getItem(KEY_SECRET) || "null");
    const out: (string | null)[] = Array(GRID_SIZE).fill(null);
    if (Array.isArray(v)) for (let i = 0; i < GRID_SIZE; i++) if (typeof v[i] === "string") out[i] = v[i];
    return out;
  } catch {
    return Array(GRID_SIZE).fill(null);
  }
}

export function saveKeys(keys: (string | null)[]) {
  try {
    localStorage.setItem(KEY_SECRET, JSON.stringify(keys.slice(0, GRID_SIZE)));
  } catch {
    /* storage full */
  }
}

/** True when the connected node's wallet OWNS one of the admin addresses. */
export async function isAdminNode(): Promise<boolean> {
  try {
    return await walletOwns(ADMIN_ADDRESSES);
  } catch {
    return false;
  }
}
