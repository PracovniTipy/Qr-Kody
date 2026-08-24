-- Oprava chyby v poker_advance_state: funkce vzdy posunula to_act_seat na
-- DALSIHO hrace po soucasnem to_act_seat, coz je spravne po skutecne akci
-- (hrac, ktery prave tahl, uz ma vyresene), ale SPATNE hned po rozdani
-- (poker_deal_hand uz nastavi to_act_seat spravne na prvniho hrace na tahu -
-- ten jeste netahl, takze se "unsettled" kontrole objevi jako nevyresny a
-- funkce ho omylem preskocila na dalsiho hrace). Diky tomu prvni hrac na
-- tahu po rozdani nikdy nedostal moznost zahrat.
--
-- Oprava: pred posunutim se overi, jestli soucasny to_act_seat sam jeste
-- potrebuje zahrat (aktivni a nevyresny) - pokud ano, necha se beze zmeny;
-- jinak (uz zahral, slozil, nebo je all-in) se posune na dalsiho.

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
  v_to_act_still_unsettled boolean;
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
        select exists(
          select 1 from poker_players
          where session_id = p_session_id and seat_no = v_session.to_act_seat and status = 'active'
            and (acted_this_round = false or bet_this_round <> v_session.current_bet)
        ) into v_to_act_still_unsettled;

        if v_to_act_still_unsettled then
          -- to_act_seat uz spravne ukazuje na hrace, ktery jeste netahl - nic nemenit.
          return;
        end if;

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
