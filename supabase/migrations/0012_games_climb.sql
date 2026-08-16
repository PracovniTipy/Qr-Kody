-- StůlHraje – Etapa 4 (hra 4): "Skákání nahoru" (doodle-jump styl,
-- hospodský vizuál). Stejně jako u předchozích tří her (migrace 0009–0011)
-- je hra nekonečná a anti-cheat (kapitola 9.1) proto odvozuje maximální
-- možné skóre od uplynulého času místo pevné konstanty. Skóre roste podle
-- rychlosti posunu kamery (scrollSpeed), která se v komponentě ClimbGame
-- postupně zvyšuje z 0.05 na strop 0.16 px/ms – strop odpovídá nejvýš
-- zhruba 1 bodu za sekundu, takže max_score = elapsed_seconds * 1 + rezerva
-- je bezpečná (permisivní) horní hranice.

create or replace function submit_game_score(p_session_id uuid, p_score integer, p_nickname text)
returns json
language plpgsql
security definer
set search_path = public
as $
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
    v_min_seconds := 1.5;
    v_max_seconds := 1800;
    v_max_score := ceil(v_elapsed_seconds * 3) + 10;
  elsif v_session.game_id = 'flappy' then
    v_min_seconds := 0.2;
    v_max_seconds := 1800;
    v_max_score := ceil(v_elapsed_seconds * 1) + 5;
  elsif v_session.game_id = 'runner' then
    v_min_seconds := 0.3;
    v_max_seconds := 1800;
    v_max_score := ceil(v_elapsed_seconds * 1) + 5;
  elsif v_session.game_id = 'climb' then
    v_min_seconds := 0.5;
    v_max_seconds := 1800;
    v_max_score := ceil(v_elapsed_seconds * 1) + 5;
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
$;
