-- Who is allowed to SEE the admin panels, answered by the server.
--
-- WHY THIS EXISTS. The four Rebels admin panels (Drops, Enemies, Games, NFDs)
-- are reached through the gear in the desktop app, where every panel is one
-- person's own wallet and showing the gear costs nothing. On the web they are
-- reached at divi.love/rebels, which is a public page, so the gear must not
-- simply be there for everyone: a player should never see an admin tab, and
-- the page should not have to decide that for itself. This function is the
-- decision, made where nobody can argue with it.
--
-- WHAT IT IS NOT. It is NOT the write gate. Every write still presents the
-- secret to rebels_drops_save / rebels_enemy_save / rebels_game_save /
-- rebels_nfd_save and is refused by those functions if it is wrong. This only
-- answers "does this credential belong to an admin", so the page knows whether
-- to show the door at all. Visibility is a courtesy; those functions are the
-- guarantee.
--
-- IT CHECKS EXACTLY WHAT THE WRITE FUNCTIONS CHECK, the one row named 'drops'
-- in public.rebels_admin, deliberately and not by accident. A second source of
-- truth here would mean a credential that opens the panels and then cannot save
-- anything, which looks like a broken panel rather than a refused login. When
-- admins become people rather than one shared secret (LW-SSO carries a role of
-- user / admin / superadmin per account), this function is the one place that
-- answers the question, and all four write functions change with it, in one
-- deliberate edit rather than one at a time.
--
-- The role is returned as text rather than a boolean so that the admin /
-- superadmin split LW-SSO already makes can land here without changing the
-- shape of the answer. Today the shared secret is the highest authority there
-- is, so it answers 'superadmin'.
--
-- Returns 'superadmin' for the admin secret, and NULL for anything else:
-- no secret, the wrong secret, or no admin row configured at all.
create or replace function public.rebels_role(p_secret text)
returns text
language plpgsql security definer stable set search_path = public as $fn$
declare
  v_secret text;
begin
  if p_secret is null or length(btrim(p_secret)) = 0 then
    return null;
  end if;
  select secret into v_secret from public.rebels_admin where name = 'drops';
  if v_secret is null or p_secret <> v_secret then
    return null;
  end if;
  return 'superadmin';
end;
$fn$;

grant execute on function public.rebels_role(text) to anon, authenticated;
