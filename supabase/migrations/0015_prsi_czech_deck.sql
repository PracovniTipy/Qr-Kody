-- 0015: Prehod "Prsi" na klasicky cesky (mariasovy) balicek karet misto
-- mezinarodniho (S/H/D/C, J/Q/K/A). Duvod: uzivatel chtel "klasicky cesky
-- prsi", ne francouzske karty.
--
-- Realne cesky balicek pro prsi/marias: 32 karet, barvy zaludy/kule/srdce/
-- listy, hodnoty 7,8,9,10,spodek,svrsek,kral,eso (zadna dama - misto ni
-- spodek jako druha nizsi figurka). Podle pravidel (ověřeno vice zdroji -
-- karetnihry.blogspot.com, rcmartinek.cz, loutkyvnemocnici.cz) je divoka
-- karta menici barvu SVRSEK (ne spodek, jak byl puvodne pojmenovany
-- mezinarodni Kluk/J v 0014 - jde tedy o preznaceni, herni logika divoke
-- karty zustava stejna). Spodek v klasickych pravidlech otáčí směr hry,
-- coz pro 2 hrace nema zadny efekt, takze zustava obycejnou kartou.
-- Eso (drive Ace/A) dal zastavuje souperuv tah, sedma (7) dal nutí lízání
-- 2 karet se skladanim - tahle cast logiky se nemeni vubec.
--
-- Zadna zivá partie v produkci v dobe teto migrace nebezela (overeno pred
-- nasazenim), takze staci prepsat funkce generujici/validujici karty -
-- neni potreba migrovat existujici radky v prsi_sessions/prsi_private.

create or replace function prsi_new_shuffled_deck()
returns jsonb
language plpgsql
set search_path to 'public'
as $$
declare
  v_ranks text[] := array['7', '8', '9', '10', 'spodek', 'svrsek', 'kral', 'eso'];
  v_suits text[] := array['zaludy', 'kule', 'srdce', 'listy'];
  v_deck jsonb := '[]'::jsonb;
  v_rank text;
  v_suit text;
begin
  foreach v_suit in array v_suits loop
    foreach v_rank in array v_ranks loop
      v_deck := v_deck || jsonb_build_object('rank', v_rank, 'suit', v_suit);
    end loop;
  end loop;

  select coalesce(jsonb_agg(elem order by random()), '[]'::jsonb)
  into v_deck
  from jsonb_array_elements(v_deck) elem;

  return v_deck;
end;
$$;

create or replace function prsi_join_game(p_session_id uuid, p_qr_token text)
returns json
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_table tables%rowtype;
  v_session prsi_sessions%rowtype;
  v_priv prsi_private%rowtype;
  v_hand2 jsonb;
  v_rest jsonb;
  v_top jsonb;
  v_player2_token uuid := gen_random_uuid();
begin
  select * into v_table from tables where qr_token = p_qr_token and is_active = true;
  if not found then
    return json_build_object('ok', false, 'reason', 'invalid_table');
  end if;

  select * into v_session from prsi_sessions where id = p_session_id and table_id = v_table.id for update;
  if not found or v_session.status <> 'waiting' then
    return json_build_object('ok', false, 'reason', 'not_waiting');
  end if;

  select * into v_priv from prsi_private where session_id = p_session_id for update;

  v_hand2 := (select coalesce(jsonb_agg(elem), '[]'::jsonb) from (select elem from jsonb_array_elements(v_priv.draw_pile) elem limit 4) s(elem));
  v_rest := (select coalesce(jsonb_agg(elem), '[]'::jsonb) from (select elem from jsonb_array_elements(v_priv.draw_pile) with ordinality e(elem, i) where i > 4) s(elem));

  -- Otoc prvni kartu; pokud je to Svrsek (divoka), dej ji na spodek talonu
  -- a zkus dalsi - at hra nezacina nedefinovanym stavem. v_guard hlida, aby
  -- se smycka nikdy nezacyklila (i kdyby talon obsahoval samé Svrsky).
  declare
    v_guard integer := 0;
    v_len integer := jsonb_array_length(v_rest);
  begin
    while v_len > 0 and (v_rest->0->>'rank') = 'svrsek' and v_guard < v_len loop
      v_rest := (v_rest - 0) || jsonb_build_array(v_rest->0);
      v_guard := v_guard + 1;
    end loop;
  end;

  v_top := v_rest->0;
  v_rest := v_rest - 0;

  update prsi_private
  set hand2 = v_hand2, draw_pile = v_rest, player2_token = v_player2_token
  where session_id = p_session_id;

  update prsi_sessions
  set status = 'playing',
      current_turn = 1,
      discard_top = v_top,
      draw_pile_count = jsonb_array_length(v_rest),
      hand_count_2 = jsonb_array_length(v_hand2),
      updated_at = now()
  where id = p_session_id;

  return json_build_object('ok', true, 'player_token', v_player2_token, 'player_no', 2);
end;
$$;

create or replace function prsi_play_card(p_session_id uuid, p_player_token uuid, p_card jsonb, p_declared_suit text default null)
returns json
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_session prsi_sessions%rowtype;
  v_priv prsi_private%rowtype;
  v_player_no smallint;
  v_hand jsonb;
  v_new_hand jsonb;
  v_found boolean := false;
  v_match_ord bigint;
  v_required_suit text;
  v_valid boolean := false;
  v_next_turn smallint;
  v_new_status text;
  v_winner smallint;
begin
  select * into v_session from prsi_sessions where id = p_session_id for update;
  if not found or v_session.status <> 'playing' then
    return json_build_object('ok', false, 'reason', 'not_playing');
  end if;

  select * into v_priv from prsi_private where session_id = p_session_id for update;

  if v_priv.player1_token = p_player_token then
    v_player_no := 1;
    v_hand := v_priv.hand1;
  elsif v_priv.player2_token = p_player_token then
    v_player_no := 2;
    v_hand := v_priv.hand2;
  else
    return json_build_object('ok', false, 'reason', 'invalid_token');
  end if;

  if v_session.current_turn <> v_player_no then
    return json_build_object('ok', false, 'reason', 'not_your_turn');
  end if;

  -- Najdi prvni vyskyt karty v ruce (podle poradi) a odeber jen tu jednu
  -- kopii - hrac muze mit v ruce vic karet stejne hodnoty/barvy.
  select min(ord) into v_match_ord
  from jsonb_array_elements(v_hand) with ordinality as e(elem, ord)
  where elem = p_card;

  v_found := v_match_ord is not null;

  if not v_found then
    return json_build_object('ok', false, 'reason', 'card_not_in_hand');
  end if;

  select coalesce(jsonb_agg(elem order by ord), '[]'::jsonb) into v_new_hand
  from jsonb_array_elements(v_hand) with ordinality as e(elem, ord)
  where ord <> v_match_ord;

  if v_session.pending_draw > 0 then
    v_valid := (p_card->>'rank') = '7';
  else
    v_required_suit := coalesce(v_session.current_suit, v_session.discard_top->>'suit');
    v_valid := (p_card->>'rank') = 'svrsek'
      or (p_card->>'suit') = v_required_suit
      or (p_card->>'rank') = (v_session.discard_top->>'rank');
  end if;

  if not v_valid then
    return json_build_object('ok', false, 'reason', 'card_not_playable');
  end if;

  if (p_card->>'rank') = 'svrsek' and (p_declared_suit is null or p_declared_suit not in ('zaludy', 'kule', 'srdce', 'listy')) then
    return json_build_object('ok', false, 'reason', 'missing_declared_suit');
  end if;

  -- Ulozit odehranou kartu do historie odhozu a aktualizovat ruku hrace.
  update prsi_private
  set discard_pile = discard_pile || jsonb_build_array(p_card),
      hand1 = case when v_player_no = 1 then v_new_hand else hand1 end,
      hand2 = case when v_player_no = 2 then v_new_hand else hand2 end
  where session_id = p_session_id;

  v_next_turn := case when v_player_no = 1 then 2 else 1 end;
  v_new_status := 'playing';
  v_winner := null;

  if jsonb_array_length(v_new_hand) = 0 then
    v_new_status := 'finished';
    v_winner := v_player_no;
    v_next_turn := null;
  elsif (p_card->>'rank') = 'eso' then
    v_next_turn := v_player_no; -- Eso: soupeř je preskocen, hrac pokracuje.
  end if;

  update prsi_sessions
  set discard_top = p_card,
      current_suit = case when (p_card->>'rank') = 'svrsek' then p_declared_suit else null end,
      pending_draw = case
        when v_new_status = 'finished' then 0
        when (p_card->>'rank') = '7' then v_session.pending_draw + 2
        else 0
      end,
      current_turn = v_next_turn,
      hand_count_1 = case when v_player_no = 1 then jsonb_array_length(v_new_hand) else hand_count_1 end,
      hand_count_2 = case when v_player_no = 2 then jsonb_array_length(v_new_hand) else hand_count_2 end,
      status = v_new_status,
      winner = v_winner,
      updated_at = now()
  where id = p_session_id;

  return json_build_object('ok', true, 'status', v_new_status, 'winner', v_winner);
end;
$$;
