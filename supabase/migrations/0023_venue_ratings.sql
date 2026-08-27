-- StulHraje - hodnoceni podniku hostem (masterplan, "co zbyva": hodnoceni).
-- Host u stolu muze anonymne ohodnotit navstevu 1-5 hvezdickami + volitelny
-- komentar. Zadna registrace, zadne ucty (kapitola 9/Etapa 9 porad neni
-- hotova) - jen jednoduchy formular na strance stolu.
--
-- Stejny bezpecnostni vzor jako u orders/game_scores: host (anon) nema
-- zadny primy pristup k tabulce venue_ratings, jen pres SECURITY DEFINER
-- funkci submit_venue_rating, ktera si sama overi platnost qr_token stolu.
-- Personal/majitel hospody (is_venue_staff) vidi jednotliva hodnoceni i
-- komentare pres RLS select policy - stejny vzor jako orders_select_staff.
-- Souhrn (prumer + pocet) je verejny pres get_venue_rating_summary, aby ho
-- mohla zobrazit i verejna stranka stolu (bez jednotlivych komentaru).

create table if not exists venue_ratings (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid not null references venues (id) on delete cascade,
  table_id uuid not null references tables (id) on delete cascade,
  stars smallint not null check (stars between 1 and 5),
  comment text,
  created_at timestamptz not null default now()
);

create index if not exists idx_venue_ratings_venue on venue_ratings (venue_id, created_at desc);

alter table venue_ratings enable row level security;

create policy venue_ratings_select_staff on venue_ratings
for select
using (is_venue_staff(venue_id));

-- Zadna INSERT/UPDATE/DELETE policy pro nikoho - hodnoceni vznikaji vyhradne
-- pres submit_venue_rating nize (stejny vzor jako submit_order).

create or replace function submit_venue_rating(p_qr_token text, p_stars integer, p_comment text default null)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_table tables%rowtype;
begin
  select * into v_table from tables where qr_token = p_qr_token and is_active = true;
  if not found then
    return json_build_object('ok', false, 'reason', 'invalid_table');
  end if;

  if p_stars is null or p_stars < 1 or p_stars > 5 then
    return json_build_object('ok', false, 'reason', 'invalid_stars');
  end if;

  insert into venue_ratings (venue_id, table_id, stars, comment)
  values (v_table.venue_id, v_table.id, p_stars, nullif(left(trim(both from coalesce(p_comment, '')), 500), ''));

  return json_build_object('ok', true);
end;
$$;

revoke all on function submit_venue_rating(text, integer, text) from public;
grant execute on function submit_venue_rating(text, integer, text) to anon, authenticated;

-- Verejny souhrn (prumer + pocet) - bez komentaru, aby ho mohla zobrazit
-- verejna stranka stolu i pred vyplnenim formulare.
create or replace function get_venue_rating_summary(p_qr_token text)
returns json
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_table tables%rowtype;
  v_avg numeric;
  v_count integer;
begin
  select * into v_table from tables where qr_token = p_qr_token and is_active = true;
  if not found then
    return null;
  end if;

  select round(avg(stars)::numeric, 1), count(*)
  into v_avg, v_count
  from venue_ratings
  where venue_id = v_table.venue_id;

  return json_build_object('avg_stars', coalesce(v_avg, 0), 'count', coalesce(v_count, 0));
end;
$$;

revoke all on function get_venue_rating_summary(text) from public;
grant execute on function get_venue_rating_summary(text) to anon, authenticated;
