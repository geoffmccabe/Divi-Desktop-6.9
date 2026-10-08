// PERC tier art + glow registry. A revealed Perc (and every forge result) is
// identified by its ROLLED TIER, and all Percs of a tier share the same artwork
// and the same rarity glow. A forge result carries zeroed per-item pointers on
// purpose: it is meant to draw its tier's shared art, never a unique image.
//
// Two concerns live here, both keyed by tier so the card, the viewer, and the
// reveal animation all agree:
//   - tierGlow:   the rarity colour (pure CSS, no network) — usable right now.
//   - tierArtUrl: the shared artwork URL for a tier in a collection — returns
//                 null until a collection's tier-art manifest is registered
//                 (that manifest shape is part of the Kinetink export spec, still
//                 being finalised). Register it with `setTierArtManifest` once the
//                 gateway URLs are known; everything downstream picks it up.

import { LEVELS } from "./revealModel";

/// Art reuses T40's set beyond 40 (a forge result tier may exceed 40).
export const MAX_ART_TIER = 40;

/// Map an absolute tier (1..40+) onto the 10-step rarity colour ladder: higher
/// tier = rarer = more spectacular. UR gets the signature violet. This keys off
/// the ABSOLUTE tier (unlike the reveal animation, which keys off tiers jumped),
/// because a card shows what a Perc IS, not how far it leapt to get there.
export function tierGlow(tier: number, ur: boolean | number | null = false): string {
  if (ur != null && ur !== false) return "#b76bff";
  const t = Math.max(1, Math.min(MAX_ART_TIER, Math.round(tier)));
  const step = Math.max(1, Math.min(10, Math.ceil((t / MAX_ART_TIER) * 10)));
  return LEVELS[step].c[0];
}

/// A ready-to-use card glow (soft ring in the tier colour).
export function tierGlowShadow(tier: number, ur: boolean | number | null = false): string {
  const c = tierGlow(tier, ur);
  return `0 0 0 1px ${c}80, 0 0 14px ${c}66`;
}

// --- Shared artwork lookup (seam for the Kinetink tier-art manifest) ---------
// Per collection: tier -> gateway image URL. Populated at runtime once a
// collection's manifest is known; empty until then (cards fall back to a
// tier-coloured badge, which is correct and legible on its own).
const manifests = new Map<string, Record<number, string>>();

export function setTierArtManifest(collectionId: string, byTier: Record<number, string>): void {
  manifests.set(collectionId.toLowerCase(), byTier);
}

/// The shared artwork URL for a tier in a collection, or null if not registered.
/// Tiers above 40 reuse T40's art.
export function tierArtUrl(collectionId: string | undefined, tier: number): string | null {
  if (!collectionId) return null;
  const m = manifests.get(collectionId.toLowerCase());
  if (!m) return null;
  const t = Math.min(MAX_ART_TIER, Math.max(1, Math.round(tier)));
  return m[t] ?? m[MAX_ART_TIER] ?? null;
}
