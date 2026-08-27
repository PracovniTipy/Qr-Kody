-- StulHraje - Etapa 4 (rozsireni): hry u stolu jako volitelna prikoupena
-- sluzba. Kazda hospoda ma vypinac "games_enabled" (vychozi true, at se
-- nerozbiji stavajici stoly, ktere uz hry pouzivaji) - kdyz je vypnuty,
-- verejna stranka stolu sekci s hrami vubec nezobrazi. Cena (299 Kc/mesic)
-- je zatim jen informacni popisek v adminu - skutecne vyberani platby
-- (napojeni na platebni branu, fakturace) neni soucasti tohoto kroku.

alter table venues add column if not exists games_enabled boolean not null default true;

-- get_table_context ted navic vraci i games_enabled, at klient (TablePage) vi,
-- jestli sekci s hrami vubec zobrazit.
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
    'venue', json_build_object(
      'name', v_venue.name,
      'bank_account', v_venue.bank_account,
      'games_enabled', v_venue.games_enabled
    ),
    'table', json_build_object('label', v_table.label),
    'menu', v_menu
  );
end;
$$;
