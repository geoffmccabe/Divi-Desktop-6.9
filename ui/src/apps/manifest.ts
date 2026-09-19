// The app manifest: types plus a validator that fails closed.
//
// Format: docs/COMMUNITY-APPS-MANIFEST.md
//
// Deliberate choices, both of which cost nothing now and prevent a class of
// problem later:
//   1. Unknown fields are an ERROR, not ignored. A future field cannot be
//      smuggled past an older wallet that would not understand it.
//   2. Unknown schema versions are refused outright rather than best-effort
//      parsed. Refusing to run is recoverable; running something we only partly
//      understand is not.

import { isPermissionKey, type PermissionKey } from "./permissions";

export const SCHEMA_VERSION = 1;

export type ImmersiveMode = "never" | "on-demand" | "always";

export type Showcase =
  | { type: "image"; image: string }
  | { type: "slideshow"; images: string[] }
  | { type: "video"; video: string }
  | { type: "youtube"; youtubeId: string };

export type Price =
  | { model: "free" }
  | { model: "purchase"; amount: number }
  | { model: "in-app" };

export interface AppManifest {
  schema: number;
  id: string;
  name: string;
  version: string;
  author: { name: string; address: string };
  description: string;
  permissions: PermissionKey[];
  network: string[];
  display?: { immersive?: ImmersiveMode; minWidth?: number };
  media: { thumbnail: string; showcase?: Showcase };
  price: Price;
}

const TOP_LEVEL_FIELDS = new Set([
  "schema", "id", "name", "version", "author", "description",
  "permissions", "network", "display", "media", "price",
]);

// Reverse-domain style, lowercase. This is the storage namespace, the
// entitlement key and the revocation handle, so it must be tightly shaped.
const ID_RE = /^[a-z0-9]+(\.[a-z0-9-]+){1,4}$/;
const SEMVER_RE = /^\d+\.\d+\.\d+$/;
const HOSTNAME_RE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;
// Divi addresses are base58, version byte 30, so they start with D.
const ADDRESS_RE = /^D[1-9A-HJ-NP-Za-km-z]{25,40}$/;
// Bundle-relative only. Anything that could escape the bundle is rejected.
const REL_PATH_RE = /^[a-zA-Z0-9_-]+(\/[a-zA-Z0-9_.-]+)*\.[a-zA-Z0-9]+$/;
const YOUTUBE_ID_RE = /^[A-Za-z0-9_-]{11}$/;

export const LIMITS = {
  name: 48,
  description: 240,
  authorName: 48,
  permissions: 8,
  network: 6,
  slideshow: 8,
  maxPriceDivi: 1_000_000,
} as const;

export class ManifestError extends Error {}

function fail(msg: string): never {
  throw new ManifestError(msg);
}

function str(v: unknown, field: string, max: number): string {
  if (typeof v !== "string") fail(`${field} must be text`);
  const s = v.trim();
  if (!s) fail(`${field} must not be empty`);
  if (s.length > max) fail(`${field} must be ${max} characters or fewer`);
  return s;
}

function relPath(v: unknown, field: string): string {
  const s = str(v, field, 160);
  if (s.includes("..") || s.startsWith("/") || s.includes("://")) {
    fail(`${field} must point inside the app bundle`);
  }
  if (!REL_PATH_RE.test(s)) fail(`${field} is not a valid file path inside the bundle`);
  return s;
}

function parseShowcase(v: unknown): Showcase {
  if (typeof v !== "object" || v === null) fail("media.showcase must be an object");
  const o = v as Record<string, unknown>;
  switch (o.type) {
    case "image":
      return { type: "image", image: relPath(o.image, "media.showcase.image") };
    case "slideshow": {
      if (!Array.isArray(o.images) || o.images.length === 0) {
        fail("media.showcase.images must list at least one image");
      }
      if (o.images.length > LIMITS.slideshow) {
        fail(`media.showcase.images allows at most ${LIMITS.slideshow} images`);
      }
      return {
        type: "slideshow",
        images: o.images.map((i, n) => relPath(i, `media.showcase.images[${n}]`)),
      };
    }
    case "video":
      return { type: "video", video: relPath(o.video, "media.showcase.video") };
    case "youtube": {
      const id = str(o.youtubeId, "media.showcase.youtubeId", 16);
      if (!YOUTUBE_ID_RE.test(id)) fail("media.showcase.youtubeId is not a valid video id");
      return { type: "youtube", youtubeId: id };
    }
    default:
      fail("media.showcase.type must be image, slideshow, video or youtube");
  }
}

function parsePrice(v: unknown): Price {
  if (typeof v !== "object" || v === null) fail("price must be an object");
  const o = v as Record<string, unknown>;
  switch (o.model) {
    case "free":
      return { model: "free" };
    case "in-app":
      return { model: "in-app" };
    case "purchase": {
      const amount = o.amount;
      if (typeof amount !== "number" || !Number.isFinite(amount) || amount <= 0) {
        fail("price.amount must be a positive number");
      }
      if (amount > LIMITS.maxPriceDivi) fail("price.amount is implausibly large");
      return { model: "purchase", amount };
    }
    default:
      fail("price.model must be free, purchase or in-app");
  }
}

/**
 * Parse and validate a manifest. Throws ManifestError with a message fit to show
 * a developer. Never returns a partially valid manifest.
 */
export function parseManifest(input: unknown): AppManifest {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    fail("manifest must be a JSON object");
  }
  const o = input as Record<string, unknown>;

  for (const key of Object.keys(o)) {
    if (!TOP_LEVEL_FIELDS.has(key)) fail(`unknown field "${key}" in manifest`);
  }

  if (o.schema !== SCHEMA_VERSION) {
    fail(`unsupported manifest schema (this wallet understands ${SCHEMA_VERSION})`);
  }

  const id = str(o.id, "id", 96).toLowerCase();
  if (!ID_RE.test(id)) fail("id must look like com.example.my-app");

  const version = str(o.version, "version", 16);
  if (!SEMVER_RE.test(version)) fail("version must look like 1.0.0");

  if (typeof o.author !== "object" || o.author === null) fail("author is required");
  const author = o.author as Record<string, unknown>;
  const address = str(author.address, "author.address", 64);
  if (!ADDRESS_RE.test(address)) fail("author.address is not a valid Divi address");

  if (!Array.isArray(o.permissions)) fail("permissions must be a list (use [] for none)");
  if (o.permissions.length > LIMITS.permissions) {
    fail(`an app may request at most ${LIMITS.permissions} permissions`);
  }
  const permissions: PermissionKey[] = [];
  for (const p of o.permissions) {
    if (typeof p !== "string" || !isPermissionKey(p)) fail(`unknown permission "${String(p)}"`);
    if (permissions.includes(p)) fail(`permission "${p}" listed twice`);
    permissions.push(p);
  }

  if (!Array.isArray(o.network)) fail("network must be a list (use [] for none)");
  if (o.network.length > LIMITS.network) {
    fail(`an app may list at most ${LIMITS.network} hosts`);
  }
  const network = o.network.map((h, n) => {
    const s = str(h, `network[${n}]`, 128).toLowerCase();
    if (!HOSTNAME_RE.test(s)) fail(`network[${n}] is not a valid hostname`);
    return s;
  });
  if (network.length > 0 && !permissions.includes("network")) {
    fail('listing hosts requires the "network" permission');
  }

  if (typeof o.media !== "object" || o.media === null) fail("media is required");
  const media = o.media as Record<string, unknown>;
  const thumbnail = relPath(media.thumbnail, "media.thumbnail");
  const showcase = media.showcase === undefined ? undefined : parseShowcase(media.showcase);

  const price = parsePrice(o.price);
  if (price.model !== "free" && !permissions.includes("payment.request")) {
    fail('a paid app must request the "payment.request" permission');
  }

  let display: AppManifest["display"];
  if (o.display !== undefined) {
    if (typeof o.display !== "object" || o.display === null) fail("display must be an object");
    const d = o.display as Record<string, unknown>;
    const immersive = d.immersive === undefined ? "never" : d.immersive;
    if (immersive !== "never" && immersive !== "on-demand" && immersive !== "always") {
      fail("display.immersive must be never, on-demand or always");
    }
    let minWidth: number | undefined;
    if (d.minWidth !== undefined) {
      if (typeof d.minWidth !== "number" || d.minWidth < 320 || d.minWidth > 4096) {
        fail("display.minWidth must be a sensible pixel width");
      }
      minWidth = d.minWidth;
    }
    display = { immersive: immersive as ImmersiveMode, minWidth };
  }

  return {
    schema: SCHEMA_VERSION,
    id,
    name: str(o.name, "name", LIMITS.name),
    version,
    author: { name: str(author.name, "author.name", LIMITS.authorName), address },
    description: str(o.description, "description", LIMITS.description),
    permissions,
    network,
    display,
    media: { thumbnail, showcase },
    price,
  };
}

export function immersiveMode(m: AppManifest): ImmersiveMode {
  return m.display?.immersive ?? "never";
}
