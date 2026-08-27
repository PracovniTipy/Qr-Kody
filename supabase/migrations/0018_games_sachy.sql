-- StulHraje - Etapa 4 (rozsireni): "Sachy" (klasicky mezinarodni sach, 8x8)
-- pro dva hosty u stejneho stolu, kazdy na svem telefonu. Stejny bezpecnostni
-- vzor jako "Dama" (migrace 0017) - zadna skryta informace (obe strany vidi
-- celou desku porad), takze staci jedna verejna tabulka (sachy_sessions) +
-- maly soukromy "prihlasovaci udaj" (sachy_private) jen s tajnymi tokeny
-- hracu, at si nikdo neprivlastni tahy soupere. Cely stav (deska, kdo je na
-- tahu, prava na rosadu, branti mimochodem...) je verejny, jedina chranena
-- vec je "kdo smi zahrat tah za bileho/cerneho".
--
-- Zjednoduseni pravidel oproti plnym FIDE pravidlum: hra konci matem nebo
-- patem (bez tahu = pat). NEreseji se remizova pravidla zavisla na historii
-- (trojnasobne opakovani pozice, 50 tahu bez braní/tahu pesce) - to by
-- vyzadovalo ukladat celou historii pozic navic ke stavu desky, coz pro
-- prilezitostnou hru dvou hostu u stolu neni potreba. Podobne jako u Damy
-- (zjednoduseny "letajici" pohyb damy) jde o vedomy kompromis slozitost
-- vs. prinos.
--
-- Deska: pole 64 policek (index = radek*8 + sloupec, radek 0 = 1. rada
-- (bila domovska), radek 7 = 8. rada (cerna domovska), sloupec 0 = sloupec
-- "a"). Kazde policko je '' (prazdne), nebo pismeno figury - velke pro
-- bileho (P N B R Q K), male pro cerneho (p n b r q k).

create table sachy_sessions (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid not null references venues(id) on delete cascade,
  table_id uuid not null references tables(id) on delete cascade,
  status text not null default 'waiting' check (status in ('waiting', 'playing', 'finished')),
  board jsonb not null default '[]'::jsonb,
  current_turn smallint check (current_turn in (1, 2)),
  castling jsonb not null default '{"wk": true, "wq": true, "bk": true, "bq": true}'::jsonb,
  en_passant integer,
  last_move jsonb,
  winner smallint,
  game_over_reason text check (game_over_reason in ('checkmate', 'stalemate')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index sachy_sessions_table_idx on sachy_sessions (table_id, status, created_at desc);

create table sachy_private (
  session_id uuid primary key references sachy_sessions(id) on delete cascade,
  player1_token uuid not null default gen_random_uuid(),
  player2_token uuid
);

alter table sachy_sessions enable row level security;
alter table sachy_private enable row level security;

create policy sachy_sessions_select_public on sachy_sessions for select using (true);
-- sachy_private zamerne bez policy => zadny pristup pres anon/authenticated.

alter publication supabase_realtime add table sachy_sessions;

-- Barva figury podle velikosti pismene ('' / null => zadna figura).
create or replace function sachy_piece_color(p_piece text)
returns text
language sql
immutable
as $function$
  select case
    when p_piece is null or p_piece = '' then null
    when p_piece = upper(p_piece) then 'w'
    else 'b'
  end;
$function$;

-- Pocatecni postaveni sachovnice.
create or replace function sachy_initial_board()
returns jsonb
language plpgsql
immutable
as $function$
declare
  v_back text[] := array['R', 'N', 'B', 'Q', 'K', 'B', 'N', 'R'];
  v_board jsonb := '[]'::jsonb;
  v_col integer;
begin
  for v_col in 1..8 loop
    v_board := v_board || to_jsonb(v_back[v_col]);
  end loop;
  for v_col in 1..8 loop
    v_board := v_board || to_jsonb('P'::text);
  end loop;
  for v_col in 1..32 loop
    v_board := v_board || to_jsonb(''::text);
  end loop;
  for v_col in 1..8 loop
    v_board := v_board || to_jsonb('p'::text);
  end loop;
  for v_col in 1..8 loop
    v_board := v_board || to_jsonb(lower(v_back[v_col]));
  end loop;
  return v_board;
end;
$function$;

-- Overi, ze vsechna policka MEZI p_from a p_to (bez krajnich bodu) jsou
-- prazdna. Predpoklada, ze p_from a p_to lezi na spolecne rade, sloupci
-- nebo uhloprice (volajici to musi zajistit predem) - pouziva se pro vez,
-- strelce a damu.
create or replace function sachy_path_clear(p_board jsonb, p_from integer, p_to integer)
returns boolean
language plpgsql
immutable
as $function$
declare
  v_file_from integer := p_from % 8;
  v_rank_from integer := p_from / 8;
  v_file_to integer := p_to % 8;
  v_rank_to integer := p_to / 8;
  v_dfile integer := sign(v_file_to - v_file_from)::integer;
  v_drank integer := sign(v_rank_to - v_rank_from)::integer;
  v_cur_file integer := v_file_from;
  v_cur_rank integer := v_rank_from;
  v_cur integer;
begin
  loop
    v_cur_file := v_cur_file + v_dfile;
    v_cur_rank := v_cur_rank + v_drank;
    exit when v_cur_file = v_file_to and v_cur_rank = v_rank_to;
    v_cur := v_cur_rank * 8 + v_cur_file;
    if (p_board ->> v_cur) <> '' then
      return false;
    end if;
  end loop;
  return true;
end;
$function$;

-- Umi figura na p_from "utocit" na policko p_to (podle sveho typicke tahu -
-- u pesce jen diagonalne, bez ohledu na obsazenost p_to)? Pouziva se pro
-- zjisteni, jestli je nejake policko v sachu.
create or replace function sachy_attacks(p_board jsonb, p_from integer, p_to integer)
returns boolean
language plpgsql
immutable
as $function$
declare
  v_piece text := p_board ->> p_from;
  v_type text;
  v_color text;
  v_ff integer := p_from % 8;
  v_fr integer := p_from / 8;
  v_tf integer := p_to % 8;
  v_tr integer := p_to / 8;
  v_df integer := abs(v_tf - v_ff);
  v_dr integer := abs(v_tr - v_fr);
begin
  if v_piece is null or v_piece = '' then
    return false;
  end if;
  v_color := sachy_piece_color(v_piece);
  v_type := upper(v_piece);

  if v_type = 'P' then
    if v_color = 'w' then
      return v_df = 1 and (v_tr - v_fr) = 1;
    else
      return v_df = 1 and (v_tr - v_fr) = -1;
    end if;
  elsif v_type = 'N' then
    return (v_df = 1 and v_dr = 2) or (v_df = 2 and v_dr = 1);
  elsif v_type = 'K' then
    return v_df <= 1 and v_dr <= 1 and (v_df + v_dr) > 0;
  elsif v_type = 'B' then
    return v_df = v_dr and v_df > 0 and sachy_path_clear(p_board, p_from, p_to);
  elsif v_type = 'R' then
    return ((v_df = 0 and v_dr > 0) or (v_dr = 0 and v_df > 0)) and sachy_path_clear(p_board, p_from, p_to);
  elsif v_type = 'Q' then
    return ((v_df = v_dr and v_df > 0) or (v_df = 0 and v_dr > 0) or (v_dr = 0 and v_df > 0))
      and sachy_path_clear(p_board, p_from, p_to);
  end if;
  return false;
end;
$function$;

-- Je policko p_sq napadeno nejakou figurou barvy p_by_color?
create or replace function sachy_is_square_attacked(p_board jsonb, p_sq integer, p_by_color text)
returns boolean
language plpgsql
immutable
as $function$
declare
  v_i integer;
  v_piece text;
begin
  for v_i in 0..63 loop
    v_piece := p_board ->> v_i;
    if v_piece is not null and v_piece <> '' and sachy_piece_color(v_piece) = p_by_color then
      if sachy_attacks(p_board, v_i, p_sq) then
        return true;
      end if;
    end if;
  end loop;
  return false;
end;
$function$;

-- Najde policko krale dane barvy (null pokud chybi - nemelo by nastat).
create or replace function sachy_find_king(p_board jsonb, p_color text)
returns integer
language plpgsql
immutable
as $function$
declare
  v_i integer;
  v_target text := case when p_color = 'w' then 'K' else 'k' end;
begin
  for v_i in 0..63 loop
    if (p_board ->> v_i) = v_target then
      return v_i;
    end if;
  end loop;
  return null;
end;
$function$;

-- Mechanicky provede tah na desce (bez overeni legality) - presune figuru,
-- vyresi branti mimochodem (odebrani sousedniho pesce), rosadu (spoluprovede
-- tah veze) a promeni pesce na posledni rade na zvolenou figuru. p_en_passant
-- je cil branti mimochodem PLATNY PRED timto tahem (z aktualniho stavu hry).
create or replace function sachy_apply_raw_move(p_board jsonb, p_from integer, p_to integer, p_promotion text, p_en_passant integer)
returns jsonb
language plpgsql
immutable
as $function$
declare
  v_board jsonb := p_board;
  v_piece text := v_board ->> p_from;
  v_type text := upper(v_piece);
  v_color text := sachy_piece_color(v_piece);
  v_target_piece text;
  v_from_file integer := p_from % 8;
  v_to_file integer := p_to % 8;
  v_from_rank integer := p_from / 8;
begin
  -- Branti mimochodem: pesec tahne diagonalne na prazdne policko, ktere je
  -- prave platnym cilem branti mimochodem => odeber souperova pesce vedle.
  if v_type = 'P' and v_to_file <> v_from_file and (v_board ->> p_to) = '' and p_to = p_en_passant then
    v_board := jsonb_set(v_board, array[(v_from_rank * 8 + v_to_file)::text], to_jsonb(''::text));
  end if;

  -- Rosada: kral tahne o 2 sloupce => spolu s nim presun prislusnou vez.
  if v_type = 'K' and abs(v_to_file - v_from_file) = 2 then
    if v_to_file = 6 then
      v_board := jsonb_set(v_board, array[(p_from + 3)::text], to_jsonb(''::text));
      v_board := jsonb_set(v_board, array[(p_from + 1)::text], to_jsonb(case when v_color = 'w' then 'R' else 'r' end));
    elsif v_to_file = 2 then
      v_board := jsonb_set(v_board, array[(p_from - 4)::text], to_jsonb(''::text));
      v_board := jsonb_set(v_board, array[(p_from - 1)::text], to_jsonb(case when v_color = 'w' then 'R' else 'r' end));
    end if;
  end if;

  -- Promena pesce na posledni rade.
  if v_type = 'P' and (p_to / 8 = 7 or p_to / 8 = 0) and p_promotion is not null then
    v_target_piece := case when v_color = 'w' then upper(p_promotion) else lower(p_promotion) end;
  else
    v_target_piece := v_piece;
  end if;

  v_board := jsonb_set(v_board, array[p_from::text], to_jsonb(''::text));
  v_board := jsonb_set(v_board, array[p_to::text], to_jsonb(v_target_piece));

  return v_board;
end;
$function$;

-- Je tah p_from -> p_to podle pravidel pohybu dane figury mozny (bez ohledu
-- na to, jestli by po nem zustal vlastni kral v sachu - to resi az
-- sachy_is_legal_move nize)? p_castling a p_en_passant jsou aktualni prava
-- z sachy_sessions.
create or replace function sachy_pseudo_legal(
  p_board jsonb, p_from integer, p_to integer, p_turn text,
  p_castling jsonb, p_en_passant integer, p_promotion text
)
returns boolean
language plpgsql
immutable
as $function$
declare
  v_piece text := p_board ->> p_from;
  v_color text;
  v_type text;
  v_target text := p_board ->> p_to;
  v_target_color text;
  v_ff integer := p_from % 8;
  v_fr integer := p_from / 8;
  v_tf integer := p_to % 8;
  v_tr integer := p_to / 8;
  v_df integer := v_tf - v_ff;
  v_dr integer := v_tr - v_fr;
begin
  if p_from < 0 or p_from > 63 or p_to < 0 or p_to > 63 or p_from = p_to then
    return false;
  end if;
  if v_piece is null or v_piece = '' then
    return false;
  end if;
  v_color := sachy_piece_color(v_piece);
  if v_color <> p_turn then
    return false;
  end if;
  v_type := upper(v_piece);
  v_target_color := sachy_piece_color(v_target);
  if v_target_color = v_color then
    return false;
  end if;

  if v_type = 'P' then
    if v_color = 'w' then
      if v_df = 0 and v_dr = 1 and v_target = '' then
        return true;
      end if;
      if v_df = 0 and v_dr = 2 and v_fr = 1 and v_target = '' and (p_board ->> (p_from + 8)) = '' then
        return true;
      end if;
      if abs(v_df) = 1 and v_dr = 1 then
        if v_target_color = 'b' or p_to = p_en_passant then
          return true;
        end if;
      end if;
      return false;
    else
      if v_df = 0 and v_dr = -1 and v_target = '' then
        return true;
      end if;
      if v_df = 0 and v_dr = -2 and v_fr = 6 and v_target = '' and (p_board ->> (p_from - 8)) = '' then
        return true;
      end if;
      if abs(v_df) = 1 and v_dr = -1 then
        if v_target_color = 'w' or p_to = p_en_passant then
          return true;
        end if;
      end if;
      return false;
    end if;
  elsif v_type = 'N' then
    return (abs(v_df) = 1 and abs(v_dr) = 2) or (abs(v_df) = 2 and abs(v_dr) = 1);
  elsif v_type = 'B' then
    return abs(v_df) = abs(v_dr) and v_df <> 0 and sachy_path_clear(p_board, p_from, p_to);
  elsif v_type = 'R' then
    return ((v_df = 0 and v_dr <> 0) or (v_dr = 0 and v_df <> 0)) and sachy_path_clear(p_board, p_from, p_to);
  elsif v_type = 'Q' then
    return (
      (abs(v_df) = abs(v_dr) and v_df <> 0) or (v_df = 0 and v_dr <> 0) or (v_dr = 0 and v_df <> 0)
    ) and sachy_path_clear(p_board, p_from, p_to);
  elsif v_type = 'K' then
    if abs(v_df) <= 1 and abs(v_dr) <= 1 and (abs(v_df) + abs(v_dr)) > 0 then
      return true;
    end if;
    if abs(v_df) = 2 and v_dr = 0 then
      if v_color = 'w' and p_from = 4 then
        if v_df = 2 and coalesce((p_castling ->> 'wk')::boolean, false) and (p_board ->> 7) = 'R'
          and (p_board ->> 5) = '' and (p_board ->> 6) = ''
          and not sachy_is_square_attacked(p_board, 4, 'b')
          and not sachy_is_square_attacked(p_board, 5, 'b')
          and not sachy_is_square_attacked(p_board, 6, 'b') then
          return true;
        end if;
        if v_df = -2 and coalesce((p_castling ->> 'wq')::boolean, false) and (p_board ->> 0) = 'R'
          and (p_board ->> 1) = '' and (p_board ->> 2) = '' and (p_board ->> 3) = ''
          and not sachy_is_square_attacked(p_board, 4, 'b')
          and not sachy_is_square_attacked(p_board, 3, 'b')
          and not sachy_is_square_attacked(p_board, 2, 'b') then
          return true;
        end if;
      elsif v_color = 'b' and p_from = 60 then
        if v_df = 2 and coalesce((p_castling ->> 'bk')::boolean, false) and (p_board ->> 63) = 'r'
          and (p_board ->> 61) = '' and (p_board ->> 62) = ''
          and not sachy_is_square_attacked(p_board, 60, 'w')
          and not sachy_is_square_attacked(p_board, 61, 'w')
          and not sachy_is_square_attacked(p_board, 62, 'w') then
          return true;
        end if;
        if v_df = -2 and coalesce((p_castling ->> 'bq')::boolean, false) and (p_board ->> 56) = 'r'
          and (p_board ->> 57) = '' and (p_board ->> 58) = '' and (p_board ->> 59) = ''
          and not sachy_is_square_attacked(p_board, 60, 'w')
          and not sachy_is_square_attacked(p_board, 59, 'w')
          and not sachy_is_square_attacked(p_board, 58, 'w') then
          return true;
        end if;
      end if;
    end if;
    return false;
  end if;
  return false;
end;
$function$;

-- Plna legalita tahu: pseudo-legalni pohyb + po jeho provedeni nesmi zustat
-- vlastni kral v sachu.
create or replace function sachy_is_legal_move(
  p_board jsonb, p_from integer, p_to integer, p_turn text,
  p_castling jsonb, p_en_passant integer, p_promotion text
)
returns boolean
language plpgsql
immutable
as $function$
declare
  v_new_board jsonb;
  v_king_sq integer;
  v_opponent text := case when p_turn = 'w' then 'b' else 'w' end;
begin
  if not sachy_pseudo_legal(p_board, p_from, p_to, p_turn, p_castling, p_en_passant, p_promotion) then
    return false;
  end if;
  v_new_board := sachy_apply_raw_move(p_board, p_from, p_to, p_promotion, p_en_passant);
  v_king_sq := sachy_find_king(v_new_board, p_turn);
  if v_king_sq is null then
    return false;
  end if;
  return not sachy_is_square_attacked(v_new_board, v_king_sq, v_opponent);
end;
$function$;

-- Ma barva p_turn aspon jeden legalni tah? Pouziva se pro rozpoznani matu/patu.
create or replace function sachy_has_any_legal_move(p_board jsonb, p_turn text, p_castling jsonb, p_en_passant integer)
returns boolean
language plpgsql
immutable
as $function$
declare
  v_from integer;
  v_to integer;
  v_piece text;
begin
  for v_from in 0..63 loop
    v_piece := p_board ->> v_from;
    if v_piece is not null and v_piece <> '' and sachy_piece_color(v_piece) = p_turn then
      for v_to in 0..63 loop
        if sachy_is_legal_move(p_board, v_from, v_to, p_turn, p_castling, p_en_passant, 'Q') then
          return true;
        end if;
      end loop;
    end if;
  end loop;
  return false;
end;
$function$;

-- Zalozi novou hru Sachu pro stul (podle qr_token) - deska v pocatecnim
-- postaveni, bily (hrac 1) na tahu, ceka na druheho hrace.
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

-- Najde nejnovejsi hru "waiting" na danem stole (stejny vzor jako u Prsi/Pokeru/Damy).
create or replace function sachy_find_waiting_game(p_qr_token text)
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

  select * into v_session
  from sachy_sessions
  where table_id = v_table.id and status = 'waiting' and created_at > now() - interval '30 minutes'
  order by created_at desc
  limit 1;

  if not found then
    return null;
  end if;

  return json_build_object('session_id', v_session.id, 'created_at', v_session.created_at);
end;
$function$;

-- Druhy host se pripoji k cekajici hre jako cerny (hrac 2), hra zacina.
create or replace function sachy_join_game(p_session_id uuid, p_qr_token text)
returns json
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_table tables%rowtype;
  v_session sachy_sessions%rowtype;
  v_player2_token uuid := gen_random_uuid();
begin
  select * into v_table from tables where qr_token = p_qr_token and is_active = true;
  if not found then
    return json_build_object('ok', false, 'reason', 'invalid_table');
  end if;

  select * into v_session from sachy_sessions where id = p_session_id and table_id = v_table.id for update;
  if not found or v_session.status <> 'waiting' then
    return json_build_object('ok', false, 'reason', 'not_waiting');
  end if;

  update sachy_private set player2_token = v_player2_token where session_id = p_session_id;

  update sachy_sessions
  set status = 'playing', updated_at = now()
  where id = p_session_id;

  return json_build_object('ok', true, 'player_token', v_player2_token, 'player_no', 2);
end;
$function$;

-- Odehraje jeden tah. p_promotion (volitelne 'Q'/'R'/'B'/'N') urcuje, na
-- co se promeni pesec dosahnuvsi posledni rady - kdyz chybi nebo je
-- neplatny, promeni se automaticky na damu.
create or replace function sachy_move(
  p_session_id uuid, p_player_token uuid, p_from integer, p_to integer, p_promotion text default null
)
returns json
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_session sachy_sessions%rowtype;
  v_priv sachy_private%rowtype;
  v_player_no smallint;
  v_color text;
  v_opponent_color text;
  v_piece text;
  v_board jsonb;
  v_new_board jsonb;
  v_new_castling jsonb;
  v_new_en_passant integer;
  v_promo text := upper(coalesce(p_promotion, 'Q'));
  v_next_turn smallint;
  v_new_status text := 'playing';
  v_winner smallint;
  v_reason text;
  v_opponent_in_check boolean;
begin
  if v_promo not in ('Q', 'R', 'B', 'N') then
    v_promo := 'Q';
  end if;

  select * into v_session from sachy_sessions where id = p_session_id for update;
  if not found or v_session.status <> 'playing' then
    return json_build_object('ok', false, 'reason', 'not_playing');
  end if;

  select * into v_priv from sachy_private where session_id = p_session_id;
  if v_priv.player1_token = p_player_token then
    v_player_no := 1;
    v_color := 'w';
  elsif v_priv.player2_token = p_player_token then
    v_player_no := 2;
    v_color := 'b';
  else
    return json_build_object('ok', false, 'reason', 'invalid_token');
  end if;
  v_opponent_color := case when v_color = 'w' then 'b' else 'w' end;

  if v_session.current_turn <> v_player_no then
    return json_build_object('ok', false, 'reason', 'not_your_turn');
  end if;

  v_board := v_session.board;
  v_piece := v_board ->> p_from;

  if not sachy_is_legal_move(v_board, p_from, p_to, v_color, v_session.castling, v_session.en_passant, v_promo) then
    return json_build_object('ok', false, 'reason', 'invalid_move');
  end if;

  v_new_board := sachy_apply_raw_move(v_board, p_from, p_to, v_promo, v_session.en_passant);

  -- Prava na rosadu: kral nebo vez (odjeti i sebrani na domovskem policku) ruší prislusna prava.
  v_new_castling := v_session.castling;
  if upper(v_piece) = 'K' then
    if v_color = 'w' then
      v_new_castling := jsonb_set(jsonb_set(v_new_castling, '{wk}', 'false'), '{wq}', 'false');
    else
      v_new_castling := jsonb_set(jsonb_set(v_new_castling, '{bk}', 'false'), '{bq}', 'false');
    end if;
  end if;
  if p_from = 0 or p_to = 0 then
    v_new_castling := jsonb_set(v_new_castling, '{wq}', 'false');
  end if;
  if p_from = 7 or p_to = 7 then
    v_new_castling := jsonb_set(v_new_castling, '{wk}', 'false');
  end if;
  if p_from = 56 or p_to = 56 then
    v_new_castling := jsonb_set(v_new_castling, '{bq}', 'false');
  end if;
  if p_from = 63 or p_to = 63 then
    v_new_castling := jsonb_set(v_new_castling, '{bk}', 'false');
  end if;

  -- Novy cil branti mimochodem, pokud tento tah byl dvojkrok pescem.
  if upper(v_piece) = 'P' and abs(p_to - p_from) = 16 then
    v_new_en_passant := (p_from + p_to) / 2;
  else
    v_new_en_passant := null;
  end if;

  v_next_turn := case when v_player_no = 1 then 2 else 1 end;

  if sachy_has_any_legal_move(v_new_board, v_opponent_color, v_new_castling, v_new_en_passant) then
    v_opponent_in_check := sachy_is_square_attacked(
      v_new_board, sachy_find_king(v_new_board, v_opponent_color), v_color
    );
  else
    v_new_status := 'finished';
    v_next_turn := null;
    if sachy_is_square_attacked(v_new_board, sachy_find_king(v_new_board, v_opponent_color), v_color) then
      v_reason := 'checkmate';
      v_winner := v_player_no;
      v_opponent_in_check := true;
    else
      v_reason := 'stalemate';
      v_winner := null;
      v_opponent_in_check := false;
    end if;
  end if;

  update sachy_sessions
  set board = v_new_board,
      current_turn = v_next_turn,
      castling = v_new_castling,
      en_passant = v_new_en_passant,
      last_move = json_build_object('from', p_from, 'to', p_to),
      status = v_new_status,
      winner = v_winner,
      game_over_reason = v_reason,
      updated_at = now()
  where id = p_session_id;

  return json_build_object(
    'ok', true,
    'status', v_new_status,
    'winner', v_winner,
    'reason', v_reason,
    'check', coalesce(v_opponent_in_check, false)
  );
end;
$function$;
