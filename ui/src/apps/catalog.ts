// Where the store gets its list of apps.
//
// Two sources, deliberately distinguished rather than blurred together:
//
//   * BUILT IN - compiled into the wallet, so it is trustworthy for the same
//     reason the Send panel is: it shipped with the binary. Nothing to verify.
//   * PUBLISHED - a third party's bundle. Untrusted, and only shown once its
//     signature has been checked against our publishing key.
//
// There is no store backend yet, so the published list is empty. That is the
// truth and the panel says so, rather than showing placeholder apps a user might
// reasonably try to trust.

import { invoke } from "../tauri";
import { parseManifest, type AppManifest } from "./manifest";

export interface CatalogEntry {
  manifest: AppManifest;
  /** Url the verified bundle is served from, built by Rust per platform. */
  base: string;
  /** Ships with the wallet rather than being installed from the store. */
  builtin: boolean;
  /** Safe to run: built in, or signature checked. */
  verified: boolean;
}

export interface Catalog {
  entries: CatalogEntry[];
  /** A sentence if something went wrong, otherwise null. */
  error: string | null;
}

async function loadBuiltins(): Promise<CatalogEntry[]> {
  const raw = await invoke<string[]>("community_builtin_apps");
  const out: CatalogEntry[] = [];
  for (const json of raw) {
    let manifest: AppManifest;
    try {
      // Built-in manifests go through exactly the same validator as third-party
      // ones. If our own app cannot satisfy the rules we publish, the rules or
      // the app is wrong, and it should fail here where we will see it.
      manifest = parseManifest(JSON.parse(json));
    } catch {
      continue;
    }
    try {
      const base = await invoke<string>("community_app_base", { appId: manifest.id });
      out.push({ manifest, base, builtin: true, verified: true });
    } catch {
      // A built-in the backend will not serve is not shown at all rather than
      // shown as a card that does nothing when clicked.
    }
  }
  return out;
}

export async function loadCatalog(): Promise<Catalog> {
  try {
    const builtins = await loadBuiltins();
    // Published apps go here once the store service exists. Do not seed this
    // with examples.
    return { entries: builtins, error: null };
  } catch {
    // Running outside the desktop app (a browser preview) has no backend. Say so
    // plainly instead of pretending the store is empty.
    return { entries: [], error: "App list is only available inside the desktop app." };
  }
}

/**
 * Media paths in a manifest are relative to the app's own bundle. Left as-is
 * they would resolve against the WALLET's origin and quietly 404, so they are
 * made absolute against the app's base url here, in one place.
 */
export function resolveMedia(entry: CatalogEntry) {
  const at = (p: string) => new URL(p, entry.base).toString();
  const s = entry.manifest.media.showcase;
  return {
    thumbnail: at(entry.manifest.media.thumbnail),
    showcase: !s
      ? undefined
      : s.type === "image"
        ? { ...s, image: at(s.image) }
        : s.type === "slideshow"
          ? { ...s, images: s.images.map(at) }
          : s.type === "video"
            ? { ...s, video: at(s.video) }
            : s,
  };
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
