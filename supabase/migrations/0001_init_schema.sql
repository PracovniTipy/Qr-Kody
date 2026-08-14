-- StůlHraje – Etapa 0: základní schéma (hospody, uživatelé, stoly, menu)
-- Řídí se kapitolou 9 a 9.1 hlavního plánu: každá tabulka s daty hospody má vazbu
-- na konkrétní hospodu a RLS pravidla, aby zaměstnanec jedné hospody nemohl vidět data jiné.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- venues
-- ---------------------------------------------------------------------------
create table if not exists venues (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  is_active boolean not null default false,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- venue_users – kdo smí spravovat kterou hospodu a v jaké roli
-- ---------------------------------------------------------------------------
create table if not exists venue_users (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid not null references venues (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null check (role in ('MAJITEL', 'MANAZER', 'OBSLUHA', 'KUCHYN', 'BAR')),
  created_at timestamptz not null default now(),
  unique (venue_id, user_id)
);

-- ---------------------------------------------------------------------------
-- tables – stoly a jejich bezpečné QR tokeny
-- ---------------------------------------------------------------------------
create table if not exists tables (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid not null references venues (id) on delete cascade,
  label text not null,
  qr_token text not null unique default encode(gen_random_bytes(16), 'hex'),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (venue_id, label)
);

-- ---------------------------------------------------------------------------
-- menu_categories / menu_items
-- ---------------------------------------------------------------------------
create table if not exists menu_categories (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid not null references venues (id) on delete cascade,
  name text not null,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists menu_items (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid not null references venues (id) on delete cascade,
  category_id uuid not null references menu_categories (id) on delete cascade,
  name text not null,
  description text,
  price_czk integer not null check (price_czk >= 0),
  is_available boolean not null default true,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists idx_venue_users_user on venue_users (user_id);
create index if not exists idx_tables_venue on tables (venue_id);
create index if not exists idx_menu_categories_venue on menu_categories (venue_id);
create index if not exists idx_menu_items_venue on menu_items (venue_id);
create index if not exists idx_menu_items_category on menu_items (category_id);

-- ---------------------------------------------------------------------------
-- Pomocná funkce: má přihlášený uživatel roli v dané hospodě?
-- security definer + pevně nastavený search_path, aby ji šlo bezpečně volat z RLS policy.
-- ---------------------------------------------------------------------------
create or replace function is_venue_staff(p_venue_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from venue_users vu
    where vu.venue_id = p_venue_id
      and vu.user_id = auth.uid()
  );
$$;

-- ---------------------------------------------------------------------------
-- RLS: zapnout na všech tabulkách s daty hospody
-- ---------------------------------------------------------------------------
alter table venues enable row level security;
alter table venue_users enable row level security;
alter table tables enable row level security;
alter table menu_categories enable row level security;
alter table menu_items enable row level security;

-- venues: přihlášený personál vidí jen svou hospodu (public/anon nemá k venues přístup vůbec –
-- veřejná stránka stolu jde přes bezpečnou funkci get_table_context níže)
create policy venues_select_own on venues
  for select
  using (is_venue_staff(id));

-- venue_users: uživatel vidí jen svoje vlastní přiřazení (pro zobrazení "moje hospody")
create policy venue_users_select_own on venue_users
  for select
  using (user_id = auth.uid());

-- tables: personál dané hospody vidí a spravuje jen její stoly
create policy tables_select_staff on tables
  for select
  using (is_venue_staff(venue_id));

create policy tables_write_staff on tables
  for all
  using (is_venue_staff(venue_id))
  with check (is_venue_staff(venue_id));

-- menu_categories / menu_items: totéž pravidlo
create policy menu_categories_select_staff on menu_categories
  for select
  using (is_venue_staff(venue_id));

create policy menu_categories_write_staff on menu_categories
  for all
  using (is_venue_staff(venue_id))
  with check (is_venue_staff(venue_id));

create policy menu_items_select_staff on menu_items
  for select
  using (is_venue_staff(venue_id));

create policy menu_items_write_staff on menu_items
  for all
  using (is_venue_staff(venue_id))
  with check (is_venue_staff(venue_id));

-- ---------------------------------------------------------------------------
-- Veřejná funkce pro stránku stolu: app.cz/v/:venueSlug/t/:tableToken
--
-- Host (anon role) nemá přímý SELECT na venues/tables/menu_* — jde jen přes tuhle
-- funkci, která na serveru ověří, že slug hospody a token stolu skutečně patří
-- k sobě a hospoda i stůl jsou aktivní. Tím plníme podmínku MVP "QR kód vždy
-- otevře správnou hospodu a správný stůl" a zabraňujeme enumeraci cizích dat.
-- ---------------------------------------------------------------------------
create or replace function get_table_context(p_venue_slug text, p_table_token text)
returns json
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_venue venues%rowtype;
  v_table tables%rowtype;
  v_menu json;
begin
  select * into v_venue
  from venues
  where slug = p_venue_slug
    and is_active = true;

  if not found then
    return null;
  end if;

  select * into v_table
  from tables
  where venue_id = v_venue.id
    and qr_token = p_table_token
    and is_active = true;

  if not found then
    return null;
  end if;

  select coalesce(json_agg(cat order by cat.sort_order), '[]'::json)
  into v_menu
  from (
    select
      mc.id,
      mc.name,
      mc.sort_order,
      coalesce(
        (
          select json_agg(
            json_build_object(
              'id', mi.id,
              'name', mi.name,
              'description', mi.description,
              'price_czk', mi.price_czk,
              'is_available', mi.is_available,
              'sort_order', mi.sort_order
            )
            order by mi.sort_order
          )
          from menu_items mi
          where mi.category_id = mc.id
        ),
        '[]'::json
      ) as items
    from menu_categories mc
    where mc.venue_id = v_venue.id
    order by mc.sort_order
  ) cat;

  return json_build_object(
    'venue', json_build_object('name', v_venue.name),
    'table', json_build_object('label', v_table.label),
    'menu', v_menu
  );
end;
$$;

-- Anon (nepřihlášený host) smí jen volat tuhle jednu funkci, nic víc.
revoke all on function get_table_context(text, text) from public;
grant execute on function get_table_context(text, text) to anon, authenticated;
