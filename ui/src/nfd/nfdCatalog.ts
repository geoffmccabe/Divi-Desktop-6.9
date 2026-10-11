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

/* ================= WHAT A SET IS ON THE CHAIN ================= */

/** Duffs in one DIVI. The chain counts in duffs; people talk in DIVI. */
export const DUFFS_PER_DIVI = 100_000_000;

/** `max_supply` is a u32 on the wire, so this is the largest cap that fits. */
export const MAX_SUPPLY_LIMIT = 4_294_967_295;

/**
 * What a collection will be, or already is, on the Divi chain.
 *
 * Here because there is nowhere else to write it down, and because every one
 * of these is a decision that cannot be taken back once the set is launched.
 * Read out of the NORMATIVE protocol copy,
 * /Users/geoffreymccabe/Divi-Blockchain_6.9/contrib/nfd-indexer/src/lib.rs
 * (2026-Oct-10), not the vendored copy in this repo, which is a protocol
 * generation behind and knows none of it.
 */
export interface NfdLaunchPlan {
  /**
   * The address that sends the create transaction.
   *
   * ⚠ PERMANENT. It is written once at creation and no operation moves it. It
   * is the only address that can mint into the set, lower the commission or
   * change the forge fee, so whatever mints must hold its key for the life of
   * the set.
   */
  creator: string | null;
  /** Where the resale commission is paid. It need not be the creator. */
  payout: string | null;
  /**
   * The resale commission, which is the royalty: a FLAT amount in duffs, not
   * a percentage. There is nowhere on the Divi side to put a percentage.
   *
   * ⚠ DOWN-ONLY on chain, and there is no operation that unsets it. It is
   * enforced on every transfer as well as on a marketplace buy, so a transfer
   * that does not pay it is not a valid transfer.
   */
  commissionDuffs: number | null;
  /**
   * The hard bound on how many pieces can ever exist. Written into the create
   * transaction and unchangeable afterwards.
   *
   * ⚠ NULL HERE MEANS NO BOUND, because on chain `max_supply` of 0 means no
   * bound. A cap is the one backstop that still holds if a public mint price
   * is ever set, since that door cannot be closed again.
   */
  maxSupply: number | null;
}

/** A plan with nothing decided yet. */
export const blankLaunchPlan = (): NfdLaunchPlan =>
  ({ creator: null, payout: null, commissionDuffs: null, maxSupply: null });

const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{26,35}$/;

/**
 * Does this look like a Divi address?
 *
 * SHAPE ONLY: base58 characters and a plausible length. The real check is the
 * checksum, which needs SHA-256 and is therefore asynchronous in a browser
 * (isDiviAddress in ui/src/web-rebels/diviAddress.ts does it, and the admin
 * panel runs it before saving), while this file is synchronous on purpose. A
 * shape check still catches what matters here: a pasted URL, a truncated
 * address, and the 0/O/I/l characters base58 does not use.
 */
export const looksLikeDiviAddress = (v: unknown): string | null =>
  typeof v === "string" && BASE58.test(v.trim()) ? v.trim() : null;

/**
 * DIVI as a person types it, in duffs.
 *
 * Parsed as TEXT rather than multiplied through a float: 0.07 DIVI through
 * `Number("0.07") * 1e8` is 7000000.000000001, and 0.29 lands BELOW the true
 * amount at 28999999.999999996, which a floor turns into a missing duff. A
 * royalty is a number the chain then holds for ever at an amount that can
 * never be raised. Null for anything that is not a plain amount.
 */
export function diviToDuffs(text: string): number | null {
  const m = /^\s*(\d{1,12})(?:\.(\d{1,8}))?\s*$/.exec(text);
  if (!m) return null;
  const duffs = Number(m[1]) * DUFFS_PER_DIVI + Number((m[2] ?? "0").padEnd(8, "0"));
  return Number.isSafeInteger(duffs) ? duffs : null;
}

/** Duffs back to DIVI for display, with no trailing zeroes. */
export function duffsToDivi(duffs: number): string {
  const whole = Math.floor(duffs / DUFFS_PER_DIVI);
  const frac = String(duffs % DUFFS_PER_DIVI).padStart(8, "0").replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : String(whole);
}

/**
 * A stored launch plan, checked.
 *
 * SOFT, like the chain id and for the same reason: a row with a malformed
 * address is still a perfectly good catalog of pictures, and refusing the
 * whole set over it would hide the art as well as the address. Anything
 * unreadable reads as "not decided yet", which is what it means. Zero reads as
 * not decided too, for both numbers, because zero duffs is no royalty and a
 * zero cap is no cap. The panel refuses bad input before it can be saved.
 */
export function readLaunchPlan(raw: unknown): NfdLaunchPlan {
  const p = (raw ?? {}) as Record<string, unknown>;
  const count = (v: unknown, max: number): number | null => {
    if (typeof v !== "number" || !Number.isFinite(v)) return null;
    const n = Math.floor(v);
    return n > 0 && n <= max ? n : null;
  };
  return {
    creator: looksLikeDiviAddress(p.creator),
    payout: looksLikeDiviAddress(p.payout),
    commissionDuffs: count(p.commissionDuffs, Number.MAX_SAFE_INTEGER),
    maxSupply: count(p.maxSupply, MAX_SUPPLY_LIMIT),
  };
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
  /**
   * The on-chain collection id (64 hex), once the set has been launched on
   * Divi, else null.
   *
   * ⚠ THIS IS THE ONLY THING TYING A HOLDING TO A SET. The chain says an
   * address holds a collectible of collection `<hash>`; this file says that
   * hash is this set. Without it, ownership cannot be matched and nothing
   * shows, which is the correct way to be wrong: see ownedByCollection in
   * nfdOwned.ts. A launch file cannot carry it, because the file is written
   * before the launch; it is recorded afterwards.
   */
  chainId: string | null;
  /**
   * What this set will be, or already is, on the Divi chain: who launched it,
   * where its royalties go, what the royalty is and what it is capped at.
   *
   * Separate from `chainId` because the id is a fact about a set that exists
   * and these are decisions taken before it does. All of them are typed by an
   * admin; none can come from a launch file.
   */
  launch: NfdLaunchPlan;
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

/**
 * An on-chain collection id, or null.
 *
 * Checked rather than taken, and not pushed onto `errors`: a row whose chain
 * id is malformed is still a perfectly good catalog of pictures, and refusing
 * to read the whole set because of it would hide the art as well as the
 * ownership. A bad one reads as "not launched yet", which is what it means.
 */
const chainId = (v: unknown): string | null =>
  typeof v === "string" && /^[0-9a-f]{64}$/i.test(v) ? v.toLowerCase() : null;

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
      /* A launch file is exported BEFORE the set exists on chain, so it can
         never carry the chain id. It is recorded against the row afterwards. */
      chainId: null,
      /* Nor can it carry any of the launch decisions. Kinetink's export has a
         royalty PERCENTAGE and Divi has nowhere to put a percentage, so even
         that one is not carried across: it is decided in the panel. */
      launch: blankLaunchPlan(),
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
      chainId: chainId(c.chainId),
      launch: readLaunchPlan(c.launch),
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
/**
 * The chance of landing in each Ultra Rare slot, as a "one in N".
 *
 * ⚠ THE LAST SLOT IS NOT (1-f)·f^i. It gets the whole remainder, f^(count-1),
 * because ultraRareSlot falls through to it. The difference is not academic:
 * on this set's config the tenth slot is 1 in 195,312,500 rather than the
 * 1 in 244,140,625 the simple formula gives, and a test that restated the
 * formula instead of sampling the function would never have caught it.
 */
export function ultraRareOdds(
  u: NfdUltraRareRoll | null,
): Array<{ slot: number; share: number; oneIn: number }> {
  if (!u || u.count <= 0) return [];
  const f = u.progressiveFactor;
  const rows: Array<{ slot: number; share: number; oneIn: number }> = [];
  for (let i = 0; i < u.count; i++) {
    const share = i === u.count - 1 ? Math.pow(f, i) : (1 - f) * Math.pow(f, i);
    const p = u.basicChance * share;
    rows.push({ slot: i + 1, share, oneIn: p > 0 ? Math.round(1 / p) : Infinity });
  }
  return rows;
}

/**
 * A collection's card shape, as CSS wants it.
 *
 * Kinetink writes "5:7"; CSS wants "5 / 7". Anything unreadable falls back to
 * a square, which is wrong for no set rather than badly wrong for one.
 */
export function cssAspect(raw: string): string {
  const m = /^\s*(\d+(?:\.\d+)?)\s*[:/]\s*(\d+(?:\.\d+)?)\s*$/.exec(raw);
  if (!m || Number(m[1]) <= 0 || Number(m[2]) <= 0) return "1 / 1";
  return `${m[1]} / ${m[2]}`;
}

export function ultraRareSlot(u: number, factor: number, count: number): number {
  if (count <= 1 || factor <= 0) return 0;
  let acc = 0;
  for (let i = 0; i < count - 1; i++) {
    acc += (1 - factor) * Math.pow(factor, i);
    if (u < acc) return i;
  }
  return count - 1;
}
