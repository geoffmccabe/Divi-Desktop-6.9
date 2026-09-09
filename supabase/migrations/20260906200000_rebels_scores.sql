-- Divi Rebels leaderboards.
--
-- ONE ROW PER PLAYER. That is the whole shape of it: a player cannot take more
-- than one place on either table however well or however often they play, so a
-- good player takes the top spot and not the top twenty.
--
-- Two numbers per row answer two different questions. `best` is the highest
-- single run, `total` is everything they have ever scored, which anyone can
-- climb by playing a lot rather than by getting lucky once.

create table if not exists public.rebels_scores (
  -- The node's own name when its owner set one, otherwise its address and
  -- country. Lower-cased for the key so the same node cannot appear twice
  -- through a change of capitalisation.
  name_key    text primary key,
  name        text not null,
  best        integer not null default 0,
  total       bigint  not null default 0,
  games       integer not null default 0,
  updated_at  timestamptz not null default now()
);

create index if not exists rebels_scores_best_idx  on public.rebels_scores (best desc);
create index if not exists rebels_scores_total_idx on public.rebels_scores (total desc);

alter table public.rebels_scores enable row level security;

-- Anyone may read the tables: they are leaderboards.
drop policy if exists "rebels scores readable" on public.rebels_scores;
create policy "rebels scores readable" on public.rebels_scores
  for select to anon, authenticated using (true);

-- Nobody writes directly. Every write goes through the function below, so a
-- client cannot simply set its own `best` to a made-up number, and cannot
-- lower anyone else's.
revoke insert, update, delete on public.rebels_scores from anon, authenticated;

-- Filing a finished run.
--
-- security definer so it can write to a table the caller cannot, and it MERGES
-- rather than overwrites: best only ever climbs, total only ever adds. Doing
-- this client-side with a read then a write would lose runs whenever two
-- finished at once.
create or replace function public.rebels_submit(p_name text, p_points integer)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text := nullif(btrim(p_name), '');
  v_pts  integer := greatest(0, coalesce(p_points, 0));
begin
  if v_name is null then
    return;
  end if;
  -- A ceiling, so a broken or hostile client cannot post a number that buries
  -- the table for ever. Well above anything a real run reaches.
  if v_pts > 10000000 then
    v_pts := 10000000;
  end if;
  v_name := left(v_name, 48);

  insert into public.rebels_scores (name_key, name, best, total, games, updated_at)
  values (lower(v_name), v_name, v_pts, v_pts, 1, now())
  on conflict (name_key) do update
    set best = greatest(public.rebels_scores.best, excluded.best),
        total = public.rebels_scores.total + excluded.total,
        games = public.rebels_scores.games + 1,
        name = excluded.name,
        updated_at = now();
end;
$$;

grant execute on function public.rebels_submit(text, integer) to anon, authenticated;
