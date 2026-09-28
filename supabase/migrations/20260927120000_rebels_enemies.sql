-- Divi Rebels: the enemies Geoff defines in the admin panel.
--
-- ONE ROW, id 'live', holding the whole list as JSON. Exactly the shape
-- rebels_drops already uses, and for the same reasons: the list is read whole
-- and written whole, it is small, and a row per enemy would buy nothing but
-- joins. The built-in enemies are NOT in here - they are in the code
-- (enemyTypes.ts) - so an empty table means the game plays exactly as it does
-- today rather than meaning a game with no enemies.
--
-- NOT YET APPLIED to the live project. Applying it is a change to the database
-- the wallet shares, which is Geoff's to make rather than mine. Until it is,
-- every read falls back to the built-ins and nothing is broken by the wait.

create table if not exists public.rebels_enemies (
  id          text primary key,
  config      jsonb not null,
  updated_at  timestamptz not null default now()
);

alter table public.rebels_enemies enable row level security;

-- Anyone may read them: an enemy definition is what players are about to be
-- shot at by, and the cockpit needs it to draw one.
drop policy if exists "rebels enemies readable" on public.rebels_enemies;
create policy "rebels enemies readable" on public.rebels_enemies
  for select using (true);

-- Nobody may WRITE directly. The only way in is the function below, which
-- checks the shared admin secret. Direct writes being refused by policy is
-- what makes the function the only door rather than merely the tidy one.
revoke insert, update, delete on public.rebels_enemies from anon, authenticated;

-- Save the list.
--
-- The secret is read from public.rebels_admin, which has RLS on and no
-- policies, so nobody can read it through the API. That is the mechanism
-- rebels_drops_save already uses and this deliberately copies it rather than
-- inventing a second one: one place to set an admin secret, one place to get
-- it wrong. It reuses the SAME row, name 'drops', so the secret Geoff has
-- already typed into the Drops panel works here with nothing new to configure.
--
-- When LW-Auth lands and there is a real identity to check, the check moves
-- there and the secret goes - from both functions at once.
create or replace function public.rebels_enemies_save(p_secret text, p_config jsonb)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_secret text;
begin
  select secret into v_secret from public.rebels_admin where name = 'drops';
  if v_secret is null or p_secret is null or p_secret <> v_secret then
    raise exception 'not the admin secret';
  end if;
  if p_config is null or jsonb_typeof(p_config) <> 'array' then
    raise exception 'config must be a list of enemies';
  end if;
  -- Bounds the client cannot argue with. The SHAPE of each entry is checked by
  -- the validator both halves share (enemyTypes.ts); these only stop something
  -- absurd arriving from something that is not our panel.
  if jsonb_array_length(p_config) > 200 then
    raise exception 'at most 200 enemies';
  end if;
  if length(p_config::text) > 200000 then
    raise exception 'too much';
  end if;

  insert into public.rebels_enemies (id, config) values ('live', p_config)
  on conflict (id) do update set config = excluded.config, updated_at = now();
end;
$$;

grant execute on function public.rebels_enemies_save(text, jsonb) to anon, authenticated;
