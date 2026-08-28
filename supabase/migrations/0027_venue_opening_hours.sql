-- Otevírací doba (navazuje na mapu podniků, migrace 0026). Volitelné
-- textové pole (např. "Po-Pá 11-23, So-Ne 12-22") — hospoda ho vyplní v
-- Nastavení hospody a zobrazí se hostům v adresáři /podniky a na náhledu
-- menu /v/:venueSlug. Jde jen o informativní text, žádná logika
-- otevřeno/zavřeno teď se z něj nepočítá (volný formát by ji stejně nešlo
-- spolehlivě vyhodnotit).

alter table venues add column if not exists opening_hours text;

create or replace function get_public_venues()
returns json
language sql
security definer
set search_path = public
stable
as $$
  select coalesce(json_agg(v order by v.name), '[]'::json)
  from (
    select slug, name, city, address, opening_hours
    from venues
    where is_active = true and listed_publicly = true
  ) v;
$$;

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
    'venue', json_build_object('name', v_venue.name, 'city', v_venue.city, 'address', v_venue.address, 'opening_hours', v_venue.opening_hours),
    'menu', v_menu
  );
end;
$$;
