-- Oddělení "her" a "objednávání" jako dvou nezávislých režimů jedné appky.
-- Hospoda si teď může nezávisle na sobě zapnout/vypnout objednávání jídla a
-- pití (menu + košík + submit_order) a hry u stolu (games_enabled, migrace
-- 0020) – takže appka může fungovat čistě jako "herní stůl" bez objednávání,
-- čistě jako restaurační objednávkový systém bez her, nebo obojí najednou.
-- Výchozí hodnota true, aby se chování stávajících hospod nezměnilo.

alter table venues add column if not exists ordering_enabled boolean not null default true;

create or replace function public.get_table_context(p_venue_slug text, p_table_token text)
 returns json
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
declare
  v_venue venues%rowtype;
  v_table tables%rowtype;
  v_menu json;
begin
  select * into v_venue from venues where slug = p_venue_slug and is_active = true;
  if not found then return null; end if;
  select * into v_table from tables where venue_id = v_venue.id and qr_token = p_table_token and is_active = true;
  if not found then return null; end if;
  select coalesce(json_agg(cat order by cat.sort_order), '[]'::json) into v_menu
  from (
    select mc.id, mc.name, mc.name_en, mc.sort_order,
      coalesce((select json_agg(json_build_object('id', mi.id, 'name', mi.name, 'name_en', mi.name_en, 'description', mi.description, 'description_en', mi.description_en, 'price_czk', mi.price_czk, 'is_available', mi.is_available, 'sort_order', mi.sort_order) order by mi.sort_order) from menu_items mi where mi.category_id = mc.id), '[]'::json) as items
    from menu_categories mc where mc.venue_id = v_venue.id order by mc.sort_order
  ) cat;
  return json_build_object(
    'venue', json_build_object('name', v_venue.name, 'bank_account', v_venue.bank_account, 'games_enabled', v_venue.games_enabled, 'ordering_enabled', v_venue.ordering_enabled),
    'table', json_build_object('label', v_table.label),
    'menu', v_menu
  );
end;
$function$;

-- submit_order si teď navíc ověří ordering_enabled – stejná opatrnost jako
-- u games_enabled (viz enforcement v migraci 0022): server je poslední
-- slovo, ne jen skrytí tlačítka na klientovi.
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

  if not v_venue.ordering_enabled then
    raise exception 'Objednavani je u teto hospody vypnute.';
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
