-- Divi Rebels: forging, four of one tier into one of the next, on the server.
--
-- Items are two rising counters per key in rebels_loadout.items: gained
-- ("hull2") and used ("used:hull2"); held is the difference (see
-- ui/src/wallet/rebels/rebelsInventory.ts). Forging spends four (used +4) and
-- gains one of a higher tier: +1 at 90%, +2 at 9%, +3 at 1%, capped at tier 7
-- (Geoff, 2026-Sep-11). The roll is random() HERE, so a client cannot pick
-- its own result; the client only merges what comes back.
--
-- Trust: anyone who knows an owner_key can forge that account's items, which
-- is the same trust the save function already extends (anyone can write any
-- row). It can waste someone's items, never mint them.

create or replace function public.rebels_forge(p_owner_key text, p_key text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_items jsonb;
  v_kind text;
  v_tier int;
  v_have numeric;
  v_roll double precision;
  v_step int;
  v_result text;
begin
  if p_owner_key is null or length(trim(p_owner_key)) = 0 then
    raise exception 'owner_key required';
  end if;
  if p_key !~ '^(vstrafe|strafe|hull|drone)[1-6]$' then
    raise exception 'not a forgeable item';
  end if;
  v_kind := regexp_replace(p_key, '[0-9]+$', '');
  v_tier := (regexp_replace(p_key, '^[a-z]+', ''))::int;

  select items into v_items from public.rebels_loadout
   where owner_key = lower(trim(p_owner_key)) for update;
  if v_items is null then
    raise exception 'no such account';
  end if;

  v_have := coalesce((v_items->>p_key)::numeric, 0) - coalesce((v_items->>('used:' || p_key))::numeric, 0);
  if v_have < 4 then
    raise exception 'needs four';
  end if;

  v_roll := random();
  v_step := case when v_roll < 0.90 then 1 when v_roll < 0.99 then 2 else 3 end;
  v_result := v_kind || least(7, v_tier + v_step)::text;

  v_items := jsonb_set(v_items, array['used:' || p_key],
                       to_jsonb(coalesce((v_items->>('used:' || p_key))::numeric, 0) + 4), true);
  v_items := jsonb_set(v_items, array[v_result],
                       to_jsonb(coalesce((v_items->>v_result)::numeric, 0) + 1), true);

  update public.rebels_loadout set items = v_items, updated_at = now()
   where owner_key = lower(trim(p_owner_key));
  return jsonb_build_object('result', v_result, 'items', v_items);
end;
$$;

grant execute on function public.rebels_forge(text, text) to anon, authenticated;
