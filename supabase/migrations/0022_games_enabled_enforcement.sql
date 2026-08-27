-- StulHraje - dokonceni "hry volitelne / za priplatek": migrace 0020 pridala
-- venues.games_enabled a schovala odkazy na hry na strance stolu, kdyz je
-- hospoda vypnuta - ale byl to jen "mekky" vypinac na urovni UI. Kdokoliv,
-- kdo by znal/uhodl primou URL konkretni hry, se k ni presto dostal, protoze
-- jednotlive RPC funkce pro zalozeni hry samy games_enabled nekontrolovaly.
--
-- Tahle migrace dohaje skutecne (server-side) vynuceni: kazda funkce, ktera
-- zaklada NOVOU hru/session pro hosta, ted nejdriv overi venues.games_enabled
-- a pokud je vypnuto, vrati null - stejne, jako uz dnes vraci null pro
-- neplatny/neaktivni stul (frontend uz tenhle pripad umi zobrazit jako
-- "hru se nepodarilo zalozit"). Uz rozehrane hry/session se tim nijak
-- nerusi - vypinac blokuje jen zacatek noveho hrani, presne jak by ocekaval
-- majitel hospody, kdyz si prestane platit priplatkovou sluzbu.

-- Arkadove hry se skore (Chytani surovin / Let mezi sudy / Hospodsky beh /
-- Skakani nahoru / Rozbijeni lahvi) sdileji jednu spolecnou funkci.
create or replace function start_game_session(p_qr_token text, p_game_id text)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_table tables%rowtype;
  v_session game_sessions%rowtype;
begin
  select * into v_table from tables where qr_token = p_qr_token and is_active = true;
  if not found then
    return null;
  end if;

  if not exists (select 1 from venues where id = v_table.venue_id and games_enabled) then
    return null;
  end if;

  insert into game_sessions (venue_id, table_id, game_id)
  values (v_table.venue_id, v_table.id, p_game_id)
  returning * into v_session;

  return json_build_object('session_id', v_session.id, 'started_at', v_session.started_at);
end;
$$;

-- Prsi
create or replace function prsi_create_game(p_qr_token text)
returns json
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_table tables%rowtype;
  v_session prsi_sessions%rowtype;
  v_deck jsonb;
  v_hand1 jsonb;
  v_rest jsonb;
begin
  select * into v_table from tables where qr_token = p_qr_token and is_active = true;
  if not found then
    return null;
  end if;

  if not exists (select 1 from venues where id = v_table.venue_id and games_enabled) then
    return null;
  end if;

  v_deck := prsi_new_shuffled_deck();
  v_hand1 := (select coalesce(jsonb_agg(elem), '[]'::jsonb) from (select elem from jsonb_array_elements(v_deck) elem limit 4) s(elem));
  v_rest := (select coalesce(jsonb_agg(elem), '[]'::jsonb) from (select elem from jsonb_array_elements(v_deck) with ordinality e(elem, i) where i > 4) s(elem));

  insert into prsi_sessions (venue_id, table_id, status, draw_pile_count, hand_count_1, hand_count_2)
  values (v_table.venue_id, v_table.id, 'waiting', jsonb_array_length(v_rest), 4, 0)
  returning * into v_session;

  insert into prsi_private (session_id, hand1, draw_pile)
  values (v_session.id, v_hand1, v_rest);

  return json_build_object(
    'session_id', v_session.id,
    'player_token', (select player1_token from prsi_private where session_id = v_session.id),
    'player_no', 1
  );
end;
$function$;

-- Poker
create or replace function poker_create_game(
  p_qr_token text,
  p_small_blind integer default 10,
  p_big_blind integer default 20,
  p_starting_chips integer default 1000
)
returns json
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_table tables%rowtype;
  v_session poker_sessions%rowtype;
  v_sb integer := greatest(p_small_blind, 1);
  v_bb integer;
  v_chips integer;
  v_token uuid := gen_random_uuid();
begin
  select * into v_table from tables where qr_token = p_qr_token and is_active = true;
  if not found then
    return null;
  end if;

  if not exists (select 1 from venues where id = v_table.venue_id and games_enabled) then
    return null;
  end if;

  v_bb := greatest(p_big_blind, v_sb * 2);
  v_chips := greatest(p_starting_chips, v_bb * 10);

  insert into poker_sessions (venue_id, table_id, status, stage, small_blind, big_blind, starting_chips, min_raise)
  values (v_table.venue_id, v_table.id, 'waiting', 'preflop', v_sb, v_bb, v_chips, v_bb)
  returning * into v_session;

  insert into poker_players (session_id, seat_no, chips) values (v_session.id, 1, v_chips);

  insert into poker_private (session_id, deck, hole_cards, seat_tokens)
  values (v_session.id, '[]'::jsonb, '{}'::jsonb, jsonb_build_object('1', v_token::text));

  return json_build_object('session_id', v_session.id, 'player_token', v_token, 'seat_no', 1);
end;
$function$;

-- Dama
create or replace function dama_create_game(p_qr_token text)
returns json
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_table tables%rowtype;
  v_session dama_sessions%rowtype;
begin
  select * into v_table from tables where qr_token = p_qr_token and is_active = true;
  if not found then
    return null;
  end if;

  if not exists (select 1 from venues where id = v_table.venue_id and games_enabled) then
    return null;
  end if;

  insert into dama_sessions (venue_id, table_id, status, board, current_turn)
  values (v_table.venue_id, v_table.id, 'waiting', dama_initial_board(), 1)
  returning * into v_session;

  insert into dama_private (session_id) values (v_session.id);

  return json_build_object(
    'session_id', v_session.id,
    'player_token', (select player1_token from dama_private where session_id = v_session.id),
    'player_no', 1
  );
end;
$function$;

-- Sachy
create or replace function sachy_create_game(p_qr_token text)
returns json
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_table tables%rowtype;
  v_session sachy_sessions%rowtype;
begin
  select * into v_table from tables where qr_token = p_qr_token and is_active = true;
  if not found then
    return null;
  end if;

  if not exists (select 1 from venues where id = v_table.venue_id and games_enabled) then
    return null;
  end if;

  insert into sachy_sessions (venue_id, table_id, status, board, current_turn)
  values (v_table.venue_id, v_table.id, 'waiting', sachy_initial_board(), 1)
  returning * into v_session;

  insert into sachy_private (session_id) values (v_session.id);

  return json_build_object(
    'session_id', v_session.id,
    'player_token', (select player1_token from sachy_private where session_id = v_session.id),
    'player_no', 1
  );
end;
$function$;

-- Flaska (na rozdil od ostatnich her je jeji "vstupni bod" get_or_create_session,
-- flaska_join uz jen pripojuje hrace k session, ktera existuje).
create or replace function flaska_get_or_create_session(p_qr_token text)
returns json
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_table tables%rowtype;
  v_session flaska_sessions%rowtype;
begin
  select * into v_table from tables where qr_token = p_qr_token and is_active = true;
  if not found then
    return null;
  end if;

  if not exists (select 1 from venues where id = v_table.venue_id and games_enabled) then
    return null;
  end if;

  select * into v_session
  from flaska_sessions
  where table_id = v_table.id and created_at > now() - interval '8 hours'
  order by created_at desc
  limit 1;

  if not found then
    insert into flaska_sessions (venue_id, table_id)
    values (v_table.venue_id, v_table.id)
    returning * into v_session;
  end if;

  return json_build_object('session_id', v_session.id);
end;
$function$;
