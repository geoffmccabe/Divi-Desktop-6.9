-- Divi Rebels: the ships a player owns.
--
-- WHY THIS IS A TABLE OF SHIPS AND NOT A COLUMN OF SETTINGS
-- --------------------------------------------------------
-- Today every player has one hull and one colour scheme, and a single row of
-- preferences would hold that perfectly well. It would also have to be thrown
-- away the moment anyone owns two, and throwing a table away is much harder
-- once there is live data in it. Geoff asked for the framework now: multiple
-- ships, individual names, and the ability to list one for sale later.
--
-- So a ship is a THING with an owner, not a setting on a player. One row per
-- hull. The marketplace columns are here and unused: the point of writing them
-- now is that the day a marketplace is built, nobody has to migrate anybody's
-- fleet to add them.
--
-- Nothing here builds a marketplace. `for_sale`, `price_divi`, `listed_at`,
-- `sold_to` and `sold_at` are a shape to grow into.

create table if not exists public.rebels_ships (
  id          uuid primary key default gen_random_uuid(),

  -- The node that owns it, keyed exactly as the leaderboard keys a player, so
  -- a fleet and a score belong to the same identity without a join table.
  owner_key   text not null,
  owner_name  text not null default '',

  -- Which hull. A model id from the Synty space pack, e.g.
  -- "space_SM_Ship_Fighter_01". Not a foreign key: the catalogue is code, and
  -- a row that outlives a model should keep its name rather than vanish.
  model       text not null,
  -- 1..8 within its class. Kept alongside the model because a marketplace
  -- listing wants to sort and filter on it without knowing the catalogue.
  tier        integer not null default 1,

  -- What the OWNER calls it. Empty means "call it whatever the class is".
  name        text not null default '',

  -- The five-part colour scheme, exactly as the game holds it: hue, saturation
  -- and brightness for hull1, hull2, accent, highlight and engine. jsonb rather
  -- than fifteen columns because it is one thing that changes as one thing, and
  -- because a sixth part tomorrow should not be a migration.
  paint       jsonb not null default '{}'::jsonb,

  -- Exactly one ship per owner is the one they are flying.
  is_active   boolean not null default false,

  acquired_at timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  -- ---- the marketplace, for later ----
  for_sale    boolean not null default false,
  price_divi  numeric(20, 8),
  listed_at   timestamptz,
  sold_to     text,
  sold_at     timestamptz
);

create index if not exists rebels_ships_owner_idx on public.rebels_ships (owner_key);
-- Listings are the query a marketplace makes, so it is indexed from the start.
create index if not exists rebels_ships_sale_idx
  on public.rebels_ships (for_sale, price_divi) where for_sale;

-- One active ship per owner, enforced rather than trusted: two active hulls is
-- a state with no correct answer, and the cheapest place to make it impossible
-- is here.
create unique index if not exists rebels_ships_one_active
  on public.rebels_ships (owner_key) where is_active;

alter table public.rebels_ships enable row level security;

-- Readable, because a marketplace and a "what is that player flying" panel both
-- need to read somebody else's ship. There is nothing private in a paint job.
drop policy if exists "rebels ships readable" on public.rebels_ships;
create policy "rebels ships readable" on public.rebels_ships
  for select using (true);

-- And NOT writable. Every write goes through the function below, for the same
-- reason the leaderboard does: a table anyone can write is a table anyone can
-- fill with other people's ships.
drop policy if exists "rebels ships no direct writes" on public.rebels_ships;

-- Save a ship, and make it the active one.
--
-- Security definer, so it can write a table the caller cannot. It is the only
-- door in, which means every rule about what a ship may be lives in one place
-- rather than being re-checked by every client that ever writes one.
create or replace function public.rebels_ship_save(
  p_owner_key text,
  p_owner_name text,
  p_model text,
  p_tier integer,
  p_name text,
  p_paint jsonb
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  -- Refuse the obviously wrong rather than storing it. A key that is empty or
  -- absurd is a bug at the caller, and letting it in makes the table a place
  -- where bugs accumulate.
  if p_owner_key is null or length(trim(p_owner_key)) = 0 then
    raise exception 'owner_key required';
  end if;
  if p_model !~ '^space_SM_Ship_[A-Za-z0-9_]{1,60}$' then
    raise exception 'not a ship model: %', p_model;
  end if;

  -- One hull per owner per model, for now. When a player can own two of the
  -- same class they will differ by name, and this becomes an insert.
  select id into v_id
    from public.rebels_ships
   where owner_key = lower(trim(p_owner_key)) and model = p_model
   limit 1;

  if v_id is null then
    insert into public.rebels_ships (owner_key, owner_name, model, tier, name, paint)
    values (lower(trim(p_owner_key)), left(coalesce(p_owner_name, ''), 60), p_model,
            greatest(1, least(8, coalesce(p_tier, 1))), left(coalesce(p_name, ''), 40),
            coalesce(p_paint, '{}'::jsonb))
    returning id into v_id;
  else
    update public.rebels_ships
       set owner_name = left(coalesce(p_owner_name, owner_name), 60),
           tier       = greatest(1, least(8, coalesce(p_tier, tier))),
           name       = left(coalesce(p_name, name), 40),
           paint      = coalesce(p_paint, paint),
           updated_at = now()
     where id = v_id;
  end if;

  -- Exactly one active. Cleared first, because the unique index means setting
  -- the new one while the old is still active would be refused.
  update public.rebels_ships set is_active = false
   where owner_key = lower(trim(p_owner_key)) and is_active and id <> v_id;
  update public.rebels_ships set is_active = true where id = v_id;

  return v_id;
end;
$$;

revoke all on function public.rebels_ship_save(text, text, text, integer, text, jsonb) from public;
grant execute on function public.rebels_ship_save(text, text, text, integer, text, jsonb) to anon, authenticated;
