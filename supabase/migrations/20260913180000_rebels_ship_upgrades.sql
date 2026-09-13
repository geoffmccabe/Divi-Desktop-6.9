-- Divi Rebels: upgrades fitted to a ship, and names that are kept.
--
-- Geoff, 2026-Sep-13: right-clicking an item asks "Apply to Ship? (y/n)" and the
-- ship keeps the benefit permanently; ships can be named; ships are independent
-- of users and can be bought and sold later. So the upgrades live ON THE SHIP'S
-- ROW, where a future sale carries them, not on the player's loadout.
--
-- Additive only: a new column with an empty default, a new save function with one
-- more argument, and a fix to the old one so it can no longer wipe a name.

alter table public.rebels_ships
  add column if not exists upgrades jsonb not null default '[]'::jsonb;

-- The save the web version and newer apps call: name and upgrades included.
-- Upgrades only ever get ADDED (a union), so a stale device cannot take one away.
create or replace function public.rebels_ship_save(
  p_owner_key text,
  p_owner_name text,
  p_model text,
  p_tier integer,
  p_name text,
  p_paint jsonb,
  p_upgrades jsonb
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_up jsonb := coalesce(p_upgrades, '[]'::jsonb);
begin
  if p_owner_key is null or length(trim(p_owner_key)) = 0 then
    raise exception 'owner_key required';
  end if;
  if p_model !~ '^space_SM_Ship_[A-Za-z0-9_]{1,60}$' then
    raise exception 'not a ship model: %', p_model;
  end if;
  if jsonb_typeof(v_up) <> 'array' or jsonb_array_length(v_up) > 32 then
    raise exception 'upgrades must be a short array';
  end if;
  if exists (select 1 from jsonb_array_elements(v_up) e
              where jsonb_typeof(e) <> 'string' or (e #>> '{}') !~ '^[a-z]{1,12}[0-9]{0,2}$') then
    raise exception 'not an upgrade key';
  end if;

  select id into v_id
    from public.rebels_ships
   where owner_key = lower(trim(p_owner_key)) and model = p_model
   limit 1;
  if v_id is null then
    insert into public.rebels_ships (owner_key, owner_name, model, tier, name, paint, upgrades)
    values (lower(trim(p_owner_key)), left(coalesce(p_owner_name, ''), 60), p_model,
            greatest(1, least(8, coalesce(p_tier, 1))), left(coalesce(p_name, ''), 40),
            coalesce(p_paint, '{}'::jsonb), v_up)
    returning id into v_id;
  else
    update public.rebels_ships
       set owner_name = left(coalesce(p_owner_name, owner_name), 60),
           tier       = greatest(1, least(8, coalesce(p_tier, tier))),
           name       = left(coalesce(p_name, name), 40),
           paint      = coalesce(p_paint, paint),
           upgrades   = (select coalesce(jsonb_agg(distinct u), '[]'::jsonb)
                           from jsonb_array_elements(upgrades || v_up) as u),
           updated_at = now()
     where id = v_id;
  end if;
  update public.rebels_ships set is_active = false
   where owner_key = lower(trim(p_owner_key)) and is_active and id <> v_id;
  update public.rebels_ships set is_active = true where id = v_id;
  return v_id;
end;
$$;

revoke all on function public.rebels_ship_save(text, text, text, integer, text, jsonb, jsonb) from public;
grant execute on function public.rebels_ship_save(text, text, text, integer, text, jsonb, jsonb) to anon, authenticated;

-- The OLD six-argument save, still called by apps installed before this change.
-- It sends an empty name on every paint change, which would wipe a name set on
-- another device; an empty name now leaves the name alone.
create or replace function public.rebels_ship_save(
  p_owner_key text,
  p_owner_name text,
  p_model text,
  p_tier integer,
  p_name text,
  p_paint jsonb
) returns uuid
language sql
security definer
set search_path = public
as $$
  select public.rebels_ship_save(
    p_owner_key, p_owner_name, p_model, p_tier,
    nullif(p_name, ''),
    p_paint,
    '[]'::jsonb
  );
$$;
