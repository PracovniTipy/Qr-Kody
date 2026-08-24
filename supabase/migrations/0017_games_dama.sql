-- StulHraje - Etapa 4 (rozsireni): "Dama" (klasicka ceska/ruska dama, 8x8,
-- 12 kamenu na stranu) pro dva hosty u stejneho stolu, kazdy na svem
-- telefonu. Na rozdil od "Prsi"/"Pokeru" tu neni zadna skryta informace -
-- obe strany vidi cely stav hry porad, takze staci jedna verejna tabulka
-- (dama_sessions) + maly soukromy "prihlasovaci udaj" (dama_private) jen s
-- tajnymi tokeny hracu, at si nikdo neprivlastni tahy soupere.
--
-- Zjednoduseni pravidel oproti "letajici" mezinarodni dame: dama (povyseny
-- kamen) se pohybuje i bere STEJNE jako obycejny kamen - vzdy jen o jedno
-- pole ve ktermkoliv ze 4 diagonalnich smeru (na rozdil od obycejneho
-- kamene, ktery bez braní smi jen dopredu). Toto je bezna zjednodusena
-- varianta (americke "checkers"), zvolena schvalne kvuli slozitosti
-- implementace "letajici" damy v plpgsql - viz komentar u dama_move.
--
-- Bezpecnostni navrh: cely stav (deska, kdo je na tahu...) je verejny v
-- dama_sessions (zadne tajemstvi, klidne i pres Realtime). Jedina vec, co
-- se musi chranit, je "kdo smi zahrat tah za bileho/cerneho" - o to se
-- stara dama_private (bez RLS politik = nikdo pres anon/authenticated
-- roli nic neprecte) a SECURITY DEFINER funkce nize, ktere token overuji.

create table dama_sessions (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid not null references venues(id) on delete cascade,
  table_id uuid not null references tables(id) on delete cascade,
  status text not null default 'waiting' check (status in ('waiting', 'playing', 'finished')),
  board jsonb not null default '[]'::jsonb,
  current_turn smallint check (current_turn in (1, 2)),
  must_continue_from smallint,
  winner smallint,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index dama_sessions_table_idx on dama_sessions (table_id, status, created_at desc);

create table dama_private (
  session_id uuid primary key references dama_sessions(id) on delete cascade,
  player1_token uuid not null default gen_random_uuid(),
  player2_token uuid
);

alter table dama_sessions enable row level security;
alter table dama_private enable row level security;

create policy dama_sessions_select_public on dama_sessions for select using (true);
-- dama_private zamerne bez policy => zadny pristup pres anon/authenticated.

alter publication supabase_realtime add table dama_sessions;

-- Souradnice policka (radek 0-7, sloupec 0-7) -> index 0-63. Hraji se jen
-- tmava policka (radek+sloupec liche). Vraci null pri souradnicich mimo desku.
create or replace function dama_sq(p_row integer, p_col integer)
returns integer
language sql
immutable
as $function$
  select case when p_row between 0 and 7 and p_col between 0 and 7 then p_row * 8 + p_col else null end;
$function$;

-- Pocatecni postaveni: bily kamen 'w' na radcich 0-2, cerny kamen 'b' na
-- radcich 5-7, jen na tmavych polich (radek+sloupec liche); zbytek prazdny ''.
create or replace function dama_initial_board()
returns jsonb
language plpgsql
immutable
as $function$
declare
  v_board jsonb := '[]'::jsonb;
  v_row integer;
  v_col integer;
  v_piece text;
begin
  for v_row in 0..7 loop
    for v_col in 0..7 loop
      if (v_row + v_col) % 2 = 1 then
        if v_row <= 2 then
          v_piece := 'w';
        elsif v_row >= 5 then
          v_piece := 'b';
        else
          v_piece := '';
        end if;
      else
        v_piece := '';
      end if;
      v_board := v_board || to_jsonb(v_piece);
    end loop;
  end loop;
  return v_board;
end;
$function$;

-- Vsechny mozne "brani" (skoky pres souperuv kamen) pro kamen na policku
-- p_idx - stejna geometrie pro obycejny kamen i pro damu (viz komentar
-- nahore): skok o 2 policka v libovolnem ze 4 diagonalnich smeru pres
-- souseni souperuv kamen na prazdne policko za nim. Vraci jsonb pole
-- objektu {"mid": <index prebrateho policka>, "to": <cilove policko>}.
create or replace function dama_captures_for_piece(p_board jsonb, p_idx integer)
returns jsonb
language plpgsql
immutable
as $function$
declare
  v_piece text := p_board->>p_idx;
  v_color text;
  v_row integer := p_idx / 8;
  v_col integer := p_idx % 8;
  v_dirs integer[][] := array[[-1,-1],[-1,1],[1,-1],[1,1]];
  v_dir integer[];
  v_mid_idx integer;
  v_to_idx integer;
  v_mid_piece text;
  v_to_piece text;
  v_result jsonb := '[]'::jsonb;
begin
  if v_piece is null or v_piece = '' then
    return v_result;
  end if;
  v_color := case when lower(v_piece) = 'w' then 'w' else 'b' end;

  foreach v_dir slice 1 in array v_dirs loop
    v_mid_idx := dama_sq(v_row + v_dir[1], v_col + v_dir[2]);
    v_to_idx := dama_sq(v_row + 2 * v_dir[1], v_col + 2 * v_dir[2]);
    if v_mid_idx is not null and v_to_idx is not null then
      v_mid_piece := p_board->>v_mid_idx;
      v_to_piece := p_board->>v_to_idx;
      if v_mid_piece is not null and v_mid_piece <> ''
        and (case when lower(v_mid_piece) = 'w' then 'w' else 'b' end) <> v_color
        and (v_to_piece is null or v_to_piece = '') then
        v_result := v_result || jsonb_build_array(jsonb_build_object('mid', v_mid_idx, 'to', v_to_idx));
      end if;
    end if;
  end loop;

  return v_result;
end;
$function$;

-- Mozne "tiche" tahy (bez brani) o jedno policko - obycejny kamen jen
-- dopredu (bily smerem k radku 7, cerny smerem k radku 0), dama vsemi
-- 4 smery. Vraci pole cilovych indexu.
create or replace function dama_simple_moves_for_piece(p_board jsonb, p_idx integer)
returns integer[]
language plpgsql
immutable
as $function$
declare
  v_piece text := p_board->>p_idx;
  v_row integer := p_idx / 8;
  v_col integer := p_idx % 8;
  v_dirs integer[][];
  v_dir integer[];
  v_to_idx integer;
  v_result integer[] := array[]::integer[];
begin
  if v_piece is null or v_piece = '' then
    return v_result;
  end if;

  if v_piece = 'w' then
    v_dirs := array[[1,-1],[1,1]];
  elsif v_piece = 'b' then
    v_dirs := array[[-1,-1],[-1,1]];
  else
    v_dirs := array[[-1,-1],[-1,1],[1,-1],[1,1]];
  end if;

  foreach v_dir slice 1 in array v_dirs loop
    v_to_idx := dama_sq(v_row + v_dir[1], v_col + v_dir[2]);
    if v_to_idx is not null and (p_board->>v_to_idx) = '' then
      v_result := v_result || v_to_idx;
    end if;
  end loop;

  return v_result;
end;
$function$;

-- Existuje pro danou barvu ('w'/'b') aspon jedno mozne brani kdekoliv na
-- desce? Brani je v dame povinne, takze tohle rozhoduje, jestli hrac smi
-- zahrat "ticha" tah, nebo musi brat.
create or replace function dama_any_capture_available(p_board jsonb, p_color text)
returns boolean
language plpgsql
immutable
as $function$
declare
  v_idx integer;
  v_piece text;
begin
  for v_idx in 0..63 loop
    v_piece := p_board->>v_idx;
    if v_piece is not null and v_piece <> '' and (case when lower(v_piece) = 'w' then 'w' else 'b' end) = p_color then
      if jsonb_array_length(dama_captures_for_piece(p_board, v_idx)) > 0 then
        return true;
      end if;
    end if;
  end loop;
  return false;
end;
$function$;

-- Ma dana barva vubec nejaky legalni tah (brani, nebo aspon ticha tah)?
-- Pouziva se na konci kazdeho tahu ke zjisteni, jestli souper jeste muze
-- hrat - pokud ne, hra konci a aktualni hrac vyhrava.
create or replace function dama_player_has_any_move(p_board jsonb, p_color text)
returns boolean
language plpgsql
immutable
as $function$
declare
  v_idx integer;
  v_piece text;
begin
  if dama_any_capture_available(p_board, p_color) then
    return true;
  end if;
  for v_idx in 0..63 loop
    v_piece := p_board->>v_idx;
    if v_piece is not null and v_piece <> '' and (case when lower(v_piece) = 'w' then 'w' else 'b' end) = p_color then
      if array_length(dama_simple_moves_for_piece(p_board, v_idx), 1) > 0 then
        return true;
      end if;
    end if;
  end loop;
  return false;
end;
$function$;

-- Zalozi novou hru Damy pro stul (podle qr_token) - deska v pocatecnim
-- postaveni, bily (hrac 1) na tahu, ceka na druheho hrace.
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

-- Najde nejnovejsi hru "waiting" na danem stole (stejny vzor jako u Prsi/Pokeru).
create or replace function dama_find_waiting_game(p_qr_token text)
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

  select * into v_session
  from dama_sessions
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
create or replace function dama_join_game(p_session_id uuid, p_qr_token text)
returns json
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_table tables%rowtype;
  v_session dama_sessions%rowtype;
  v_player2_token uuid := gen_random_uuid();
begin
  select * into v_table from tables where qr_token = p_qr_token and is_active = true;
  if not found then
    return json_build_object('ok', false, 'reason', 'invalid_table');
  end if;

  select * into v_session from dama_sessions where id = p_session_id and table_id = v_table.id for update;
  if not found or v_session.status <> 'waiting' then
    return json_build_object('ok', false, 'reason', 'not_waiting');
  end if;

  update dama_private set player2_token = v_player2_token where session_id = p_session_id;

  update dama_sessions
  set status = 'playing', updated_at = now()
  where id = p_session_id;

  return json_build_object('ok', true, 'player_token', v_player2_token, 'player_no', 2);
end;
$function$;

-- Odehraje jeden "skok" (bud ticha tah o jedno policko, nebo jedno brani).
-- Vicenasobne brani (kdyz po skoku muze stejny kamen brat znovu) se resi
-- tak, ze tah nepredava a klient musi poslat dalsi tah ze stejneho policka
-- (must_continue_from) - server to vynuti.
create or replace function dama_move(p_session_id uuid, p_player_token uuid, p_from integer, p_to integer)
returns json
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_session dama_sessions%rowtype;
  v_priv dama_private%rowtype;
  v_player_no smallint;
  v_color text;
  v_opponent_color text;
  v_piece text;
  v_board jsonb;
  v_captures jsonb;
  v_capture_needed boolean;
  v_match jsonb;
  v_mid_idx integer;
  v_is_capture boolean := false;
  v_simple integer[];
  v_new_piece text;
  v_new_row integer;
  v_next_turn smallint;
  v_new_must_continue smallint;
  v_new_status text := 'playing';
  v_winner smallint;
  v_elem jsonb;
begin
  select * into v_session from dama_sessions where id = p_session_id for update;
  if not found or v_session.status <> 'playing' then
    return json_build_object('ok', false, 'reason', 'not_playing');
  end if;

  select * into v_priv from dama_private where session_id = p_session_id;
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
  v_piece := v_board->>p_from;
  if v_piece is null or v_piece = '' or (case when lower(v_piece) = 'w' then 'w' else 'b' end) <> v_color then
    return json_build_object('ok', false, 'reason', 'invalid_move');
  end if;

  if v_session.must_continue_from is not null and v_session.must_continue_from <> p_from then
    return json_build_object('ok', false, 'reason', 'must_continue');
  end if;

  v_captures := dama_captures_for_piece(v_board, p_from);
  v_capture_needed := v_session.must_continue_from is not null or dama_any_capture_available(v_board, v_color);

  if v_capture_needed then
    select elem into v_match from jsonb_array_elements(v_captures) elem where (elem->>'to')::integer = p_to;
    if v_match is null then
      return json_build_object('ok', false, 'reason', case when v_session.must_continue_from is not null then 'must_continue' else 'must_capture' end);
    end if;
    v_mid_idx := (v_match->>'mid')::integer;
    v_is_capture := true;
  else
    v_simple := dama_simple_moves_for_piece(v_board, p_from);
    if not (p_to = any(v_simple)) then
      return json_build_object('ok', false, 'reason', 'invalid_move');
    end if;
  end if;

  -- Povyseni na damu, pokud kamen dosahne posledniho radku (bily radek 7,
  -- cerny radek 0). Uz povysena dama zustava damou.
  v_new_row := p_to / 8;
  v_new_piece := v_piece;
  if v_piece = 'w' and v_new_row = 7 then
    v_new_piece := 'W';
  elsif v_piece = 'b' and v_new_row = 0 then
    v_new_piece := 'B';
  end if;

  v_board := jsonb_set(v_board, array[p_from::text], to_jsonb(''::text));
  v_board := jsonb_set(v_board, array[p_to::text], to_jsonb(v_new_piece));
  if v_is_capture then
    v_board := jsonb_set(v_board, array[v_mid_idx::text], to_jsonb(''::text));
  end if;

  v_new_must_continue := null;
  v_next_turn := case when v_player_no = 1 then 2 else 1 end;

  if v_is_capture and jsonb_array_length(dama_captures_for_piece(v_board, p_to)) > 0 then
    -- Stejny kamen muze pokracovat v brani - tah zustava u stejneho hrace.
    v_new_must_continue := p_to;
    v_next_turn := v_player_no;
  else
    -- Tah se preda soupeři; zkontroluj, jestli souper vubec muze hrat.
    if not dama_player_has_any_move(v_board, v_opponent_color) then
      v_new_status := 'finished';
      v_winner := v_player_no;
      v_next_turn := null;
    end if;
  end if;

  update dama_sessions
  set board = v_board,
      current_turn = v_next_turn,
      must_continue_from = v_new_must_continue,
      status = v_new_status,
      winner = v_winner,
      updated_at = now()
  where id = p_session_id;

  return json_build_object(
    'ok', true,
    'status', v_new_status,
    'winner', v_winner,
    'continued', v_new_must_continue is not null
  );
end;
$function$;
