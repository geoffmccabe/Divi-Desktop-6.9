// Where the store gets its list of apps.
//
// There is no store backend yet and nothing has been published, so this returns
// an empty list. That is deliberately honest: an empty store is the truth right
// now, and the panel says so in plain words rather than showing invented
// placeholder apps that a user might try to install.
//
// When the backend lands this becomes a fetch plus signature verification, and
// the shape below is what it must return. Nothing else in the UI changes.

import type { AppManifest } from "./manifest";

export interface CatalogEntry {
  manifest: AppManifest;
  /** Base URL the verified bundle is served from. */
  base: string;
  /** True once the signature has been checked against our publishing key. */
  verified: boolean;
}

export interface Catalog {
  entries: CatalogEntry[];
  /** Null while loading, a sentence if the store could not be reached. */
  error: string | null;
}

export async function loadCatalog(): Promise<Catalog> {
  // Intentionally empty until the store service exists. Do not seed this with
  // examples: a fake entry in a wallet's app store is exactly the kind of thing
  // a user would reasonably trust.
  return { entries: [], error: null };
}

export function priceLabel(m: AppManifest): { text: string; free: boolean } {
  switch (m.price.model) {
    case "free":
      return { text: "Free", free: true };
    case "purchase":
      return { text: `${m.price.amount.toLocaleString()} DIVI`, free: false };
    case "in-app":
      return { text: "Free, charges inside", free: false };
  }
}
