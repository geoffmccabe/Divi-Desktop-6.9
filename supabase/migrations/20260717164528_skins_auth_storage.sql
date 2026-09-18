-- Divi Desktop 6.9 — publishable skins: no-login writes + two storage buckets.
-- DD69 deliberately has no account/login system, so this does NOT gate writes
-- behind Supabase Auth. Publishing a skin just records the wallet address the
-- publisher claims as author (author_address) alongside the listing -- no
-- cryptographic proof is required for v1 (publishing moves no money; if
-- impersonation ever becomes a real problem this can be tightened later).
-- Editing/removing a published skin is intentionally NOT supported yet (no
-- update/delete policy below == denied by default) -- that needs a real
-- ownership-proof design and is scoped as future work.
--
-- Everyone reads published skins and their assets. Anyone may insert a new
-- published skin and its asset files.

-- Track uploaded asset paths on the skin (for management/cleanup).
alter table public.skins add column if not exists assets jsonb not null default '{}'::jsonb;

-- The claimed publisher wallet address (no proof -- see header comment).
alter table public.skins add column if not exists author_address text;

-- ── skins row policies ─────────────────────────────────────────────────────
drop policy if exists "skins public read" on public.skins;
drop policy if exists "skins read published or own" on public.skins;
create policy "skins public read" on public.skins
  for select using (published = true);

drop policy if exists "skins insert own" on public.skins;
drop policy if exists "skins insert public" on public.skins;
create policy "skins insert public" on public.skins
  for insert to public
  with check (author_address is not null and length(trim(author_address)) > 0);

-- No update/delete policy: RLS denies both by default until a real
-- ownership-proof mechanism exists (see header comment).
drop policy if exists "skins update own" on public.skins;
drop policy if exists "skins delete own" on public.skins;

-- ── storage buckets: Skin Images (previews/backgrounds) + Skin Icons ───────
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
    'skin-images', 'skin-images', true, 2097152,
    array['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml']
  ),
  (
    'skin-icons', 'skin-icons', true, 2097152,
    array['image/svg+xml']
  )
on conflict (id) do update set
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- Public read of skin assets.
drop policy if exists "skin assets read" on storage.objects;
create policy "skin assets read" on storage.objects
  for select using (bucket_id in ('skin-images', 'skin-icons'));

-- Anyone may upload skin assets (no login system -- see header comment).
drop policy if exists "skin assets insert own" on storage.objects;
drop policy if exists "skin assets insert public" on storage.objects;
create policy "skin assets insert public" on storage.objects
  for insert to public
  with check (bucket_id in ('skin-images', 'skin-icons'));

-- No update/delete policy: same reasoning as the skins table above.
drop policy if exists "skin assets update own" on storage.objects;
drop policy if exists "skin assets delete own" on storage.objects;
