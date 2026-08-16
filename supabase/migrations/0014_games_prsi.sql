-- StulHraje - Etapa 4 (rozsireni): "Prsi" - tahova karetni hra pro dva hosty
-- u stejneho stolu (kazdy na svem telefonu), na rozdil od dosavadnich peti
-- jednohracovych arkadovek (kosik/flappy/runner/climb/breakout), ktere jen
-- meri skore a ukladaji ho do zebricku. Tady spolu hraji dva zivi lide proti
-- sobe v realnem case pres Supabase Realtime.
--
-- Bezpecnostni navrh: verejny stav hry (na tahu, vrchni karta, pocty karet
-- v rukou, vyherce...) je v prsi_sessions - tuhle tabulku smi kdokoli cist
-- (i pres Realtime), protoze neobsahuje zadne tajemstvi. Skutecne ruce hracu
-- a talon (co se bude teprve licovat) jsou v prsi_private, ktera nema zadne
-- RLS politiky (= nikdo pres anon/authenticated roli nic nepta, ani SELECT).
-- Jedina cesta k datum je pres SECURITY DEFINER funkce nize, ktere nejdriv
-- overi hraccuv tajny token (vydany pri zalozeni/pripojeni), takze soupeř
-- nikdy neuvidi cizi kartu jinak nez tim, ze ji soupeř skutecne zahraje.

create table prsi_sessions (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid not null references venues(id) on delete cascade,
  table_id uuid not null references tables(id) on delete cascade,
  status text not null default 'waiting' check (status in ('waiting', 'playing', 'finished')),
  current_turn smallint check (current_turn in (1, 2)),
  current_suit text,
  discard_top jsonb,
  draw_pile_count integer not null default 0,
  hand_count_1 integer not null default 0,
  hand_count_2 integer not null default 0,
  pending_draw integer not null default 0,
  winner smallint,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index prsi_sessions_table_idx on prsi_sessions (table_id, status, created_at desc);

create table prsi_private (
  session_id uuid primary key references prsi_sessions(id) on delete cascade,
  player1_token uuid not null default gen_random_uuid(),
  player2_token uuid,
  hand1 jsonb not null default '[]'::jsonb,
  hand2 jsonb not null default '[]'::jsonb,
  draw_pile jsonb not null default '[]'::jsonb,
  discard_pile jsonb not null default '[]'::jsonb
);

alter table prsi_sessions enable row level security;
alter table prsi_private enable row level security;

-- prsi_sessions neobsahuje zadna tajemstvi, takze verejne cteni (a tedy
-- i Realtime pro oba hrace) je v poradku. Zapis jde jen pres funkce nize.
create policy prsi_sessions_select_public on prsi_sessions for select using (true);

-- prsi_private zamerne nema zadnou policy => anon/authenticated nema pristup
-- vubec (RLS bez politik = zadny pristup). SECURITY DEFINER funkce bezi pod
-- vlastnikem funkce a RLS obejdou, stejne jako submit_game_score u game_scores.

alter publication supabase_realtime add table prsi_sessions;

-- Sestavi a zamicha novy 32listovy balicek (7,8,9,10,J,Q,K,A x 4 barvy).
create or replace function prsi_new_shuffled_deck()
returns jsonb
language plpgsql
as $function$
declare
  v_ranks text[] := array['7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
  v_suits text[] := array['S', 'H', 'D', 'C'];
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
$function$;

-- Zalozi novou hru Prsi pro stul (podle qr_token). Rozda 4 karty prvnimu
-- hraci, zbytek necha jako talon a ceka na druheho hrace (prsi_join_game).
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

-- Najde nejnovejsi hru "waiting" na danem stole, aby se k ni mohl pripojit
-- druhy host bez toho, aby si museli posilat kod - jsou u stejneho stolu.
create or replace function prsi_find_waiting_game(p_qr_token text)
returns json
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_table tables%rowtype;
  v_session prsi_sessions%rowtype;
begin
  select * into v_table from tables where qr_token = p_qr_token and is_active = true;
  if not found then
    return null;
  end if;

  select * into v_session
  from prsi_sessions
  where table_id = v_table.id and status = 'waiting' and created_at > now() - interval '30 minutes'
  order by created_at desc
  limit 1;

  if not found then
    return null;
  end if;

  return json_build_object('session_id', v_session.id, 'created_at', v_session.created_at);
end;
$function$;

-- Druhy host se pripoji k cekajici hre - rozda mu 4 karty a otoci prvni
-- kartu na odkladaci hromadku. Pokud vyjde Spodek (divoka karta), zamicha
-- a zkusi znovu, aby prvni tah nezacinal nesmyslne "hraj cokoliv".
create or replace function prsi_join_game(p_session_id uuid, p_qr_token text)
returns json
language plpgsql
security definer
set search_path to 'public'
as $function$
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

  -- Otoc prvni kartu; pokud je to Spodek (divoka), dej ji na spodek talonu
  -- a zkus dalsi - at hra nezacina nedefinovanym stavem. v_guard hlida, aby
  -- se smycka nikdy nezacyklila (i kdyby talon obsahoval samé Spodky).
  declare
    v_guard integer := 0;
    v_len integer := jsonb_array_length(v_rest);
  begin
    while v_len > 0 and (v_rest->0->>'rank') = 'J' and v_guard < v_len loop
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
$function$;

-- Vrati JEN ruku volajiciho (overenou tajnym tokenem) - nikdy ruku soupere.
create or replace function prsi_get_my_hand(p_session_id uuid, p_player_token uuid)
returns json
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_priv prsi_private%rowtype;
  v_player_no smallint;
  v_hand jsonb;
begin
  select * into v_priv from prsi_private where session_id = p_session_id;
  if not found then
    return null;
  end if;

  if v_priv.player1_token = p_player_token then
    v_player_no := 1;
    v_hand := v_priv.hand1;
  elsif v_priv.player2_token = p_player_token then
    v_player_no := 2;
    v_hand := v_priv.hand2;
  else
    return null;
  end if;

  return json_build_object('player_no', v_player_no, 'hand', v_hand);
end;
$function$;

-- Zamicha odhozene karty (krome vrchni) zpatky do talonu, kdyz talon dojde.
create or replace function prsi_reshuffle_if_needed(p_priv prsi_private, p_top jsonb)
returns prsi_private
language plpgsql
as $function$
declare
  v_priv prsi_private := p_priv;
  v_shuffled jsonb;
begin
  if jsonb_array_length(v_priv.draw_pile) > 0 then
    return v_priv;
  end if;
  if jsonb_array_length(v_priv.discard_pile) = 0 then
    return v_priv;
  end if;

  select coalesce(jsonb_agg(elem order by random()), '[]'::jsonb)
  into v_shuffled
  from jsonb_array_elements(v_priv.discard_pile) elem;

  v_priv.draw_pile := v_shuffled;
  v_priv.discard_pile := '[]'::jsonb;
  return v_priv;
end;
$function$;

-- Odehraje kartu. Overi, ze je hrac na tahu, ze kartu skutecne ma v ruce
-- a ze smi byt zahrana (barva/hodnota vrchni karty, nebo Spodek jako divoka
-- karta, nebo - pokud nekdo dluzi trest za sedmu - jen dalsi sedma). Aplikuje
-- efekty (7 = soupeř lici 2 navic a muze stackovat dalsi sedmou, Eso =
-- soupeř je preskocen, Spodek = hrac urci novou pozadovanou barvu).
create or replace function prsi_play_card(p_session_id uuid, p_player_token uuid, p_card jsonb, p_declared_suit text default null)
returns json
language plpgsql
security definer
set search_path to 'public'
as $function$
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
    v_valid := (p_card->>'rank') = 'J'
      or (p_card->>'suit') = v_required_suit
      or (p_card->>'rank') = (v_session.discard_top->>'rank');
  end if;

  if not v_valid then
    return json_build_object('ok', false, 'reason', 'card_not_playable');
  end if;

  if (p_card->>'rank') = 'J' and (p_declared_suit is null or p_declared_suit not in ('S', 'H', 'D', 'C')) then
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
  elsif (p_card->>'rank') = 'A' then
    v_next_turn := v_player_no; -- Eso: soupeř je preskocen, hrac pokracuje.
  end if;

  update prsi_sessions
  set discard_top = p_card,
      current_suit = case when (p_card->>'rank') = 'J' then p_declared_suit else null end,
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
$function$;

-- Licuje karty (1, nebo vic pri dluzenem trestu za sedmu) a preda tah.
create or replace function prsi_draw_card(p_session_id uuid, p_player_token uuid)
returns json
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_session prsi_sessions%rowtype;
  v_priv prsi_private%rowtype;
  v_player_no smallint;
  v_hand jsonb;
  v_count integer;
  v_drawn jsonb;
  v_rest jsonb;
  v_next_turn smallint;
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

  v_count := greatest(1, v_session.pending_draw);

  v_priv := prsi_reshuffle_if_needed(v_priv, v_session.discard_top);

  v_count := least(v_count, jsonb_array_length(v_priv.draw_pile));
  v_drawn := (select coalesce(jsonb_agg(elem), '[]'::jsonb) from (select elem from jsonb_array_elements(v_priv.draw_pile) elem limit v_count) s(elem));
  v_rest := (select coalesce(jsonb_agg(elem), '[]'::jsonb) from (select elem from jsonb_array_elements(v_priv.draw_pile) with ordinality e(elem, i) where i > v_count) s(elem));

  v_hand := v_hand || v_drawn;
  v_next_turn := case when v_player_no = 1 then 2 else 1 end;

  update prsi_private
  set hand1 = case when v_player_no = 1 then v_hand else hand1 end,
      hand2 = case when v_player_no = 2 then v_hand else hand2 end,
      draw_pile = v_rest,
      discard_pile = v_priv.discard_pile
  where session_id = p_session_id;

  update prsi_sessions
  set pending_draw = 0,
      current_turn = v_next_turn,
      draw_pile_count = jsonb_array_length(v_rest),
      hand_count_1 = case when v_player_no = 1 then jsonb_array_length(v_hand) else hand_count_1 end,
      hand_count_2 = case when v_player_no = 2 then jsonb_array_length(v_hand) else hand_count_2 end,
      updated_at = now()
  where id = p_session_id;

  return json_build_object('ok', true, 'drawn_count', v_count);
end;
$function$;
