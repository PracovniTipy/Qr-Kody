-- StulHraje - Etapa 4 (rozsireni): "Poker" (Texas Hold'em) pro az 8 hostu u
-- stejneho stolu, kazdy na svem telefonu. Stejny bezpecnostni vzor jako Prsi
-- (0014/0015): verejny stav (kdo sedi, kolik ma zetonu, kdo je na tahu, pot,
-- spolecne karty...) je v poker_sessions/poker_players a smi ho cist kdokoli
-- (i pres Realtime). Skutecne karty v ruce a tajne tokeny hracu jsou
-- v poker_private, ktera nema zadne RLS politiky (= zadny pristup pro
-- anon/authenticated), jen SECURITY DEFINER funkce nize.
--
-- Na rozdil od Prsi, kde byl token primo sloupcem ve verejne cetelne tabulce
-- (tam zadny problem, protoze Prsi mela jen 2 hrace a zadnou "kdo sedi"
-- tabulku), tady je poker_players verejne cetelna KVULI zobrazeni stavu
-- vsech hracu u stolu (zasoby zetonu, jestli slozil karty...) - proto tokeny
-- musi byt oddelene v poker_private.seat_tokens (mapa seat_no -> token),
-- jinak by kdokoli pres REST/Realtime videl cizi tajny token a mohl by za
-- nej hrat.
--
-- Klasicky 52listovy balicek (2-10, J, Q, K, A x 4 barvy) - na rozdil od
-- Prsi tady jde o Texas Hold'em, ktery se hraje s mezinarodnim balickem, ne
-- s ceskym marasovym.
--
-- Zetony jsou jen herni (zadne skutecne penize). Kazdy hrac zacina se
-- stejnym poctem zetonu (starting_chips), hraje se "na vyrazovani" - kdo
-- prijde o vsechny zetony, je out; hra konci, kdyz zbyde jediny hrac se
-- zetony (winner_seat).

create table poker_sessions (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid not null references venues(id) on delete cascade,
  table_id uuid not null references tables(id) on delete cascade,
  status text not null default 'waiting' check (status in ('waiting', 'playing', 'finished')),
  stage text not null default 'preflop' check (stage in ('preflop', 'flop', 'turn', 'river', 'showdown')),
  max_players smallint not null default 8,
  small_blind integer not null default 10,
  big_blind integer not null default 20,
  starting_chips integer not null default 1000,
  dealer_seat smallint,
  to_act_seat smallint,
  current_bet integer not null default 0,
  min_raise integer not null default 20,
  pot integer not null default 0,
  community_cards jsonb not null default '[]'::jsonb,
  hand_number integer not null default 0,
  last_result jsonb,
  winner_seat smallint,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index poker_sessions_table_idx on poker_sessions (table_id, status, created_at desc);

create table poker_players (
  session_id uuid not null references poker_sessions(id) on delete cascade,
  seat_no smallint not null,
  chips integer not null default 1000,
  bet_this_round integer not null default 0,
  committed_this_hand integer not null default 0,
  status text not null default 'active' check (status in ('active', 'folded', 'all_in', 'out')),
  acted_this_round boolean not null default false,
  created_at timestamptz not null default now(),
  primary key (session_id, seat_no)
);

create table poker_private (
  session_id uuid primary key references poker_sessions(id) on delete cascade,
  deck jsonb not null default '[]'::jsonb,
  hole_cards jsonb not null default '{}'::jsonb,
  seat_tokens jsonb not null default '{}'::jsonb
);

alter table poker_sessions enable row level security;
alter table poker_players enable row level security;
alter table poker_private enable row level security;

create policy poker_sessions_select_public on poker_sessions for select using (true);
create policy poker_players_select_public on poker_players for select using (true);
-- poker_private zamerne bez politik - viz komentar na zacatku souboru.

alter publication supabase_realtime add table poker_sessions;
alter publication supabase_realtime add table poker_players;

-- ---------------------------------------------------------------------
-- Pomocne funkce: balicek, hodnoceni ruky, rotace mist u stolu
-- ---------------------------------------------------------------------

create or replace function poker_new_shuffled_deck()
returns jsonb
language plpgsql
set search_path to 'public'
as $function$
declare
  v_ranks text[] := array['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
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

create or replace function poker_hand_rank_value(p_rank text)
returns integer
language sql
immutable
as $function$
  select case p_rank
    when 'J' then 11
    when 'Q' then 12
    when 'K' then 13
    when 'A' then 14
    else p_rank::integer
  end
$function$;

-- Ohodnoti presne 5 karet a vrati porovnatelne pole [kategorie, t1..t5]
-- (vyssi kategorie/tiebreaky = lepsi ruka; pole se da porovnavat primo
-- operatorem >, protoze Postgres umi lexikograficke porovnani integer[]).
-- Kategorie: 8 postupka v barve, 7 ctverice, 6 full house, 5 barva,
-- 4 postupka, 3 trojice, 2 dve dvojice, 1 par, 0 vysoka karta.
create or replace function poker_evaluate_5(p_cards jsonb)
returns integer[]
language plpgsql
set search_path to 'public'
as $function$
declare
  v_ranks integer[];
  v_suits text[];
  v_is_flush boolean;
  v_is_straight boolean := false;
  v_straight_high integer;
  v_distinct_desc integer[];
  v_count_list integer[];
  v_rank_by_count integer[];
  v_category integer;
  v_tie integer[] := array[0, 0, 0, 0, 0];
  i integer;
begin
  select array_agg(poker_hand_rank_value(elem ->> 'rank') order by poker_hand_rank_value(elem ->> 'rank') desc),
         array_agg(elem ->> 'suit')
  into v_ranks, v_suits
  from jsonb_array_elements(p_cards) elem;

  v_is_flush := (select count(distinct s) from unnest(v_suits) s) = 1;

  select array_agg(distinct r order by r desc) into v_distinct_desc from unnest(v_ranks) r;

  if array_length(v_distinct_desc, 1) = 5 and v_distinct_desc[1] - v_distinct_desc[5] = 4 then
    v_is_straight := true;
    v_straight_high := v_distinct_desc[1];
  elsif v_distinct_desc = array[14, 5, 4, 3, 2] then
    v_is_straight := true;
    v_straight_high := 5; -- "kolo" A-2-3-4-5, eso pocita jako nizka karta
  end if;

  select array_agg(cnt order by cnt desc, rnk desc), array_agg(rnk order by cnt desc, rnk desc)
  into v_count_list, v_rank_by_count
  from (select r as rnk, count(*) as cnt from unnest(v_ranks) r group by r) s;

  if v_is_straight and v_is_flush then
    v_category := 8;
    v_tie[1] := v_straight_high;
  elsif v_count_list[1] = 4 then
    v_category := 7;
    v_tie[1] := v_rank_by_count[1];
    v_tie[2] := v_rank_by_count[2];
  elsif v_count_list[1] = 3 and v_count_list[2] = 2 then
    v_category := 6;
    v_tie[1] := v_rank_by_count[1];
    v_tie[2] := v_rank_by_count[2];
  elsif v_is_flush then
    v_category := 5;
    for i in 1..5 loop
      v_tie[i] := v_ranks[i];
    end loop;
  elsif v_is_straight then
    v_category := 4;
    v_tie[1] := v_straight_high;
  elsif v_count_list[1] = 3 then
    v_category := 3;
    v_tie[1] := v_rank_by_count[1];
    v_tie[2] := v_rank_by_count[2];
    v_tie[3] := v_rank_by_count[3];
  elsif v_count_list[1] = 2 and v_count_list[2] = 2 then
    v_category := 2;
    v_tie[1] := v_rank_by_count[1];
    v_tie[2] := v_rank_by_count[2];
    v_tie[3] := v_rank_by_count[3];
  elsif v_count_list[1] = 2 then
    v_category := 1;
    v_tie[1] := v_rank_by_count[1];
    v_tie[2] := v_rank_by_count[2];
    v_tie[3] := v_rank_by_count[3];
    v_tie[4] := v_rank_by_count[4];
  else
    v_category := 0;
    for i in 1..5 loop
      v_tie[i] := v_ranks[i];
    end loop;
  end if;

  return array[v_category, v_tie[1], v_tie[2], v_tie[3], v_tie[4], v_tie[5]];
end;
$function$;

-- Najde nejlepsi 5karetni kombinaci ze 7 karet (2 v ruce + 5 spolecnych).
create or replace function poker_best_of_7(p_cards jsonb)
returns integer[]
language plpgsql
set search_path to 'public'
as $function$
declare
  v_cards jsonb[];
  v_n integer;
  v_best integer[] := array[-1, 0, 0, 0, 0, 0];
  v_score integer[];
  i integer;
  j integer;
  k integer;
  l integer;
  m integer;
begin
  select array_agg(elem) into v_cards from jsonb_array_elements(p_cards) elem;
  v_n := coalesce(array_length(v_cards, 1), 0);
  if v_n < 5 then
    return v_best;
  end if;

  for i in 1..v_n - 4 loop
    for j in i + 1..v_n - 3 loop
      for k in j + 1..v_n - 2 loop
        for l in k + 1..v_n - 1 loop
          for m in l + 1..v_n loop
            v_score := poker_evaluate_5(jsonb_build_array(v_cards[i], v_cards[j], v_cards[k], v_cards[l], v_cards[m]));
            if v_score > v_best then
              v_best := v_score;
            end if;
          end loop;
        end loop;
      end loop;
    end loop;
  end loop;

  return v_best;
end;
$function$;

-- Nejblizsi misto v poli mist p_seats "za" p_after (cyklicky) - pouziva se
-- pro rotaci dealera/blindu, ktera se ridi jen tim, kdo ma jeste zetony
-- (bez ohledu na to, jestli aktualne slozil v predchozim kole).
create or replace function poker_next_seat_in(p_seats smallint[], p_after smallint)
returns smallint
language sql
immutable
as $function$
  select coalesce(
    (select s from unnest(p_seats) s where s > p_after order by s limit 1),
    (select s from unnest(p_seats) s order by s limit 1)
  )
$function$;

-- Dalsi hrac se statusem 'active' (tj. muze jeste v tomto kole sazeni
-- rozhodovat) po danem miste, cyklicky. Vraci null, pokud takovy hrac
-- v dane hre neni (vsichni ostatni slozili nebo jsou all-in).
create or replace function poker_next_active_seat(p_session_id uuid, p_after smallint)
returns smallint
language sql
stable
set search_path to 'public'
as $function$
  select coalesce(
    (select seat_no from poker_players
      where session_id = p_session_id and status = 'active' and seat_no > coalesce(p_after, 0)
      order by seat_no limit 1),
    (select seat_no from poker_players
      where session_id = p_session_id and status = 'active'
      order by seat_no limit 1)
  )
$function$;

-- Najde misto hrace podle jeho tajneho tokenu (nebo null, kdyz token
-- nesedi na zadne misto v teto hre).
create or replace function poker_seat_for_token(p_session_id uuid, p_player_token uuid)
returns smallint
language sql
stable
security definer
set search_path to 'public'
as $function$
  select (kv.key)::smallint
  from poker_private pp, jsonb_each_text(pp.seat_tokens) kv
  where pp.session_id = p_session_id and kv.value = p_player_token::text
  limit 1
$function$;

-- ---------------------------------------------------------------------
-- Verejne RPC funkce (volane z klienta)
-- ---------------------------------------------------------------------

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

create or replace function poker_find_waiting_game(p_qr_token text)
returns json
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_table tables%rowtype;
  v_session_id uuid;
  v_seat_count integer;
begin
  select * into v_table from tables where qr_token = p_qr_token and is_active = true;
  if not found then
    return null;
  end if;

  select ps.id into v_session_id
  from poker_sessions ps
  where ps.table_id = v_table.id
    and ps.status = 'waiting'
    and ps.created_at > now() - interval '3 hours'
    and (select count(*) from poker_players pp where pp.session_id = ps.id) < ps.max_players
  order by ps.created_at desc
  limit 1;

  if v_session_id is null then
    return null;
  end if;

  select count(*) into v_seat_count from poker_players where session_id = v_session_id;

  return json_build_object('session_id', v_session_id, 'seat_count', v_seat_count);
end;
$function$;

create or replace function poker_join_game(p_session_id uuid, p_qr_token text)
returns json
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_table tables%rowtype;
  v_session poker_sessions%rowtype;
  v_seat_count integer;
  v_next_seat smallint;
  v_token uuid := gen_random_uuid();
begin
  select * into v_table from tables where qr_token = p_qr_token and is_active = true;
  if not found then
    return json_build_object('ok', false, 'reason', 'invalid_table');
  end if;

  select * into v_session from poker_sessions where id = p_session_id and table_id = v_table.id for update;
  if not found or v_session.status <> 'waiting' then
    return json_build_object('ok', false, 'reason', 'not_waiting');
  end if;

  select count(*), coalesce(max(seat_no), 0) + 1 into v_seat_count, v_next_seat
  from poker_players where session_id = p_session_id;

  if v_seat_count >= v_session.max_players then
    return json_build_object('ok', false, 'reason', 'full');
  end if;

  insert into poker_players (session_id, seat_no, chips) values (p_session_id, v_next_seat, v_session.starting_chips);

  update poker_private
  set seat_tokens = seat_tokens || jsonb_build_object(v_next_seat::text, v_token::text)
  where session_id = p_session_id;

  return json_build_object('ok', true, 'player_token', v_token, 'seat_no', v_next_seat);
end;
$function$;

create or replace function poker_get_my_cards(p_session_id uuid, p_player_token uuid)
returns json
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_seat smallint;
  v_priv poker_private%rowtype;
begin
  v_seat := poker_seat_for_token(p_session_id, p_player_token);
  if v_seat is null then
    return null;
  end if;

  select * into v_priv from poker_private where session_id = p_session_id;
  if not found then
    return json_build_object('seat_no', v_seat, 'cards', '[]'::jsonb);
  end if;

  return json_build_object('seat_no', v_seat, 'cards', coalesce(v_priv.hole_cards -> v_seat::text, '[]'::jsonb));
end;
$function$;

-- Rozda novou ruku: rotuje dealera, zapocita sliby (blindy), rozda karty.
-- Kdyz zbyde min nez 2 hraci se zetony, hru rovnou ukonci (winner_seat).
create or replace function poker_deal_hand(p_session_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_session poker_sessions%rowtype;
  v_active_seats smallint[];
  v_new_dealer smallint;
  v_sb_seat smallint;
  v_bb_seat smallint;
  v_deck jsonb;
  v_hole jsonb := '{}'::jsonb;
  v_seat smallint;
  v_cards jsonb;
  v_sb_amt integer;
  v_bb_amt integer;
begin
  select * into v_session from poker_sessions where id = p_session_id for update;

  update poker_players set status = 'out' where session_id = p_session_id and chips = 0;

  select array_agg(seat_no order by seat_no) into v_active_seats
  from poker_players where session_id = p_session_id and chips > 0;

  if v_active_seats is null or array_length(v_active_seats, 1) < 2 then
    update poker_sessions
    set status = 'finished',
        stage = 'showdown',
        to_act_seat = null,
        winner_seat = (select seat_no from poker_players where session_id = p_session_id and chips > 0 limit 1),
        updated_at = now()
    where id = p_session_id;
    return;
  end if;

  update poker_players
  set status = 'active', bet_this_round = 0, committed_this_hand = 0, acted_this_round = false
  where session_id = p_session_id and seat_no = any(v_active_seats);

  v_new_dealer := poker_next_seat_in(v_active_seats, coalesce(v_session.dealer_seat, 0));

  if array_length(v_active_seats, 1) = 2 then
    -- U dvou hracu tradicne dealer (button) sklada maly slib, druhy velky.
    v_sb_seat := v_new_dealer;
    v_bb_seat := (select s from unnest(v_active_seats) s where s <> v_new_dealer limit 1);
  else
    v_sb_seat := poker_next_seat_in(v_active_seats, v_new_dealer);
    v_bb_seat := poker_next_seat_in(v_active_seats, v_sb_seat);
  end if;

  v_deck := poker_new_shuffled_deck();

  foreach v_seat in array v_active_seats loop
    v_cards := (select coalesce(jsonb_agg(elem), '[]'::jsonb) from (select elem from jsonb_array_elements(v_deck) elem limit 2) s(elem));
    v_deck := (select coalesce(jsonb_agg(elem), '[]'::jsonb) from (select elem from jsonb_array_elements(v_deck) with ordinality e(elem, i) where i > 2) s(elem));
    v_hole := v_hole || jsonb_build_object(v_seat::text, v_cards);
  end loop;

  update poker_private set deck = v_deck, hole_cards = v_hole where session_id = p_session_id;

  select chips into v_sb_amt from poker_players where session_id = p_session_id and seat_no = v_sb_seat;
  v_sb_amt := least(v_session.small_blind, v_sb_amt);
  select chips into v_bb_amt from poker_players where session_id = p_session_id and seat_no = v_bb_seat;
  v_bb_amt := least(v_session.big_blind, v_bb_amt);

  update poker_players
  set chips = chips - v_sb_amt,
      bet_this_round = v_sb_amt,
      committed_this_hand = v_sb_amt,
      status = case when chips - v_sb_amt <= 0 then 'all_in' else status end
  where session_id = p_session_id and seat_no = v_sb_seat;

  update poker_players
  set chips = chips - v_bb_amt,
      bet_this_round = v_bb_amt,
      committed_this_hand = v_bb_amt,
      status = case when chips - v_bb_amt <= 0 then 'all_in' else status end
  where session_id = p_session_id and seat_no = v_bb_seat;

  update poker_sessions
  set hand_number = hand_number + 1,
      dealer_seat = v_new_dealer,
      stage = 'preflop',
      community_cards = '[]'::jsonb,
      current_bet = greatest(v_sb_amt, v_bb_amt),
      min_raise = v_session.big_blind,
      pot = v_sb_amt + v_bb_amt,
      last_result = null,
      winner_seat = null,
      to_act_seat = poker_next_active_seat(p_session_id, v_bb_seat),
      updated_at = now()
  where id = p_session_id;

  perform poker_advance_state(p_session_id);
end;
$function$;

-- Kdyz slozi vsichni krome jednoho, ten jeden bere cely pot bez ukazovani karet.
create or replace function poker_finish_hand_fold(p_session_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_winner_seat smallint;
  v_pot integer;
begin
  select seat_no into v_winner_seat
  from poker_players where session_id = p_session_id and status in ('active', 'all_in') limit 1;

  select coalesce(sum(committed_this_hand), 0) into v_pot from poker_players where session_id = p_session_id;

  update poker_players set chips = chips + v_pot where session_id = p_session_id and seat_no = v_winner_seat;

  update poker_sessions
  set stage = 'showdown',
      to_act_seat = null,
      last_result = jsonb_build_object('type', 'fold_win', 'winner_seats', jsonb_build_array(v_winner_seat), 'amount', v_pot),
      updated_at = now()
  where id = p_session_id;
end;
$function$;

-- Vyhodnoti karty vsech zbylych hracu, rozdeli pot (vcetne vedlejsich potu
-- pro pripad, ze nekdo byl all-in za mene) a ulozi vysledek do last_result.
create or replace function poker_showdown(p_session_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_priv poker_private%rowtype;
  v_community jsonb;
  v_levels integer[];
  v_prev integer := 0;
  v_level integer;
  v_layer_amount integer;
  v_eligible_seats smallint[];
  v_best_score integer[];
  v_winners smallint[];
  v_share integer;
  v_remainder integer;
  v_reveals jsonb := '[]'::jsonb;
  v_pots jsonb := '[]'::jsonb;
  i integer;
begin
  select * into v_priv from poker_private where session_id = p_session_id;
  select community_cards into v_community from poker_sessions where id = p_session_id;

  create temporary table if not exists tmp_poker_scores (seat_no smallint primary key, score integer[]) on commit drop;
  delete from tmp_poker_scores;

  insert into tmp_poker_scores (seat_no, score)
  select pp.seat_no, poker_best_of_7(coalesce(v_priv.hole_cards -> pp.seat_no::text, '[]'::jsonb) || v_community)
  from poker_players pp
  where pp.session_id = p_session_id and pp.status in ('active', 'all_in');

  select coalesce(jsonb_agg(jsonb_build_object(
           'seat', t.seat_no,
           'cards', v_priv.hole_cards -> t.seat_no::text,
           'category', t.score[1]
         ) order by t.seat_no), '[]'::jsonb)
  into v_reveals
  from tmp_poker_scores t;

  select array_agg(distinct committed_this_hand order by committed_this_hand)
  into v_levels
  from poker_players where session_id = p_session_id and committed_this_hand > 0;

  foreach v_level in array coalesce(v_levels, array[]::integer[]) loop
    select coalesce(sum(least(committed_this_hand, v_level) - least(committed_this_hand, v_prev)), 0)
    into v_layer_amount
    from poker_players where session_id = p_session_id;

    if v_layer_amount > 0 then
      select array_agg(pp.seat_no) into v_eligible_seats
      from poker_players pp
      where pp.session_id = p_session_id and pp.status in ('active', 'all_in') and pp.committed_this_hand >= v_level;

      if v_eligible_seats is not null and array_length(v_eligible_seats, 1) > 0 then
        select max(score) into v_best_score from tmp_poker_scores where seat_no = any(v_eligible_seats);
        select array_agg(seat_no order by seat_no) into v_winners
        from tmp_poker_scores where seat_no = any(v_eligible_seats) and score = v_best_score;

        v_share := v_layer_amount / array_length(v_winners, 1);
        v_remainder := v_layer_amount % array_length(v_winners, 1);

        for i in 1..array_length(v_winners, 1) loop
          update poker_players
          set chips = chips + v_share + (case when i = 1 then v_remainder else 0 end)
          where session_id = p_session_id and seat_no = v_winners[i];
        end loop;

        v_pots := v_pots || jsonb_build_array(jsonb_build_object(
          'amount', v_layer_amount, 'winners', to_jsonb(v_winners), 'eligible_seats', to_jsonb(v_eligible_seats)
        ));
      end if;
    end if;

    v_prev := v_level;
  end loop;

  update poker_sessions
  set stage = 'showdown',
      to_act_seat = null,
      last_result = jsonb_build_object('type', 'showdown', 'pots', v_pots, 'reveals', v_reveals),
      updated_at = now()
  where id = p_session_id;
end;
$function$;

-- Hlavni motor kola sazeni: po kazde akci zkontroluje, jestli je kolo
-- sazeni hotove (vsichni "active" hraci se srovnali na stejnou sazku a uz
-- meli tah), a pokud ano, bud rozda dalsi spolecnou kartu (flop/turn/river),
-- nebo (po riveru) spusti showdown. Kdyz zbyde min nez 2 hrace, kteri jeste
-- muzou sazet (ostatni jsou all-in), rozdava dalsi karty automaticky bez
-- cekani na tah - dal uz totiz neni o cem rozhodovat.
create or replace function poker_advance_state(p_session_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_session poker_sessions%rowtype;
  v_contesting integer;
  v_active integer;
  v_unsettled integer;
  v_next smallint;
  v_priv poker_private%rowtype;
  v_deal jsonb;
  v_rest jsonb;
  v_n integer;
begin
  loop
    select * into v_session from poker_sessions where id = p_session_id for update;

    select count(*) into v_contesting from poker_players where session_id = p_session_id and status in ('active', 'all_in');
    if v_contesting <= 1 then
      perform poker_finish_hand_fold(p_session_id);
      return;
    end if;

    select count(*) into v_active from poker_players where session_id = p_session_id and status = 'active';

    if v_active >= 2 then
      select count(*) into v_unsettled
      from poker_players
      where session_id = p_session_id and status = 'active'
        and (acted_this_round = false or bet_this_round <> v_session.current_bet);

      if v_unsettled > 0 then
        v_next := poker_next_active_seat(p_session_id, v_session.to_act_seat);
        update poker_sessions set to_act_seat = v_next, updated_at = now() where id = p_session_id;
        return;
      end if;
    end if;

    -- Kolo sazeni je hotove (bud se vsichni srovnali, nebo uz nema kdo sazet).
    if v_session.stage = 'river' then
      perform poker_showdown(p_session_id);
      return;
    end if;

    select * into v_priv from poker_private where session_id = p_session_id for update;
    v_n := case when v_session.stage = 'preflop' then 3 else 1 end;
    v_deal := (select coalesce(jsonb_agg(elem), '[]'::jsonb) from (select elem from jsonb_array_elements(v_priv.deck) elem limit v_n) s(elem));
    v_rest := (select coalesce(jsonb_agg(elem), '[]'::jsonb) from (select elem from jsonb_array_elements(v_priv.deck) with ordinality e(elem, i) where i > v_n) s(elem));

    update poker_private set deck = v_rest where session_id = p_session_id;

    update poker_sessions
    set community_cards = community_cards || v_deal,
        stage = case v_session.stage
          when 'preflop' then 'flop'
          when 'flop' then 'turn'
          when 'turn' then 'river'
        end,
        current_bet = 0,
        min_raise = v_session.big_blind,
        updated_at = now()
    where id = p_session_id;

    update poker_players
    set bet_this_round = 0, acted_this_round = false
    where session_id = p_session_id and status in ('active', 'all_in');

    if v_active >= 2 then
      v_next := poker_next_active_seat(p_session_id, v_session.dealer_seat);
      update poker_sessions set to_act_seat = v_next, updated_at = now() where id = p_session_id;
      return;
    end if;
    -- jinak (< 2 hraci, kteri jeste muzou sazet) smycka pokracuje a rozda dalsi kolo automaticky
  end loop;
end;
$function$;

create or replace function poker_start_game(p_session_id uuid, p_player_token uuid)
returns json
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_session poker_sessions%rowtype;
  v_seat_count integer;
begin
  select * into v_session from poker_sessions where id = p_session_id for update;
  if not found or v_session.status <> 'waiting' then
    return json_build_object('ok', false, 'reason', 'not_waiting');
  end if;

  if poker_seat_for_token(p_session_id, p_player_token) is null then
    return json_build_object('ok', false, 'reason', 'invalid_token');
  end if;

  select count(*) into v_seat_count from poker_players where session_id = p_session_id;
  if v_seat_count < 2 then
    return json_build_object('ok', false, 'reason', 'need_players');
  end if;

  update poker_sessions set status = 'playing', updated_at = now() where id = p_session_id;

  perform poker_deal_hand(p_session_id);

  return json_build_object('ok', true);
end;
$function$;

create or replace function poker_next_hand(p_session_id uuid, p_player_token uuid)
returns json
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_session poker_sessions%rowtype;
begin
  select * into v_session from poker_sessions where id = p_session_id for update;
  if not found or v_session.status <> 'playing' or v_session.stage <> 'showdown' then
    return json_build_object('ok', false, 'reason', 'not_ready');
  end if;

  if poker_seat_for_token(p_session_id, p_player_token) is null then
    return json_build_object('ok', false, 'reason', 'invalid_token');
  end if;

  perform poker_deal_hand(p_session_id);

  return json_build_object('ok', true);
end;
$function$;

create or replace function poker_player_action(
  p_session_id uuid,
  p_player_token uuid,
  p_action text,
  p_amount integer default null
)
returns json
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_session poker_sessions%rowtype;
  v_seat smallint;
  v_player poker_players%rowtype;
  v_call_amount integer;
  v_min_bet integer;
  v_delta integer;
  v_new_min_raise integer;
begin
  select * into v_session from poker_sessions where id = p_session_id for update;
  if not found or v_session.status <> 'playing' or v_session.stage = 'showdown' then
    return json_build_object('ok', false, 'reason', 'not_playing');
  end if;

  v_seat := poker_seat_for_token(p_session_id, p_player_token);
  if v_seat is null then
    return json_build_object('ok', false, 'reason', 'invalid_token');
  end if;

  if v_session.to_act_seat is null or v_session.to_act_seat <> v_seat then
    return json_build_object('ok', false, 'reason', 'not_your_turn');
  end if;

  select * into v_player from poker_players where session_id = p_session_id and seat_no = v_seat for update;
  if v_player.status <> 'active' then
    return json_build_object('ok', false, 'reason', 'not_active');
  end if;

  if p_action = 'fold' then
    update poker_players set status = 'folded', acted_this_round = true
    where session_id = p_session_id and seat_no = v_seat;

  elsif p_action = 'check' then
    if v_player.bet_this_round <> v_session.current_bet then
      return json_build_object('ok', false, 'reason', 'must_call');
    end if;
    update poker_players set acted_this_round = true where session_id = p_session_id and seat_no = v_seat;

  elsif p_action = 'call' then
    v_call_amount := least(v_session.current_bet - v_player.bet_this_round, v_player.chips);
    if v_call_amount <= 0 then
      return json_build_object('ok', false, 'reason', 'nothing_to_call');
    end if;
    update poker_players
    set chips = chips - v_call_amount,
        bet_this_round = bet_this_round + v_call_amount,
        committed_this_hand = committed_this_hand + v_call_amount,
        acted_this_round = true,
        status = case when chips - v_call_amount <= 0 then 'all_in' else status end
    where session_id = p_session_id and seat_no = v_seat;

  elsif p_action in ('bet', 'raise') then
    if p_amount is null or p_amount <= 0 then
      return json_build_object('ok', false, 'reason', 'invalid_amount');
    end if;
    if p_amount > v_player.bet_this_round + v_player.chips then
      return json_build_object('ok', false, 'reason', 'not_enough_chips');
    end if;

    v_min_bet := case when v_session.current_bet = 0 then v_session.big_blind else v_session.current_bet + v_session.min_raise end;
    if p_amount < v_min_bet and p_amount < v_player.bet_this_round + v_player.chips then
      -- mensi nez minimalni sazka/raise je povoleno jen jako "vsechno" (all-in za min)
      return json_build_object('ok', false, 'reason', 'raise_too_small');
    end if;

    v_delta := p_amount - v_player.bet_this_round;
    v_new_min_raise := greatest(v_session.big_blind, p_amount - v_session.current_bet);

    update poker_players
    set chips = chips - v_delta,
        bet_this_round = p_amount,
        committed_this_hand = committed_this_hand + v_delta,
        acted_this_round = true,
        status = case when chips - v_delta <= 0 then 'all_in' else status end
    where session_id = p_session_id and seat_no = v_seat;

    update poker_players
    set acted_this_round = false
    where session_id = p_session_id and seat_no <> v_seat and status = 'active';

    update poker_sessions set current_bet = p_amount, min_raise = v_new_min_raise where id = p_session_id;

  else
    return json_build_object('ok', false, 'reason', 'invalid_action');
  end if;

  update poker_sessions
  set pot = (select coalesce(sum(committed_this_hand), 0) from poker_players where session_id = p_session_id),
      updated_at = now()
  where id = p_session_id;

  perform poker_advance_state(p_session_id);

  return json_build_object('ok', true);
end;
$function$;
