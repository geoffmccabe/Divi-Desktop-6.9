-- Divi Rebels: found items on the account, and the drop charts.
--
-- ITEMS. One more column on rebels_loadout: what the player holds, stacked by
-- catalogue key ({"hull2": 3}). Merged by the larger count per key, the same
-- rule as the points counters: a stale client cannot take a thing away. It is
-- the client's word, as the rest of the row is; the room banks its own count
-- of room pickups to the ledger, so the two can be compared.
--
-- DROP CHARTS. One row, id 'live', holding the whole config as JSON: charts
-- (item keys with weights) and rules (which enemies use which chart, and the
-- chance per tier). Read by every wallet and by the room; written only through
-- rebels_drops_save, which checks a secret held in a table nobody can read.
-- Geoff: the secret is a file on the Mac, typed once into the admin panel.

alter table public.rebels_loadout
  add column if not exists items jsonb not null default '{}'::jsonb;

drop function if exists public.rebels_loadout_save(text, text, numeric, numeric, jsonb, jsonb);

create or replace function public.rebels_loadout_save(
  p_owner_key text, p_owner_name text,
  p_points_earned numeric, p_points_spent numeric,
  p_owned jsonb, p_purchases jsonb, p_items jsonb default '{}'::jsonb
) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_items jsonb := coalesce(p_items, '{}'::jsonb);
begin
  if p_owner_key is null or length(trim(p_owner_key)) = 0 then
    raise exception 'owner_key required';
  end if;
  if p_points_earned is null or p_points_earned < 0 or p_points_spent is null or p_points_spent < 0 then
    raise exception 'points cannot be negative';
  end if;
  if jsonb_typeof(coalesce(p_owned, '[]'::jsonb)) <> 'array'
     or jsonb_typeof(coalesce(p_purchases, '[]'::jsonb)) <> 'array' then
    raise exception 'owned and purchases must be arrays';
  end if;
  if jsonb_typeof(v_items) <> 'object' then
    raise exception 'items must be an object';
  end if;
  if length(p_owned::text) > 4000 or length(p_purchases::text) > 20000 or length(v_items::text) > 8000 then
    raise exception 'too much';
  end if;

  insert into public.rebels_loadout (owner_key, owner_name, points_earned, points_spent, owned, purchases, items)
  values (lower(trim(p_owner_key)), left(coalesce(p_owner_name, ''), 60),
          p_points_earned, p_points_spent, coalesce(p_owned, '[]'::jsonb), coalesce(p_purchases, '[]'::jsonb), v_items)
  on conflict (owner_key) do update
     set owner_name    = left(coalesce(excluded.owner_name, rebels_loadout.owner_name), 60),
         points_earned = greatest(rebels_loadout.points_earned, excluded.points_earned),
         points_spent  = greatest(rebels_loadout.points_spent, excluded.points_spent),
         owned = (select coalesce(jsonb_agg(distinct v), '[]'::jsonb)
                    from jsonb_array_elements(rebels_loadout.owned || excluded.owned) as v),
         purchases = (select coalesce(jsonb_agg(v), '[]'::jsonb) from (
                        select distinct on (v->>'txid') v
                          from jsonb_array_elements(rebels_loadout.purchases || excluded.purchases) as v
                         order by v->>'txid') s),
         -- Per key, the larger count. Keys only ever appear; counts only rise.
         items = (select coalesce(jsonb_object_agg(k, greatest(
                     coalesce((rebels_loadout.items->>k)::numeric, 0),
                     coalesce((excluded.items->>k)::numeric, 0))), '{}'::jsonb)
                    from (select jsonb_object_keys(rebels_loadout.items || excluded.items) as k) ks),
         updated_at = now();
end;
$$;

grant execute on function public.rebels_loadout_save(text, text, numeric, numeric, jsonb, jsonb, jsonb) to anon, authenticated;

-- ---- drop charts ----

create table if not exists public.rebels_drops (
  id         text primary key,
  config     jsonb not null,
  updated_at timestamptz not null default now()
);
alter table public.rebels_drops enable row level security;
drop policy if exists "rebels drops readable" on public.rebels_drops;
create policy "rebels drops readable" on public.rebels_drops
  for select to anon, authenticated using (true);

-- The admin secret. RLS on, no policies: nobody reads it through the API.
-- Set it once with the management API (see docs/DIVI-REBELS-ITEMS-PLAN.md):
--   insert into public.rebels_admin (name, secret) values ('drops', '<secret>');
create table if not exists public.rebels_admin (
  name   text primary key,
  secret text not null
);
alter table public.rebels_admin enable row level security;

create or replace function public.rebels_drops_save(p_secret text, p_config jsonb)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_secret text;
begin
  select secret into v_secret from public.rebels_admin where name = 'drops';
  if v_secret is null or p_secret is null or p_secret <> v_secret then
    raise exception 'not the admin secret';
  end if;
  if p_config is null or jsonb_typeof(p_config) <> 'object'
     or jsonb_typeof(p_config->'charts') <> 'array' or jsonb_typeof(p_config->'rules') <> 'array' then
    raise exception 'config must have charts and rules';
  end if;
  if length(p_config::text) > 100000 then
    raise exception 'too much';
  end if;
  insert into public.rebels_drops (id, config) values ('live', p_config)
  on conflict (id) do update set config = excluded.config, updated_at = now();
end;
$$;
grant execute on function public.rebels_drops_save(text, jsonb) to anon, authenticated;
