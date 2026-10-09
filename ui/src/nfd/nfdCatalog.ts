// What an NFD collection IS, and how to read one safely off the wire.
//
// GAME AGNOSTIC ON PURPOSE. Nothing in this file knows about ships, waves,
// DIVI or Divi Rebels. Geoff wants the same NFDs in his other games, so the
// catalog, the ingest and the ownership shape live here and each game writes
// only its own benefits file on top. The moment this file imports something
// from rebels/, that promise is gone.
//
// The source format is Kinetink's "launch package", one JSON file per
// collection. See /Users/geoffreymccabe/kinetink/docs/DIVI_REBELS_NFD_INTEGRATION.md
// for the field-by-field spec it is read against.

/** The one host Kinetink serves media from. Nothing else is fetched. */
export const KINETINK_MEDIA_HOST = "matteqdhinpiwfnvxaef.supabase.co";

/** The only file format accepted. A file saying anything else is refused. */
export const LAUNCH_FORMAT = "kinetink-collection-launch";

export interface NfdMedia {
  /** The still. Always present: every grid, icon and drop uses this. */
  image: string;
  /** The MP4 when the item is animated, else null. */
  animation: string | null;
  mediaType: "image" | "video";
  isBoomerang: boolean;
}

export interface NfdItem {
  /**
   * 1..N, unique, stable, and the key for EVERYTHING until the set is on
   * chain. After launch a map from edition to the on-chain id is added
   * beside this rather than replacing it, so nothing keyed on edition breaks.
   */
  edition: number;
  name: string;
  description: string;
  /** Drives rarity and the size of the ownership benefit. */
  tier: number;
  rarity: string;
  rarityLabel: string;
  /** ⚠ ALL Ultra Rare logic keys on THIS, never on the rarity text, which is
   *  free-form and has already been two different things. */
  isUltraRare: boolean;
  media: NfdMedia;
  attributes: Array<{ trait_type: string; value: string }>;
}

export interface NfdUltraRareRoll {
  /** 0..1. The gate: the chance a roll is an Ultra Rare at all. */
  basicChance: number;
  /** The geometric drop-off across the Ultra Rare slots. */
  progressiveFactor: number;
  count: number;
}

export interface NfdCollection {
  /** Ours, not Kinetink's: a short stable key an admin types once. */
  id: string;
  name: string;
  description: string;
  /** Card shape, so nothing is drawn stretched. */
  aspectRatio: string;
  /** The sealed, pre-reveal art. What a dropped cube wears. */
  packagedArt: string | null;
  ultraRare: NfdUltraRareRoll | null;
  logo: string | null;
  featured: string | null;
  banner: string | null;
  items: NfdItem[];
  /** Whether this collection counts in the game. An admin turns it on. */
  enabled: boolean;
}

/* ================= READING A LAUNCH FILE ================= */

const str = (v: unknown, fallback = ""): string => (typeof v === "string" ? v : fallback);
const num = (v: unknown, fallback = 0): number => (typeof v === "number" && Number.isFinite(v) ? v : fallback);

/**
 * Is this a URL we are willing to fetch?
 *
 * Parsed rather than pattern-matched, because "contains the host" is true of
 * `https://evil.test/?x=matteqdhinpiwfnvxaef.supabase.co` and a substring
 * check is how an allowlist becomes decoration. Only https, only that host,
 * and the host must match exactly rather than merely end with it, or
 * `notmatteqdhinpiwfnvxaef.supabase.co` walks straight through.
 */
export function mediaUrlOk(raw: unknown): boolean {
  if (typeof raw !== "string" || raw === "") return false;
  let u: URL;
  try { u = new URL(raw); } catch { return false; }
  return u.protocol === "https:" && u.hostname === KINETINK_MEDIA_HOST;
}

/**
 * The items, checked one at a time. Shared by a launch file and a saved row,
 * because an item has the same shape in both and a second copy of these rules
 * is a second place for them to drift.
 */
function readItems(raw: unknown, errors: string[]): NfdItem[] {
  const rawItems = Array.isArray(raw) ? raw : [];
  const items: NfdItem[] = [];
  const seen = new Set<number>();
  for (const [i, r] of rawItems.entries()) {
    const it = (r ?? {}) as Record<string, unknown>;
    const edition = num(it.edition, -1);
    const where = `item ${i + 1}`;
    if (!Number.isInteger(edition) || edition < 1) {
      errors.push(`${where}: edition must be a whole number from 1`);
      continue;
    }
    if (seen.has(edition)) { errors.push(`${where}: edition ${edition} appears twice`); continue; }
    seen.add(edition);

    const media = (it.media ?? {}) as Record<string, unknown>;
    if (!mediaUrlOk(media.image)) {
      errors.push(`edition ${edition}: its image is not an https URL on ${KINETINK_MEDIA_HOST}`);
      continue;
    }
    const animation = mediaUrlOk(media.animation) ? str(media.animation) : null;
    if (media.animation != null && animation === null) {
      errors.push(`edition ${edition}: its animation is not an https URL on ${KINETINK_MEDIA_HOST}`);
      continue;
    }
    items.push({
      edition,
      name: str(it.name) || `#${edition}`,
      description: str(it.description),
      tier: Math.max(1, Math.round(num(it.tier, 1))),
      rarity: str(it.rarity, "common"),
      rarityLabel: str(it.rarityLabel) || str(it.rarity, "common"),
      isUltraRare: it.isUltraRare === true,
      media: {
        image: str(media.image),
        animation,
        mediaType: animation ? "video" : "image",
        isBoomerang: media.isBoomerang === true,
      },
      attributes: Array.isArray(it.attributes)
        ? (it.attributes as Array<Record<string, unknown>>)
          .map((a) => ({ trait_type: str(a.trait_type), value: str(a.value) }))
          .filter((a) => a.trait_type !== "")
        : [],
    });
  }
  return items.sort((a, b) => a.edition - b.edition);
}

/** The Ultra Rare draw, checked. Also shared by both readers. */
function readUltraRare(raw: unknown, errors: string[]): NfdUltraRareRoll | null {
  const ur = (raw ?? null) as Record<string, unknown> | null;
  if (!ur) return null;
  const basicChance = num(ur.basicChance, 0);
  const progressiveFactor = num(ur.progressiveFactor, 0);
  const count = Math.round(num(ur.count, 0));
  if (basicChance < 0 || basicChance > 1) errors.push("the Ultra Rare chance must be between 0 and 1");
  if (progressiveFactor < 0 || progressiveFactor >= 1) {
    errors.push("the Ultra Rare factor must be at least 0 and below 1");
  }
  if (count < 0) errors.push("the Ultra Rare count cannot be negative");
  return { basicChance, progressiveFactor, count };
}

/** The id an admin types: lowercase letters, numbers and hyphens. */
const ID_OK = /^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/;

/** Every reason a file cannot be used, or the collection it describes. */
export function readLaunchFile(
  raw: unknown, id: string,
): { ok: NfdCollection } | { errors: string[] } {
  const errors: string[] = [];
  const f = (raw ?? {}) as Record<string, unknown>;

  if (str(f.format) !== LAUNCH_FORMAT) {
    errors.push(`format must be "${LAUNCH_FORMAT}" (got ${JSON.stringify(f.format)})`);
    /* Nothing else is worth saying about a file that is not one of ours. */
    return { errors };
  }
  if (num(f.version) !== 1) errors.push(`version must be 1 (got ${JSON.stringify(f.version)})`);
  if (!ID_OK.test(id)) {
    errors.push("the collection id must be lowercase letters, numbers and hyphens");
  }

  const c = (f.collection ?? {}) as Record<string, unknown>;
  if (!Array.isArray(f.items) || f.items.length === 0) errors.push("the file lists no items");
  const items = readItems(f.items, errors);

  const packagedArt = mediaUrlOk(c.packagedArt) ? str(c.packagedArt) : null;
  if (c.packagedArt != null && packagedArt === null) {
    errors.push(`the packaged art is not an https URL on ${KINETINK_MEDIA_HOST}`);
  }
  /* In a LAUNCH FILE the three shop pictures arrive wrapped, as {url}. In our
     own stored shape they are plain strings. That difference is the only
     reason these two readers are not one function. */
  const wrapped = (v: unknown): string | null => {
    const o = (v ?? {}) as Record<string, unknown>;
    return mediaUrlOk(o.url) ? str(o.url) : null;
  };
  const images = (c.images ?? {}) as Record<string, unknown>;
  const ultraRare = readUltraRare(c.ultraRare, errors);

  if (errors.length) return { errors };
  return {
    ok: {
      id,
      name: str(c.name) || id,
      description: str(c.description),
      aspectRatio: str(c.aspectRatio, "1:1"),
      packagedArt,
      ultraRare,
      logo: wrapped(images.logo),
      featured: wrapped(images.featured),
      banner: wrapped(images.banner),
      items,
      /* OFF until an admin says otherwise. Geoff: "only specific NFD
         collections would be useful in the game and anything else will not
         show." A collection that counted the moment it was uploaded would be
         the opposite of that. */
      enabled: false,
    },
  };
}

/**
 * The same checks, against our OWN stored shape rather than a launch file.
 *
 * Why this exists as well as readLaunchFile: a row in the database was not
 * necessarily written by today's panel. It may have been written by an older
 * one, or by hand in the SQL editor, and a media URL that was fine when it was
 * saved is still worth re-checking on the way out, because the whole point of
 * the host allowlist is that nothing off that host is ever fetched. Reading a
 * row is therefore a validation, not a cast.
 *
 * `enabled` is taken from the raw object here, unlike in a launch file where
 * it is forced off: by the time a row is being read, an admin has already had
 * their say.
 */
export function validateCollection(
  raw: unknown, id: string,
): { ok: NfdCollection } | { errors: string[] } {
  const errors: string[] = [];
  const c = (raw ?? {}) as Record<string, unknown>;

  if (!ID_OK.test(id)) {
    errors.push("the collection id must be lowercase letters, numbers and hyphens");
  }
  if (!Array.isArray(c.items) || c.items.length === 0) errors.push("that collection lists no items");
  const items = readItems(c.items, errors);

  const art = (v: unknown, what: string): string | null => {
    if (v == null) return null;
    if (mediaUrlOk(v)) return str(v);
    errors.push(`the ${what} is not an https URL on ${KINETINK_MEDIA_HOST}`);
    return null;
  };
  const packagedArt = art(c.packagedArt, "packaged art");
  const logo = art(c.logo, "logo");
  const featured = art(c.featured, "featured picture");
  const banner = art(c.banner, "banner");
  const ultraRare = readUltraRare(c.ultraRare, errors);

  if (errors.length) return { errors };
  return {
    ok: {
      id,
      name: str(c.name) || id,
      description: str(c.description),
      aspectRatio: str(c.aspectRatio, "1:1"),
      packagedArt,
      ultraRare,
      logo,
      featured,
      banner,
      items,
      enabled: c.enabled === true,
    },
  };
}

/* ================= READING A COLLECTION ================= */

/** The normals, in tier order. */
export const normalsOf = (c: NfdCollection): NfdItem[] =>
  c.items.filter((i) => !i.isUltraRare).sort((a, b) => a.tier - b.tier);

/** The Ultra Rares, in their own tier order. */
export const ultraRaresOf = (c: NfdCollection): NfdItem[] =>
  c.items.filter((i) => i.isUltraRare).sort((a, b) => a.tier - b.tier);

/** The highest tier in the set, which is what a benefit table is sized to. */
export const topTierOf = (c: NfdCollection): number =>
  c.items.reduce((hi, i) => Math.max(hi, i.tier), 0);

/**
 * Which Ultra Rare slot a roll lands in: slot i has chance (1-f) * f^i.
 *
 * The same geometric draw the app's reveal uses. Kept here as well rather
 * than imported from the Rust side because this half runs in a browser, and
 * the two are held together by a test that checks the shares rather than by
 * one of them calling the other.
 */
export function ultraRareSlot(u: number, factor: number, count: number): number {
  if (count <= 1 || factor <= 0) return 0;
  let acc = 0;
  for (let i = 0; i < count - 1; i++) {
    acc += (1 - factor) * Math.pow(factor, i);
    if (u < acc) return i;
  }
  return count - 1;
}
