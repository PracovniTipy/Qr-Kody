-- Mapa podniků (masterplán, "co zbývá": mapa podniků). Hospoda se může
-- dobrovolně přihlásit do veřejného adresáře (listed_publicly) a vyplnit
-- město/adresu. Adresář i náhled menu jsou jen pro přihlášené hospody -
-- stejná opatrnost jako u zbytku veřejného API (anon nemá přímý přístup
-- k venues/menu_* tabulkám, jen přes SECURITY DEFINER funkce).

alter table venues add column if not exists city text;
alter table venues add column if not exists address text;
alter table venues add column if not exists listed_publicly boolean not null default false;

-- get_public_venues: veřejný seznam hospod v adresáři (bez přihlášení).
create or replace function get_public_venues()
returns json
language sql
security definer
set search_path = public
stable
as $$
  select coalesce(json_agg(v order by v.name), '[]'::json)
  from (
    select slug, name, city, address
    from venues
    where is_active = true and listed_publicly = true
  ) v;
$$;

-- get_venue_preview: veřejný náhled menu hospody (bez konkrétního stolu) -
-- jen pro hospody v adresáři. Bez objednávání/her/plateb, jen informativní
-- náhled pro někoho, kdo si vybírá, kam zajít.
create or replace function get_venue_preview(p_venue_slug text)
returns json
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_venue venues%rowtype;
  v_menu json;
begin
  select * into v_venue from venues
  where slug = p_venue_slug and is_active = true and listed_publicly = true;
  if not found then
    return null;
  end if;

  select coalesce(json_agg(cat order by cat.sort_order), '[]'::json) into v_menu
  from (
    select mc.id, mc.name, mc.name_en, mc.sort_order,
      coalesce((select json_agg(json_build_object('id', mi.id, 'name', mi.name, 'name_en', mi.name_en, 'description', mi.description, 'description_en', mi.description_en, 'price_czk', mi.price_czk, 'is_available', mi.is_available, 'sort_order', mi.sort_order) order by mi.sort_order) from menu_items mi where mi.category_id = mc.id), '[]'::json) as items
    from menu_categories mc where mc.venue_id = v_venue.id order by mc.sort_order
  ) cat;

  return json_build_object(
    'venue', json_build_object('name', v_venue.name, 'city', v_venue.city, 'address', v_venue.address),
    'menu', v_menu
  );
end;
$$;

revoke all on function get_public_venues() from public;
grant execute on function get_public_venues() to anon, authenticated;
revoke all on function get_venue_preview(text) from public;
grant execute on function get_venue_preview(text) to anon, authenticated;
