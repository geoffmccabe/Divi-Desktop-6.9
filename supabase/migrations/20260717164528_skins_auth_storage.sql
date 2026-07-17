-- Divi Desktop 6.9 — user-saved skins: auth-gated writes + two storage buckets.
-- A logged-in user (LW-SSO -> Supabase JWT, wired later) may save/update/delete
-- ONLY their own skins and only files under their own uid/ folder. Everyone
-- reads published skins and their assets.

-- Track uploaded asset paths on the skin (for management/cleanup).
alter table public.skins add column if not exists assets jsonb not null default '{}'::jsonb;

-- ── skins row policies ─────────────────────────────────────────────────────
drop policy if exists "skins public read" on public.skins;
drop policy if exists "skins read published or own" on public.skins;
create policy "skins read published or own" on public.skins
  for select using (published = true or author_id = auth.uid());

drop policy if exists "skins insert own" on public.skins;
create policy "skins insert own" on public.skins
  for insert to authenticated
  with check (author_id = auth.uid());

drop policy if exists "skins update own" on public.skins;
create policy "skins update own" on public.skins
  for update to authenticated
  using (author_id = auth.uid())
  with check (author_id = auth.uid());

drop policy if exists "skins delete own" on public.skins;
create policy "skins delete own" on public.skins
  for delete to authenticated
  using (author_id = auth.uid());

-- ── storage buckets: Skin Images (previews/backgrounds) + Skin Icons ───────
insert into storage.buckets (id, name, public)
values ('skin-images', 'skin-images', true),
       ('skin-icons',  'skin-icons',  true)
on conflict (id) do nothing;

-- Public read of skin assets.
drop policy if exists "skin assets read" on storage.objects;
create policy "skin assets read" on storage.objects
  for select using (bucket_id in ('skin-images', 'skin-icons'));

-- A user may only write files under a top-level folder named by their uid.
drop policy if exists "skin assets insert own" on storage.objects;
create policy "skin assets insert own" on storage.objects
  for insert to authenticated
  with check (
    bucket_id in ('skin-images', 'skin-icons')
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "skin assets update own" on storage.objects;
create policy "skin assets update own" on storage.objects
  for update to authenticated
  using (
    bucket_id in ('skin-images', 'skin-icons')
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "skin assets delete own" on storage.objects;
create policy "skin assets delete own" on storage.objects
  for delete to authenticated
  using (
    bucket_id in ('skin-images', 'skin-icons')
    and (storage.foldername(name))[1] = auth.uid()::text
  );
