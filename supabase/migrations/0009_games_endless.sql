-- StůlHraje – Etapa 4 (úprava): hra "Chytání padajících surovin" teď není
-- na pevných 30 vteřin, ale nekonečná a čím dál rychlejší/těžší – končí,
-- až hráč přijde o všechny 3 životy. Anti-cheat (kapitola 9.1) proto musí
-- povolit libovolně dlouhou (rozumnou) hru a maximální skóre odvozovat od
-- uplynulého času místo pevné konstanty pro 30s kolo.

create or replace function submit_game_score(p_session_id uuid, p_score integer, p_nickname text)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session game_sessions%rowtype;
  v_elapsed_seconds numeric;
  v_max_score integer;
  v_min_seconds numeric;
  v_max_seconds numeric;
  v_rank integer;
begin
  select * into v_session from game_sessions where id = p_session_id;
  if not found or v_session.used then
    return json_build_object('ok', false, 'reason', 'invalid_session');
  end if;

  v_elapsed_seconds := extract(epoch from (now() - v_session.started_at));

  if v_session.game_id = 'kosik' then
    -- hra je nekonečná (3 životy) – i slabý hráč ji ukončí během pár
    -- vteřin, dobrý hráč může hrát dlouho. Maximum tedy není pevná
    -- konstanta, ale odvozené od uplynulého času, s velkorysou rezervou.
    v_min_seconds := 1.5;
    v_max_seconds := 1800;
    v_max_score := ceil(v_elapsed_seconds * 3) + 10;
  else
    return json_build_object('ok', false, 'reason', 'unknown_game');
  end if;

  if v_elapsed_seconds < v_min_seconds or v_elapsed_seconds > v_max_seconds then
    return json_build_object('ok', false, 'reason', 'implausible_time');
  end if;

  if p_score < 0 or p_score > v_max_score then
    return json_build_object('ok', false, 'reason', 'implausible_score');
  end if;

  update game_sessions set used = true where id = p_session_id;

  insert into game_scores (venue_id, table_id, game_id, nickname, score)
  values (v_session.venue_id, v_session.table_id, v_session.game_id, nullif(trim(coalesce(p_nickname, '')), ''), p_score);

  select count(*) + 1 into v_rank
  from game_scores
  where venue_id = v_session.venue_id and game_id = v_session.game_id and score > p_score;

  return json_build_object('ok', true, 'score', p_score, 'rank', v_rank);
end;
$$;
