-- StůlHraje – Etapa 2 (část): košík a odeslání objednávky
-- Navazuje na kapitolu 11 hlavního plánu. Hosté (anon) nemají přímý přístup
-- k orders/order_items – jde jen přes bezpečné RPC funkce níže, které si samy
-- ověří platnost qr_token stolu (stejný vzor jako get_table_context).

create table if not exists orders (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid not null references venues (id) on delete cascade,
  table_id uuid not null references tables (id) on delete cascade,
  status text not null default 'nova' check (status in ('nova', 'pripravuje_se', 'hotovo', 'zrusena')),
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders (id) on delete cascade,
  menu_item_id uuid references menu_items (id) on delete set null,
  name_snapshot text not null,
  price_czk_snapshot integer not null check (price_czk_snapshot >= 0),
  quantity integer not null check (quantity > 0),
  note text,
  created_at timestamptz not null default now()
);

create index if not exists idx_orders_venue on orders (venue_id);
create index if not exists idx_orders_table on orders (table_id);
create index if not exists idx_order_items_order on order_items (order_id);

alter table orders enable row level security;
alter table order_items enable row level security;

-- personál dané hospody vidí a (v příští části Etapy 2, kuchyňská obrazovka)
-- bude moci měnit stav objednávek své hospody
create policy orders_select_staff on orders
for select
using (is_venue_staff(venue_id));

create policy orders_update_staff on orders
for update
using (is_venue_staff(venue_id))
with check (is_venue_staff(venue_id));

create policy order_items_select_staff on order_items
for select
using (exists (
  select 1 from orders o where o.id = order_items.order_id and is_venue_staff(o.venue_id)
));

-- Žádná INSERT/DELETE policy pro nikoho – objednávky vznikají výhradně přes
-- security definer funkci submit_order níže.

create or replace function submit_order(p_qr_token text, p_items jsonb, p_note text default null)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_table tables%rowtype;
  v_venue venues%rowtype;
  v_order orders%rowtype;
  v_item jsonb;
  v_menu_item menu_items%rowtype;
  v_quantity integer;
begin
  select * into v_table from tables where qr_token = p_qr_token and is_active = true;
  if not found then
    raise exception 'Neplatny nebo neaktivni QR odkaz stolu.';
  end if;

  select * into v_venue from venues where id = v_table.venue_id and is_active = true;
  if not found then
    raise exception 'Hospoda neni aktivni.';
  end if;

  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Objednavka je prazdna.';
  end if;

  insert into orders (venue_id, table_id, note)
  values (v_table.venue_id, v_table.id, nullif(trim(p_note), ''))
  returning * into v_order;

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    select * into v_menu_item
    from menu_items
    where id = (v_item->>'menu_item_id')::uuid
      and venue_id = v_table.venue_id
      and is_available = true;

    if not found then
      raise exception 'Polozka menu nebyla nalezena nebo neni dostupna.';
    end if;

    v_quantity := coalesce((v_item->>'quantity')::int, 1);
    if v_quantity < 1 then
      v_quantity := 1;
    end if;

    insert into order_items (order_id, menu_item_id, name_snapshot, price_czk_snapshot, quantity, note)
    values (
      v_order.id,
      v_menu_item.id,
      v_menu_item.name,
      v_menu_item.price_czk,
      v_quantity,
      nullif(trim(v_item->>'note'), '')
    );
  end loop;

  return json_build_object(
    'order_id', v_order.id,
    'status', v_order.status,
    'created_at', v_order.created_at
  );
end;
$$;

revoke all on function submit_order(text, jsonb, text) from public;
grant execute on function submit_order(text, jsonb, text) to anon, authenticated;

-- Host po odeslání objednávky (i po refreshi stránky) vidí aktuální objednávky
-- svého stolu – validace tokenu stejná jako u get_table_context.
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

revoke all on function get_table_orders(text) from public;
grant execute on function get_table_orders(text) to anon, authenticated;
