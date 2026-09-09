-- Per-tier kill counts, kept for ever, per player.
--
-- An array rather than seven columns: the tiers are a list and adding an eighth
-- ship should not be a schema change. Indexed from one to match the tier
-- numbers people will see.

alter table public.rebels_scores
  add column if not exists tier_kills integer[] not null default '{0,0,0,0,0,0,0}';

-- Filing a run now also files what was killed in it.
--
-- The array is added element by element, so two runs finishing at once cannot
-- lose one of them, the same reason best and total are merged rather than set.
create or replace function public.rebels_submit(
  p_name text,
  p_points integer,
  p_tier_kills integer[] default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text := nullif(btrim(p_name), '');
  v_pts  integer := greatest(0, coalesce(p_points, 0));
  v_tk   integer[] := coalesce(p_tier_kills, '{0,0,0,0,0,0,0}');
  i      integer;
begin
  if v_name is null then
    return;
  end if;
  if v_pts > 10000000 then
    v_pts := 10000000;
  end if;
  v_name := left(v_name, 48);

  -- Exactly seven, each of them sane. A client sending a hundred entries or a
  -- negative count does not get to shape the table.
  if array_length(v_tk, 1) is distinct from 7 then
    v_tk := '{0,0,0,0,0,0,0}';
  end if;
  for i in 1..7 loop
    v_tk[i] := least(greatest(coalesce(v_tk[i], 0), 0), 100000);
  end loop;

  insert into public.rebels_scores (name_key, name, best, total, games, tier_kills, updated_at)
  values (lower(v_name), v_name, v_pts, v_pts, 1, v_tk, now())
  on conflict (name_key) do update
    set best = greatest(public.rebels_scores.best, excluded.best),
        total = public.rebels_scores.total + excluded.total,
        games = public.rebels_scores.games + 1,
        tier_kills = (
          select array_agg(coalesce(a, 0) + coalesce(b, 0) order by ord)
          from unnest(public.rebels_scores.tier_kills, excluded.tier_kills)
               with ordinality as t(a, b, ord)
        ),
        name = excluded.name,
        updated_at = now();
end;
$$;

grant execute on function public.rebels_submit(text, integer, integer[]) to anon, authenticated;
