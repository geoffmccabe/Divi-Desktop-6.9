-- NFD collections: the sets of Divi collectibles that count in the game.
--
-- ONE ROW PER COLLECTION, with two things lifted OUT of the JSON into their
-- own columns: `enabled` and `tiers`. Both for the same reason the games table
-- keeps the card picture in a column, and both earn their place.
--
--   enabled   The gate. Geoff: "only specific NFD collections would be useful
--             in the game and anything else will not show." Readers want
--             `enabled=is.true` to be answered BY THE DATABASE; a flag buried
--             in the JSON means every reader downloads every collection and
--             then throws most of them away.
--
--   tiers     An edition -> tier map, nothing else. This is the ONLY part of a
--             collection the room needs, because the room's job is to work out
--             a player's top owned tier and it is forbidden from asking the
--             player (see docs/DIVI-REBELS-NFD-PLAN.md: the one architectural
--             decision). A forty-item set is about 24 KB of names, blurbs,
--             traits and media URLs; its tier map is about 400 bytes. The room
--             polls, so that is a sixtyfold saving on the one reader that
--             fetches most often, and it is derived on save so it cannot drift
--             from the items it came from.
--
-- So each reader asks for what it needs and nothing else:
--
--   the room        select=id,tiers&enabled=is.true     ~400 bytes a set
--   the NFDs tab    select=id,collection&enabled=is.true   the art and names
--   the admin panel select=*                            including disabled
--
-- The media is NOT stored here. Every picture is an https URL on Kinetink's
-- one media host, checked by ui/src/nfd/nfdCatalog.ts before it is ever saved,
-- which is why these rows are small enough to keep whole.

create table if not exists public.rebels_nfd_collections (
  -- Ours, not Kinetink's: a short stable key an admin types once.
  id          text primary key,
  -- The collection as nfdCatalog.ts reads it, minus `enabled`, which is the
  -- column beside it. The database shape and the program shape do not have to
  -- agree; the seam is two small functions in ui/src/nfd/nfdRemote.ts.
  collection  jsonb not null,
  -- Off until an admin says otherwise. An upload that counted immediately
  -- would be exactly the opposite of the gate this table exists to be.
  enabled     boolean not null default false,
  -- Derived on save from collection->items. Never written by a client.
  tiers       jsonb not null default '{}'::jsonb,
  updated_at  timestamptz not null default now()
);

create index if not exists rebels_nfd_enabled_idx
  on public.rebels_nfd_collections (enabled) where enabled;

alter table public.rebels_nfd_collections enable row level security;

-- Anyone may read them. A collection is public art with public rarities: the
-- Inventory tab draws it, the cockpit needs the tier map, and there is nothing
-- in a row that is not already on chain or on Kinetink's public media host.
-- WHO OWNS WHAT is a different question and is not answered by this table.
drop policy if exists "rebels nfd readable" on public.rebels_nfd_collections;
create policy "rebels nfd readable" on public.rebels_nfd_collections
  for select using (true);

-- Nobody may WRITE directly. The only way in is the functions below. Direct
-- writes being refused by policy is what makes a function the only door
-- rather than merely the tidy one.
revoke insert, update, delete on public.rebels_nfd_collections from anon, authenticated;

-- Save ONE collection.
--
-- The secret is read from public.rebels_admin, which has RLS on and no
-- policies, so nobody can read it through the API. Same mechanism as
-- rebels_drops_save and rebels_game_save, and the SAME row, name 'drops', so
-- the secret already typed into the Drops panel works here with nothing new
-- to configure: one place to set an admin secret, one place to get it wrong.
-- When LW-Auth lands the check moves there and the secret goes, from every one
-- of these at once.
--
-- A save NEVER changes `enabled`. Enabling is a separate, deliberate act with
-- its own function below, so re-uploading a corrected file cannot quietly
-- switch a set on, and cannot switch a live one off either.
create or replace function public.rebels_nfd_save(
  p_secret text, p_id text, p_collection jsonb
)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_secret text;
  v_items  jsonb;
  v_tiers  jsonb;
begin
  select secret into v_secret from public.rebels_admin where name = 'drops';
  if v_secret is null or p_secret is null or p_secret <> v_secret then
    raise exception 'not the admin secret';
  end if;
  if p_id is null or p_id !~ '^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$' then
    raise exception 'bad collection id';
  end if;
  if p_collection is null or jsonb_typeof(p_collection) <> 'object' then
    raise exception 'collection must be an object';
  end if;

  v_items := p_collection -> 'items';
  if v_items is null or jsonb_typeof(v_items) <> 'array' then
    raise exception 'collection must have an items array';
  end if;
  if jsonb_array_length(v_items) = 0 then
    raise exception 'that collection has no items';
  end if;

  -- Bounds the client cannot argue with. The SHAPE, and every media URL, is
  -- checked by ui/src/nfd/nfdCatalog.ts, which both halves share; these only
  -- stop something absurd arriving from something that is not our panel.
  if jsonb_array_length(v_items) > 2000 then
    raise exception 'at most 2000 items in a collection';
  end if;
  if length(p_collection::text) > 2000000 then
    raise exception 'that collection is too big';
  end if;
  if (select count(*) from public.rebels_nfd_collections where id <> p_id) >= 50 then
    raise exception 'at most 50 collections';
  end if;

  -- The tier map, derived here so it cannot disagree with the items it came
  -- from. A missing or unreadable tier reads as 1, the lowest, which is the
  -- safe direction: the failure mode is a benefit not paid, never one
  -- invented. nfdCatalog.ts has already floored every tier at 1 on the way
  -- in, so this is a belt on top of a brace.
  select coalesce(jsonb_object_agg(e.k, e.v), '{}'::jsonb) into v_tiers
  from (
    select (i -> 'edition')::text as k,
           case when jsonb_typeof(i -> 'tier') = 'number'
                then greatest(1, (i ->> 'tier')::numeric)::int
                else 1 end as v
    from jsonb_array_elements(v_items) as i
    where jsonb_typeof(i -> 'edition') = 'number'
  ) as e;

  insert into public.rebels_nfd_collections (id, collection, tiers, updated_at)
  values (p_id, p_collection, v_tiers, now())
  on conflict (id) do update
    set collection = excluded.collection,
        tiers      = excluded.tiers,
        updated_at = now();
end;
$$;

-- Turn one on or off. This is the gate, so it is its own function: the act of
-- saying "this set counts in the game" should be one explicit call that does
-- nothing else, not a field smuggled in with 24 KB of art.
create or replace function public.rebels_nfd_enable(
  p_secret text, p_id text, p_enabled boolean
)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_secret text;
begin
  select secret into v_secret from public.rebels_admin where name = 'drops';
  if v_secret is null or p_secret is null or p_secret <> v_secret then
    raise exception 'not the admin secret';
  end if;
  if p_enabled is null then
    raise exception 'enabled must be true or false';
  end if;
  update public.rebels_nfd_collections
     set enabled = p_enabled, updated_at = now()
   where id = p_id;
  if not found then
    raise exception 'no such collection';
  end if;
end;
$$;

-- And delete one. Nothing here touches anybody's holdings: an NFD lives on the
-- Divi chain, and removing the row only means the game stops recognising the
-- set. That is worth saying out loud, because "delete collection" reads far
-- more frightening than it is.
create or replace function public.rebels_nfd_delete(p_secret text, p_id text)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_secret text;
begin
  select secret into v_secret from public.rebels_admin where name = 'drops';
  if v_secret is null or p_secret is null or p_secret <> v_secret then
    raise exception 'not the admin secret';
  end if;
  delete from public.rebels_nfd_collections where id = p_id;
end;
$$;

grant execute on function public.rebels_nfd_save(text, text, jsonb) to anon, authenticated;
grant execute on function public.rebels_nfd_enable(text, text, boolean) to anon, authenticated;
grant execute on function public.rebels_nfd_delete(text, text) to anon, authenticated;
