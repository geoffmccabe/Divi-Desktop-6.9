-- Divi Desktop 6.9 — skins marketplace.
-- A skin is a named theme (token map: colors, fonts, panel, sounds, icons).
-- Free or priced in DIVI. Security-first: RLS on, public can only read
-- published skins; all writes go through the server (service role), never
-- the anon/authenticated client.

create table if not exists public.skins (
  id           uuid primary key default gen_random_uuid(),
  slug         text unique not null,
  name         text not null,
  description  text,
  author_id    uuid,
  author_name  text,
  is_free      boolean not null default true,
  price_divi   numeric(20,8) not null default 0 check (price_divi >= 0),
  tokens       jsonb not null default '{}'::jsonb,
  preview_url  text,
  published    boolean not null default false,
  downloads    integer not null default 0,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists skins_published_idx on public.skins (published) where published = true;

alter table public.skins enable row level security;

-- Anyone may read published skins; nothing else is exposed to the client.
drop policy if exists "skins public read" on public.skins;
create policy "skins public read" on public.skins
  for select using (published = true);

-- keep updated_at fresh
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists skins_touch on public.skins;
create trigger skins_touch before update on public.skins
  for each row execute function public.touch_updated_at();

-- Seed the free built-in skin. Canonical token values are shipped in the app
-- (theme/skins.ts); this row is the marketplace listing and is filled in by
-- the publish flow later.
insert into public.skins (slug, name, description, author_name, is_free, price_divi, published)
values (
  'divilicious',
  'Divilicious',
  'The default Divi Desktop look — deep indigo, purple glow, frosted glass.',
  'Divi',
  true, 0, true
)
on conflict (slug) do nothing;
