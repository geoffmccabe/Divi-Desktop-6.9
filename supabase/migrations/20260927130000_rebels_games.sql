-- Divi Rebels: the game types Geoff builds in the admin panel.
--
-- ONE ROW PER GAME, and the card picture in its OWN COLUMN. That is different
-- from rebels_drops and rebels_enemies, which each keep everything in one JSON
-- row, and the difference is the picture.
--
-- A card is capped at 82,000 characters. Twenty games is 1.64 MB, and there is
-- no cap on the number of games. In a single row that 1.64 MB is fetched IN
-- FULL by every room every ten minutes, by every browser drawing the game
-- picker, and by the admin panel on every edit - because the smallest thing
-- you can fetch from one row is all of it.
--
-- Split, each reader asks for what it needs and nothing else:
--
--   the room        select=game             never downloads a picture at all
--   the card picker select=id,name,image    pictures without round lists
--   the admin panel select=*                the lot, one game at a time
--
-- It also makes a save cheaper: editing one game writes one row instead of
-- rewriting every game, which matters when two people are editing.
--
-- Found by the payouts session working out the arithmetic while building the
-- room's reader, before either shape had been applied - so this cost a
-- rewrite of an unapplied file rather than a migration and a backfill.

create table if not exists public.rebels_games (
  id          text primary key,
  -- Everything except the picture. The panel and the picker put `image` back
  -- onto the object; the database shape and the program shape do not have to
  -- agree, and the seam is two lines in gameTypesRemote.ts.
  game        jsonb not null,
  image       text,
  updated_at  timestamptz not null default now()
);

alter table public.rebels_games enable row level security;

-- Anyone may read them: a game type is what a player is choosing between in
-- the picker, and the cockpit needs it to draw the card.
drop policy if exists "rebels games readable" on public.rebels_games;
create policy "rebels games readable" on public.rebels_games
  for select using (true);

-- Nobody may WRITE directly. The only way in is the functions below, which
-- check the shared admin secret. Direct writes being refused by policy is what
-- makes a function the only door rather than merely the tidy one.
revoke insert, update, delete on public.rebels_games from anon, authenticated;

-- Save ONE game.
--
-- The secret is read from public.rebels_admin, which has RLS on and no
-- policies, so nobody can read it through the API. That is the mechanism
-- rebels_drops_save already uses, deliberately copied rather than a second one
-- invented: one place to set an admin secret, one place to get it wrong. It
-- reuses the SAME row, name 'drops', so the secret already typed into the
-- Drops panel works here with nothing new to configure.
--
-- When LW-Auth lands and there is a real identity to check, the check moves
-- there and the secret goes - from every one of these at once.
create or replace function public.rebels_game_save(
  p_secret text, p_id text, p_game jsonb, p_image text
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
  if p_id is null or p_id !~ '^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$' then
    raise exception 'bad game id';
  end if;
  if p_game is null or jsonb_typeof(p_game) <> 'object' then
    raise exception 'game must be an object';
  end if;
  -- Bounds the client cannot argue with. The SHAPE is checked by the validator
  -- both halves share (gameTypes.ts); these only stop something absurd
  -- arriving from something that is not our panel.
  if length(p_game::text) > 200000 then
    raise exception 'that game is too big';
  end if;
  if p_image is not null and length(p_image) > 82000 then
    raise exception 'that card picture is too big';
  end if;
  if (select count(*) from public.rebels_games where id <> p_id) >= 100 then
    raise exception 'at most 100 games';
  end if;

  insert into public.rebels_games (id, game, image, updated_at)
  values (p_id, p_game, p_image, now())
  on conflict (id) do update
    set game = excluded.game, image = excluded.image, updated_at = now();
end;
$$;

-- And delete one, which a single-row design got for free and this does not.
create or replace function public.rebels_game_delete(p_secret text, p_id text)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_secret text;
begin
  select secret into v_secret from public.rebels_admin where name = 'drops';
  if v_secret is null or p_secret is null or p_secret <> v_secret then
    raise exception 'not the admin secret';
  end if;
  delete from public.rebels_games where id = p_id;
end;
$$;

grant execute on function public.rebels_game_save(text, text, jsonb, text) to anon, authenticated;
grant execute on function public.rebels_game_delete(text, text) to anon, authenticated;

-- ---- SAMPLES, so there is something to look at ----
-- Geoff: "you can make 2 more sample ones and name them something that sounds
-- like a space fighter game quest. Make a nice progression... so that helps us
-- test the database and then I can change them or delete them or whatever."
--
-- ORDINARY ROWS, not built-ins, which is the point of seeding them here
-- rather than putting them in the code: they can be edited, renamed or
-- deleted from the panel like anything else. ON CONFLICT DO NOTHING, so
-- re-running this migration will not resurrect something deliberately thrown
-- away or overwrite an edit.
--
-- Generated from ui/src/wallet/rebels/sampleContent.ts, which is the readable
-- version with the reasoning in it. sampleContent.test.ts checks they are a
-- real progression rather than merely valid.

insert into public.rebels_games (id, game, image) values ('shakedown', $seed${"id":"shakedown","name":"Shakedown","place":"earth","crew":"multiplayer","published":true,"rounds":[{"seconds":90,"spawns":[{"enemy":"fighters","count":6,"arrive":"spread","bias":[0.5,0.8]}]},{"seconds":90,"spawns":[{"enemy":"fighters","count":8,"arrive":"spread","bias":[0.5,1]}]},{"seconds":90,"spawns":[{"enemy":"fighters","count":10,"arrive":"spread","bias":[0.6,1.4]}],"award":{"divi":5}},{"seconds":90,"spawns":[{"enemy":"fighters","count":10,"arrive":"spread","bias":[0.6,1.4]},{"enemy":"shrike","count":2,"arrive":"once"}]},{"seconds":120,"spawns":[{"enemy":"fighters","count":12,"arrive":"spread","bias":[0.8,1.8]},{"enemy":"shrike","count":4,"arrive":"spread"}],"award":{"divi":10}}],"award":{"divi":25}}$seed$::jsonb, null)
  on conflict (id) do nothing;
insert into public.rebels_games (id, game, image) values ('descent', $seed${"id":"descent","name":"Descent","place":"spike","crew":"multiplayer","published":true,"rounds":[{"seconds":120,"spawns":[{"enemy":"fighters","count":14,"arrive":"spread","bias":[1,2]}]},{"seconds":120,"spawns":[{"enemy":"fighters","count":16,"arrive":"spread","bias":[1.2,2.4]},{"enemy":"shrike","count":6,"arrive":"spread"}]},{"seconds":120,"spawns":[{"enemy":"fighters","count":14,"arrive":"spread","bias":[1.2,2.4]},{"enemy":"drone3","count":18,"arrive":"clumps"}],"award":{"divi":15}},{"seconds":120,"spawns":[{"enemy":"fighters","count":18,"arrive":"spread","bias":[1.5,3]},{"enemy":"shrike","count":8,"arrive":"spread"}]},{"seconds":150,"spawns":[{"enemy":"warden","count":1,"arrive":"once"},{"enemy":"fighters","count":10,"arrive":"spread","bias":[1,2]}],"award":{"divi":30}},{"seconds":150,"spawns":[{"enemy":"fighters","count":20,"arrive":"spread","bias":[2,3.5]},{"enemy":"drone5","count":24,"arrive":"clumps"}]},{"seconds":150,"spawns":[{"enemy":"warden","count":1,"arrive":"once"},{"enemy":"shrike","count":10,"arrive":"spread"}],"award":{"divi":40}},{"seconds":180,"spawns":[{"enemy":"warden","count":2,"arrive":"once"},{"enemy":"fighters","count":22,"arrive":"spread","bias":[2.5,4]}],"award":{"divi":60}}],"award":{"divi":150}}$seed$::jsonb, null)
  on conflict (id) do nothing;
