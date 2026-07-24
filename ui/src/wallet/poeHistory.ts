// Local record of Proof-of-Existence anchors this wallet has created.
//
// The chain stores only a fingerprint, so it can never tell you WHICH file a
// proof was for, what it was called, or what it looked like. That context only
// exists here. Losing it doesn't invalidate a proof (the txid plus the original
// file is always enough) but without it a user has a list of meaningless
// hashes, so this is what makes the feature usable.
//
// Which is exactly why the JSON export at the bottom of this file matters: it
// is the only backup of that context, and it is built to be readable on a
// stranger's machine or a replacement laptop, with no Divi wallet involved.

export interface PoeRecord {
  txid: string;
  hash: string;
  name: string;
  size: number;
  mime: string;
  /** Natural pixel size, images only. */
  width?: number;
  height?: number;
  /** Small JPEG data URL for the history list; absent for non-images. */
  thumb?: string;
  /**
   * Larger preview the user has chosen to make shareable. Unlike `thumb` this
   * travels in the export, so an artist can publish a browsable set of proofs
   * and anyone can check them. Opt-in per item, because the whole point of PoE
   * is that a file need never leave your machine.
   */
  publicThumb?: string;
  /** Group the user files this under, e.g. "Legal docs" or "Family photos". */
  project?: string;
  /** The user's own name for this item, independent of the filename. */
  title?: string;
  /** When this wallet broadcast the anchor. */
  createdAt: number;
  /** Block time once confirmed: this is the value the proof actually rests on. */
  confirmedAt?: number;
}

const KEY = "dd69.poe.history";
// Thumbnails dominate the footprint, and browser storage is a few megabytes in
// total, so keep the list bounded rather than letting it grow without limit.
const MAX_RECORDS = 200;

export function loadPoeHistory(): PoeRecord[] {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || "[]");
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

/**
 * Persist, shedding weight rather than losing proofs.
 *
 * Storage is shared with every other cache in the app, so a full quota becomes
 * a real possibility once a few hundred previews accumulate. This used to try
 * once, drop some thumbnails, try again, then give up SILENTLY. That was the
 * worst outcome available: the txid lives only here, so a dropped record means
 * the user can never find their proof again, even though it sits perfectly safe
 * on the chain. It now escalates through progressively lighter forms and only
 * reports failure if even the bare list will not fit.
 */
function save(list: PoeRecord[]): boolean {
  const capped = list.slice(0, MAX_RECORDS);
  const attempts: Array<() => PoeRecord[]> = [
    () => capped,
    // shed shareable previews beyond the newest few
    () => capped.map((r, i) => (i > 10 ? { ...r, publicThumb: undefined } : r)),
    // then all shareable previews
    () => capped.map((r) => ({ ...r, publicThumb: undefined })),
    // then the small list thumbnails too
    () => capped.map((r) => ({ ...r, publicThumb: undefined, thumb: undefined })),
    // last resort: just the facts that keep a proof findable
    () =>
      capped.map((r) => ({
        txid: r.txid,
        hash: r.hash,
        name: r.name,
        size: r.size,
        mime: r.mime,
        project: r.project,
        title: r.title,
        createdAt: r.createdAt,
        confirmedAt: r.confirmedAt,
      })),
  ];
  for (const build of attempts) {
    try {
      localStorage.setItem(KEY, JSON.stringify(build()));
      return true;
    } catch {
      /* try a lighter form */
    }
  }
  return false;
}

/** Newest first. Replaces any existing entry with the same txid. */
export function addPoeRecord(rec: PoeRecord): boolean {
  const list = loadPoeHistory().filter((r) => r.txid !== rec.txid);
  list.unshift(rec);
  return save(list);
}

export function markPoeConfirmed(txid: string, confirmedAt: number) {
  const list = loadPoeHistory();
  const hit = list.find((r) => r.txid === txid);
  if (!hit || hit.confirmedAt) return;
  hit.confirmedAt = confirmedAt;
  save(list);
}

/** Edit the user's own labelling. Returns false only if storage refused. */
export function updatePoeRecord(txid: string, patch: Partial<PoeRecord>): boolean {
  const list = loadPoeHistory();
  const i = list.findIndex((r) => r.txid === txid);
  if (i < 0) return false;
  list[i] = { ...list[i], ...patch };
  return save(list);
}

export function removePoeRecord(txid: string) {
  save(loadPoeHistory().filter((r) => r.txid !== txid));
}

/** Distinct project names, most-used first, for the picker. */
export function poeProjects(list = loadPoeHistory()): string[] {
  const counts = new Map<string, number>();
  for (const r of list) {
    const p = (r.project || "").trim();
    if (p) counts.set(p, (counts.get(p) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([p]) => p);
}

/**
 * Downscaled JPEG preview. `max` is the longest edge in pixels: the small
 * default feeds the history list, and PUBLIC_THUMB_MAX matches what the
 * Collectibles work uses for a shareable preview. Returns undefined for
 * anything that isn't an image, or if the browser can't decode it.
 */
export async function makeThumb(file: File, max = 220): Promise<string | undefined> {
  if (!file.type.startsWith("image/")) return undefined;
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((res, rej) => {
      const i = new Image();
      i.onload = () => res(i);
      i.onerror = () => rej(new Error("decode failed"));
      i.src = url;
    });
    const scale = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.max(1, Math.round(img.naturalWidth * scale));
    const h = Math.max(1, Math.round(img.naturalHeight * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return undefined;
    ctx.drawImage(img, 0, 0, w, h);
    return canvas.toDataURL("image/jpeg", 0.7);
  } catch {
    return undefined;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Longest edge for a shareable preview, matching the Collectibles convention. */
export const PUBLIC_THUMB_MAX = 500;

// ---------------------------------------------------------------------------
// Export and import
// ---------------------------------------------------------------------------

export const EXPORT_FORMAT = "divi-poe-export";
export const EXPORT_VERSION = 1;

/**
 * Build the export. Deliberately self-describing and self-contained: someone
 * holding only this file, on a machine with no wallet, should be able to see
 * what was proven, when, and how to check it for themselves. Shareable
 * previews are embedded so a set can be browsed offline; the private list
 * thumbnails never travel.
 */
export function buildPoeExport(list = loadPoeHistory(), explorerBase = "https://scan.divi.love/tx/") {
  return {
    format: EXPORT_FORMAT,
    version: EXPORT_VERSION,
    exportedAt: new Date().toISOString(),
    count: list.length,
    hashAlgorithm: "sha256",
    howToVerify: [
      "Each entry records the SHA-256 fingerprint of a file and the Divi transaction that anchored it.",
      "To check one: take the original file, compute its SHA-256, and confirm it equals the sha256 field.",
      "Then open explorerUrl and read the block time. That time is when the file is proven to have existed.",
      "A matching fingerprint plus a confirmed block is the entire proof. No wallet and no permission needed.",
      "publicThumbnail is a preview the owner chose to share. It is not part of the proof.",
    ],
    projects: poeProjects(list),
    records: list.map((r) => ({
      project: r.project || null,
      title: r.title || null,
      sha256: r.hash,
      txid: r.txid,
      explorerUrl: explorerBase + r.txid,
      createdAt: r.createdAt ? new Date(r.createdAt).toISOString() : null,
      provenAt: r.confirmedAt ? new Date(r.confirmedAt * 1000).toISOString() : null,
      confirmed: !!r.confirmedAt,
      file: { name: r.name, size: r.size, mime: r.mime, width: r.width ?? null, height: r.height ?? null },
      publicThumbnail: r.publicThumb || null,
    })),
  };
}

/** Turn an export back into records, for restoring onto a new machine. */
export function parsePoeExport(text: string): { records: PoeRecord[]; error?: string } {
  let v: unknown;
  try {
    v = JSON.parse(text);
  } catch {
    return { records: [], error: "That file isn't valid JSON." };
  }
  const o = v as Record<string, unknown>;
  if (!o || o.format !== EXPORT_FORMAT || !Array.isArray(o.records)) {
    return { records: [], error: "That doesn't look like a Divi proof export." };
  }
  const out: PoeRecord[] = [];
  for (const raw of o.records as Array<Record<string, any>>) {
    const txid = String(raw.txid ?? "");
    const hash = String(raw.sha256 ?? "");
    // Without both of these an entry can't be checked, so it isn't worth keeping.
    if (!/^[0-9a-f]{64}$/i.test(txid) || !/^[0-9a-f]{64}$/i.test(hash)) continue;
    const f = raw.file ?? {};
    const preview = typeof raw.publicThumbnail === "string" ? raw.publicThumbnail : undefined;
    out.push({
      txid: txid.toLowerCase(),
      hash: hash.toLowerCase(),
      name: String(f.name ?? "(unnamed)"),
      size: Number(f.size ?? 0),
      mime: String(f.mime ?? ""),
      width: f.width ?? undefined,
      height: f.height ?? undefined,
      publicThumb: preview,
      // Show something in the list straight away on a restored machine.
      thumb: preview,
      project: raw.project ?? undefined,
      title: raw.title ?? undefined,
      createdAt: raw.createdAt ? Date.parse(raw.createdAt) || Date.now() : Date.now(),
      confirmedAt: raw.provenAt ? Math.floor(Date.parse(raw.provenAt) / 1000) || undefined : undefined,
    });
  }
  if (!out.length) return { records: [], error: "No usable proofs found in that file." };
  return { records: out };
}

/** Merge imported records in, keeping whichever copy knows more. */
export function mergePoeImport(incoming: PoeRecord[]): { added: number; updated: number; saved: boolean } {
  const list = loadPoeHistory();
  const byTxid = new Map(list.map((r) => [r.txid, r]));
  let added = 0;
  let updated = 0;
  for (const r of incoming) {
    const cur = byTxid.get(r.txid);
    if (!cur) {
      byTxid.set(r.txid, r);
      added++;
      continue;
    }
    // An import must never blank out something this machine already knows.
    byTxid.set(r.txid, {
      ...r,
      ...cur,
      project: cur.project || r.project,
      title: cur.title || r.title,
      publicThumb: cur.publicThumb || r.publicThumb,
      thumb: cur.thumb || r.thumb,
      confirmedAt: cur.confirmedAt || r.confirmedAt,
    });
    updated++;
  }
  const merged = [...byTxid.values()].sort(
    (a, b) => (b.confirmedAt ? b.confirmedAt * 1000 : b.createdAt) - (a.confirmedAt ? a.confirmedAt * 1000 : a.createdAt),
  );
  return { added, updated, saved: save(merged) };
}
