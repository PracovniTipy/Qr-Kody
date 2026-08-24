-- Oprava chyby v 0016_games_poker.sql: pri prepisu SQL do apply_migration
-- volani omylem vypadla klauzule "where id = p_session_id" z posledniho
-- update poker_sessions v poker_player_action - takze kazda hracova akce by
-- prepsala pot UPLNE VSECH bezicich poker her (ne jen te sve). Oprava jen
-- doplnuje WHERE zpet, zbytek funkce je nezmeneny.

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
