-- Oprava chyby v poker_deal_hand: "coalesce(v_session.dealer_seat, 0)" bez
-- explicitniho typu davalo integer (ne smallint), takze volani
-- poker_next_seat_in(smallint[], smallint) selhalo na neshode typu pri
-- prvni rozdane ruce (dealer_seat je NULL pred prvni hrou). Oprava jen
-- pridava cast na smallint, zbytek funkce je nezmeneny.

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

  v_new_dealer := poker_next_seat_in(v_active_seats, coalesce(v_session.dealer_seat, 0::smallint));

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
