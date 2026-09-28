-- Divi Rebels: the enemies Geoff defines in the admin panel.
--
-- ONE ROW PER ENEMY, matching rebels_games. The first version of this was one
-- row holding the whole list, the way rebels_drops does it, and the two tables
-- in the same feature ended up shaped differently - which immediately cost
-- what an inconsistency like that always costs: the other session built its
-- reader against the games shape, reasonably, and would have silently loaded
-- no custom enemies at all. Not a crash. Just Geoff's enemies never appearing.
--
-- Enemies have no pictures in them, so the size argument that forced the games
-- table apart does not apply here and one row would have worked. It is shaped
-- this way for two other reasons:
--
--   CONSISTENCY - two tables in one feature with two shapes is a trap for
--   whoever reads them next, and it caught somebody within the hour.
--   PER-ROW SAVES - editing one enemy writes one row, so two people editing
--   cannot silently overwrite each other's work.
--
-- The built-in enemies are NOT in here - they are in the code (enemyTypes.ts)
-- - so an empty table means the game has exactly the enemies it has today
-- rather than meaning a game with no enemies.

create table if not exists public.rebels_enemies (
  id          text primary key,
  enemy       jsonb not null,
  updated_at  timestamptz not null default now()
);

alter table public.rebels_enemies enable row level security;

-- Anyone may read them: an enemy definition is what a player is about to be
-- shot at by, and the cockpit needs it to draw one.
drop policy if exists "rebels enemies readable" on public.rebels_enemies;
create policy "rebels enemies readable" on public.rebels_enemies
  for select using (true);

-- Nobody may WRITE directly. The only way in is the functions below, which
-- check the shared admin secret.
revoke insert, update, delete on public.rebels_enemies from anon, authenticated;

-- Save ONE enemy. Secret read from public.rebels_admin, which has RLS on and
-- no policies, so nobody can read it through the API - the same mechanism
-- rebels_drops_save uses, reusing the same 'drops' row so there is nothing new
-- to configure. When LW-Auth lands the check moves to that identity.
create or replace function public.rebels_enemy_save(p_secret text, p_id text, p_enemy jsonb)
returns void
language plpgsql security definer set search_path = public as $fn$
declare
  v_secret text;
begin
  select secret into v_secret from public.rebels_admin where name = 'drops';
  if v_secret is null or p_secret is null or p_secret <> v_secret then
    raise exception 'not the admin secret';
  end if;
  if p_id is null or p_id !~ '^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$' then
    raise exception 'bad enemy id';
  end if;
  if p_enemy is null or jsonb_typeof(p_enemy) <> 'object' then
    raise exception 'enemy must be an object';
  end if;
  if length(p_enemy::text) > 20000 then
    raise exception 'that enemy is too big';
  end if;
  if (select count(*) from public.rebels_enemies where id <> p_id) >= 200 then
    raise exception 'at most 200 enemies';
  end if;

  insert into public.rebels_enemies (id, enemy, updated_at)
  values (p_id, p_enemy, now())
  on conflict (id) do update
    set enemy = excluded.enemy, updated_at = now();
end;
$fn$;

create or replace function public.rebels_enemy_delete(p_secret text, p_id text)
returns void
language plpgsql security definer set search_path = public as $fn$
declare
  v_secret text;
begin
  select secret into v_secret from public.rebels_admin where name = 'drops';
  if v_secret is null or p_secret is null or p_secret <> v_secret then
    raise exception 'not the admin secret';
  end if;
  delete from public.rebels_enemies where id = p_id;
end;
$fn$;

grant execute on function public.rebels_enemy_save(text, text, jsonb) to anon, authenticated;
grant execute on function public.rebels_enemy_delete(text, text) to anon, authenticated;

-- ---- SAMPLES, so there is something to look at ----
-- Geoff: "make 2 more sample ones and name them something that sounds like a
-- space fighter game quest."
--
-- ORDINARY ROWS, not built-ins: editable, renameable and deletable from the
-- panel like anything else. ON CONFLICT DO NOTHING, so re-running will not
-- resurrect something deliberately thrown away or overwrite an edit.
--
-- Generated from ui/src/wallet/rebels/sampleContent.ts, which is the readable
-- version with the reasoning in it.

insert into public.rebels_enemies (id, enemy) values ('shrike', $seed${"id":"shrike","name":"Shrike","behaviour":"fighter","colour":16751164,"fireColour":16765562,"shieldMax":55,"resistance":0,"speed":1.9,"fireEvery":1.1,"fireRange":60,"shotSpeed":1.35,"damage":0.6,"worth":1.5}$seed$::jsonb)
  on conflict (id) do nothing;
insert into public.rebels_enemies (id, enemy) values ('warden', $seed${"id":"warden","name":"Warden","behaviour":"fighter","colour":8360872,"fireColour":10477823,"shieldMax":1400,"resistance":0.5,"speed":0.55,"fireEvery":3.4,"fireRange":95,"shotSpeed":0.85,"damage":3,"worth":8}$seed$::jsonb)
  on conflict (id) do nothing;
