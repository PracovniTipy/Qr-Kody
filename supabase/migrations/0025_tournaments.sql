-- Turnaje (masterplán, "co zbývá": turnaje). Časově omezená soutěž v jedné
-- z arkádových her se skóre (kosik/flappy/runner/climb/breakout). Žebříček
-- turnaje je jen výřez existující tabulky game_scores (migrace 0008) podle
-- času konání turnaje - žádná nová anti-cheat logika není potřeba, skóre
-- se pořád ukládá přes submit_game_score jako dřív.

create table if not exists tournaments (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid not null references venues(id) on delete cascade,
  game_id text not null,
  name text not null,
  starts_at timestamptz not null default now(),
  ends_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists idx_tournaments_venue on tournaments (venue_id, starts_at desc);

alter table tournaments enable row level security;

create policy tournaments_select_staff on tournaments
  for select
  using (is_venue_staff(venue_id));

create policy tournaments_write_staff on tournaments
  for all
  using (is_venue_staff(venue_id))
  with check (is_venue_staff(venue_id));

-- Staff teď smí číst i syrové skóre své hospody (potřeba pro žebříček
-- turnaje v administraci) - stejný vzor jako orders_select_staff.
create policy game_scores_select_staff on game_scores
  for select
  using (is_venue_staff(venue_id));

-- get_active_tournaments: veřejný seznam aktuálně běžících turnajů hospody
-- (bez přihlášení), pro odkaz na stránce stolu.
create or replace function get_active_tournaments(p_qr_token text)
returns json
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_table tables%rowtype;
  v_result json;
begin
  select * into v_table from tables where qr_token = p_qr_token and is_active = true;
  if not found then
    return null;
  end if;

  select coalesce(json_agg(t order by t.starts_at desc), '[]'::json)
  into v_result
  from (
    select id, game_id, name, starts_at, ends_at
    from tournaments
    where venue_id = v_table.venue_id
      and starts_at <= now()
      and (ends_at is null or ends_at > now())
  ) t;

  return v_result;
end;
$$;

-- get_tournament_leaderboard: veřejný žebříček jednoho turnaje (bez
-- přihlášení) - výřez game_scores podle venue_id/game_id/času turnaje.
create or replace function get_tournament_leaderboard(p_qr_token text, p_tournament_id uuid, p_limit int default 20)
returns json
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_table tables%rowtype;
  v_tournament tournaments%rowtype;
  v_scores json;
begin
  select * into v_table from tables where qr_token = p_qr_token and is_active = true;
  if not found then
    return null;
  end if;

  select * into v_tournament from tournaments
  where id = p_tournament_id and venue_id = v_table.venue_id;
  if not found then
    return null;
  end if;

  select coalesce(json_agg(s), '[]'::json)
  into v_scores
  from (
    select coalesce(nickname, 'Anonym') as nickname, score, created_at
    from game_scores
    where venue_id = v_tournament.venue_id
      and game_id = v_tournament.game_id
      and created_at >= v_tournament.starts_at
      and created_at <= coalesce(v_tournament.ends_at, now())
    order by score desc, created_at asc
    limit p_limit
  ) s;

  return json_build_object(
    'tournament', json_build_object(
      'id', v_tournament.id,
      'game_id', v_tournament.game_id,
      'name', v_tournament.name,
      'starts_at', v_tournament.starts_at,
      'ends_at', v_tournament.ends_at,
      'is_active', v_tournament.starts_at <= now() and (v_tournament.ends_at is null or v_tournament.ends_at > now())
    ),
    'scores', v_scores
  );
end;
$$;

revoke all on function get_active_tournaments(text) from public;
grant execute on function get_active_tournaments(text) to anon, authenticated;
revoke all on function get_tournament_leaderboard(text, uuid, int) from public;
grant execute on function get_tournament_leaderboard(text, uuid, int) to anon, authenticated;
