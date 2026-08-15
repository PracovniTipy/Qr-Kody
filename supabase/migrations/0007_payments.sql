-- StůlHraje – Etapa 2 (část): QR platba
-- Navazuje na kapitolu 11 hlavního plánu. Skutečná platba probíhá mimo naši
-- aplikaci (host naskenuje QR kód svou bankovní appkou a pošle peníze přímo
-- na účet hospody – český standard "QR Platba" / SPD). My jen:
--  1) necháme hospodu zadat její bankovní účet (IBAN) ve VenueSettingsForm,
--  2) hostovi spočítáme a zobrazíme částku k zaplacení + QR kód,
--  3) personálu dáme možnost označit útratu stolu jako zaplacenou.
-- Žádné nové RLS není potřeba: venues_update_manager (migrace 0002) už
-- pokrývá update libovolného sloupce venues a orders_update_staff
-- (migrace 0005) update libovolného sloupce orders, včetně nových.

alter table venues add column if not exists bank_account text;
alter table orders add column if not exists paid boolean not null default false;

-- get_table_context teď navíc vrací i bankovní účet hospody (host ho potřebuje
-- pro vygenerování QR platby) – bez účtu se sekce "K zaplacení" na klientovi jen skryje.
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
    'venue', json_build_object('name', v_venue.name, 'bank_account', v_venue.bank_account),
    'table', json_build_object('label', v_table.label),
    'menu', v_menu
  );
end;
$$;

-- get_table_orders teď navíc vrací i příznak paid u každé objednávky, aby si
-- host mohl spočítat, co ještě zbývá zaplatit.
create or replace function get_table_orders(p_qr_token text)
returns json
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_table tables%rowtype;
  v_orders json;
begin
  select * into v_table from tables where qr_token = p_qr_token and is_active = true;
  if not found then
    return null;
  end if;

  select coalesce(json_agg(o), '[]'::json)
  into v_orders
  from (
    select
      ord.id,
      ord.status,
      ord.paid,
      ord.note,
      ord.created_at,
      coalesce(
        (
          select json_agg(json_build_object(
            'name', oi.name_snapshot,
            'price_czk', oi.price_czk_snapshot,
            'quantity', oi.quantity,
            'note', oi.note
          ))
          from order_items oi
          where oi.order_id = ord.id
        ),
        '[]'::json
      ) as items
    from orders ord
    where ord.table_id = v_table.id
      and ord.created_at > now() - interval '12 hours'
    order by ord.created_at desc
  ) o;

  return v_orders;
end;
$$;
