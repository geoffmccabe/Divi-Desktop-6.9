// Publish a locally-saved skin to the shared gallery database. Plain fetch
// calls to Supabase's REST endpoints (PostgREST + Storage) — no client
// library, matching the style already used in ../../wallet/identityService.ts.
//
// DD69 has no login system, so there is nothing to authenticate here: the
// insert is allowed by RLS as long as author_address is non-empty (see
// supabase/migrations/20260717164528_skins_auth_storage.sql). The wallet's
// own address is what makes a publish "yours" — there is no separate account.
import type { Theme } from "../store";
import { SUPABASE_URL, supabaseHeaders } from "./supabase";

export interface PublishSkinInput {
  name: string;
  description: string;
  tokens: Theme;
  isFree: boolean;
  priceDivi: number;
  authorAddress: string;
  authorName?: string | null;
  previewFile?: File | null;
}

export interface PublishedSkin {
  id: string;
  slug: string;
  name: string;
  preview_url: string | null;
}

function slugify(name: string): string {
  const base = name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  const suffix = Math.random().toString(36).slice(2, 8);
  return `${base || "skin"}-${suffix}`;
}

function extFromFile(file: File): string {
  const fromName = /\.([a-z0-9]+)$/i.exec(file.name)?.[1];
  if (fromName) return fromName.toLowerCase();
  if (file.type === "image/png") return "png";
  if (file.type === "image/webp") return "webp";
  if (file.type === "image/svg+xml") return "svg";
  return "jpg";
}

async function uploadAsset(bucket: "skin-images" | "skin-icons", path: string, file: File): Promise<string> {
  const res = await fetch(`${SUPABASE_URL}/storage/v1/object/${bucket}/${path}`, {
    method: "POST",
    headers: supabaseHeaders({ "Content-Type": file.type || "application/octet-stream" }),
    body: file,
  });
  if (!res.ok) {
    throw new Error(`Couldn't upload the preview image (${res.status})`);
  }
  return `${SUPABASE_URL}/storage/v1/object/public/${bucket}/${path}`;
}

export async function publishSkin(input: PublishSkinInput): Promise<PublishedSkin> {
  const name = input.name.trim();
  if (!name) throw new Error("Give the skin a name first.");
  if (!input.authorAddress) throw new Error("No wallet address available to publish under.");
  const priceDivi = input.isFree ? 0 : input.priceDivi;
  if (!input.isFree && (!Number.isFinite(priceDivi) || priceDivi <= 0)) {
    throw new Error("Set a price in DIVI, or mark the skin free.");
  }

  const slug = slugify(name);

  let previewUrl: string | null = null;
  if (input.previewFile) {
    previewUrl = await uploadAsset("skin-images", `${slug}/preview.${extFromFile(input.previewFile)}`, input.previewFile);
  }

  const row = {
    slug,
    name,
    description: input.description.trim() || null,
    author_address: input.authorAddress,
    author_name: input.authorName?.trim() || null,
    is_free: input.isFree,
    price_divi: priceDivi,
    tokens: input.tokens,
    preview_url: previewUrl,
    published: true,
  };

  const res = await fetch(`${SUPABASE_URL}/rest/v1/skins`, {
    method: "POST",
    headers: supabaseHeaders({
      "Content-Type": "application/json",
      Prefer: "return=representation",
    }),
    body: JSON.stringify(row),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Publish failed (${res.status})${detail ? `: ${detail.slice(0, 200)}` : ""}`);
  }
  const [saved] = (await res.json()) as PublishedSkin[];
  return saved;
}
