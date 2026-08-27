-- Vícejazyčné menu (masterplán, "co zbývá": vícejazyčné menu)
-- Přidává volitelné anglické překlady pro kategorie a položky menu.
-- Chybějící překlad se na frontendu zobrazí jako fallback na český text.

alter table menu_categories add column if not exists name_en text;
alter table menu_items add column if not exists name_en text;
alter table menu_items add column if not exists description_en text;

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
    'venue', json_build_object('name', v_venue.name, 'bank_account', v_venue.bank_account, 'games_enabled', v_venue.games_enabled),
    'table', json_build_object('label', v_table.label),
    'menu', v_menu
  );
end;
$function$;
