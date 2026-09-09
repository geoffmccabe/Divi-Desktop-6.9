-- Divi Rebels: the player's purchases, saved to their account.
--
-- One row per owner_key (the same key the ships and scores use: the node's
-- name). Points are two counters that only ever go up, so the merge on the
-- client is "take the larger", which cannot lose a purchase whichever copy is
-- older. Owned and purchases are sets, merged by union.
--
-- Written only through rebels_loadout_save, which refuses the obviously wrong.
-- It is the client's word, the same as scores and ships: this is a save, not
-- a proof. Proof is the treasury address and the chain, which is the next job.

create table if not exists public.rebels_loadout (
  owner_key     text primary key,
  owner_name    text not null default '',
  points_earned numeric not null default 0,
  points_spent  numeric not null default 0,
  owned         jsonb not null default '[]'::jsonb,
  purchases     jsonb not null default '[]'::jsonb,
  updated_at    timestamptz not null default now()
);

alter table public.rebels_loadout enable row level security;

drop policy if exists "rebels loadout readable" on public.rebels_loadout;
create policy "rebels loadout readable" on public.rebels_loadout
  for select to anon, authenticated using (true);

create or replace function public.rebels_loadout_save(
  p_owner_key text, p_owner_name text,
  p_points_earned numeric, p_points_spent numeric,
  p_owned jsonb, p_purchases jsonb
) returns void
language plpgsql security definer set search_path = public as $$
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
  -- Bounded, because it is anyone's word and the table should not become a
  -- place to park a megabyte.
  if length(p_owned::text) > 4000 or length(p_purchases::text) > 20000 then
    raise exception 'too much';
  end if;

  insert into public.rebels_loadout (owner_key, owner_name, points_earned, points_spent, owned, purchases)
  values (lower(trim(p_owner_key)), left(coalesce(p_owner_name, ''), 60),
          p_points_earned, p_points_spent, coalesce(p_owned, '[]'::jsonb), coalesce(p_purchases, '[]'::jsonb))
  on conflict (owner_key) do update
     set owner_name    = left(coalesce(excluded.owner_name, rebels_loadout.owner_name), 60),
         -- Counters only rise. A stale client cannot wind a balance back.
         points_earned = greatest(rebels_loadout.points_earned, excluded.points_earned),
         points_spent  = greatest(rebels_loadout.points_spent, excluded.points_spent),
         -- Sets only grow.
         owned = (select coalesce(jsonb_agg(distinct v), '[]'::jsonb)
                    from jsonb_array_elements(rebels_loadout.owned || excluded.owned) as v),
         purchases = (select coalesce(jsonb_agg(v), '[]'::jsonb) from (
                        select distinct on (v->>'txid') v
                          from jsonb_array_elements(rebels_loadout.purchases || excluded.purchases) as v
                         order by v->>'txid') s),
         updated_at = now();
end;
$$;

grant execute on function public.rebels_loadout_save(text, text, numeric, numeric, jsonb, jsonb) to anon, authenticated;
