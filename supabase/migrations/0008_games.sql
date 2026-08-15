-- StůlHraje – Etapa 4 (masterplán, kapitola 11): první arkádová hra
-- "Chytání padajících surovin". Podle kapitoly 10 masterplánu nepatří do MVP
-- všech deset her najednou – tahle migrace přidává jen jednu hru se skóre,
-- žebříčkem hospody a základní ochranou proti podvádění (kapitola 9.1:
-- server kontroluje nereálné výsledky a čas, nevěří jen tomu, co pošle
-- telefon). Hráčské účty (kapitola 9, Etapa 9) zatím nejsou – žebříček je
-- anonymní, jen s dobrovolnou přezdívkou u skóre.

create table if not exists game_sessions (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid not null references venues(id) on delete cascade,
  table_id uuid not null references tables(id) on delete cascade,
  game_id text not null,
  started_at timestamptz not null default now(),
  used boolean not null default false
);

create table if not exists game_scores (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid not null references venues(id) on delete cascade,
  table_id uuid not null references tables(id) on delete cascade,
  game_id text not null,
  nickname text,
  score integer not null,
  created_at timestamptz not null default now()
);

alter table game_sessions enable row level security;
alter table game_scores enable row level security;
-- Žádná RLS policy pro anon/authenticated – veškerý přístup jde jen přes
-- SECURITY DEFINER funkce níže (stejný vzor jako orders/order_items).

create index if not exists game_scores_venue_game_score_idx
  on game_scores (venue_id, game_id, score desc);

-- start_game_session: host začíná hru, server si poznamená čas startu, aby
-- při odeslání skóre mohl ověřit, že uplynul realistický čas hraní.
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

  insert into game_sessions (venue_id, table_id, game_id)
  values (v_table.venue_id, v_table.id, p_game_id)
  returning * into v_session;

  return json_build_object('session_id', v_session.id, 'started_at', v_session.started_at);
end;
$$;

-- submit_game_score: základní ochrana proti podvádění – session lze použít
-- jen jednou, uplynulý čas musí odpovídat realistické délce hry a skóre
-- nesmí přesáhnout teoreticky dosažitelné maximum pro danou hru.
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
  v_rank integer;
begin
  select * into v_session from game_sessions where id = p_session_id;
  if not found or v_session.used then
    return json_build_object('ok', false, 'reason', 'invalid_session');
  end if;

  v_elapsed_seconds := extract(epoch from (now() - v_session.started_at));

  if v_session.game_id = 'kosik' then
    v_min_seconds := 20;
    v_max_score := 40;
  else
    return json_build_object('ok', false, 'reason', 'unknown_game');
  end if;

  if v_elapsed_seconds < v_min_seconds or v_elapsed_seconds > 600 then
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

-- get_game_leaderboard: veřejný žebříček hospody pro danou hru (bez přihlášení).
create or replace function get_game_leaderboard(p_qr_token text, p_game_id text, p_limit int default 10)
returns json
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_table tables%rowtype;
  v_scores json;
begin
  select * into v_table from tables where qr_token = p_qr_token and is_active = true;
  if not found then
    return null;
  end if;

  select coalesce(json_agg(s), '[]'::json)
  into v_scores
  from (
    select coalesce(nickname, 'Anonym') as nickname, score, created_at
    from game_scores
    where venue_id = v_table.venue_id and game_id = p_game_id
    order by score desc, created_at asc
    limit p_limit
  ) s;

  return v_scores;
end;
$$;
