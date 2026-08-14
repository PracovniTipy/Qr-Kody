-- StůlHraje – testovací data pro Etapu 0.
-- Spusť AŽ PO migraci 0001_init_schema.sql.
--
-- Postup:
-- 1) V Supabase Studiu (Authentication -> Users -> Add user) založ jednoho admina,
--    např. e-mail majitel@test.stulhraje.cz, a zkopíruj jeho User UID.
-- 2) Níže nahraď 'REPLACE_WITH_ADMIN_USER_UUID' tímto UID.
-- 3) Spusť celý skript v Supabase Studiu -> SQL editor.

insert into venues (slug, name, is_active)
values ('u-lipy', 'Hospoda U lípy', true)
on conflict (slug) do nothing;

insert into venue_users (venue_id, user_id, role)
select v.id, 'REPLACE_WITH_ADMIN_USER_UUID'::uuid, 'MAJITEL'
from venues v
where v.slug = 'u-lipy'
on conflict (venue_id, user_id) do nothing;

insert into tables (venue_id, label)
select v.id, '1'
from venues v
where v.slug = 'u-lipy'
on conflict (venue_id, label) do nothing;

-- Kategorie
with cat as (
  insert into menu_categories (venue_id, name, sort_order)
  select v.id, x.name, x.sort_order
  from venues v
  cross join (values ('Jídlo', 1), ('Nápoje', 2)) as x(name, sort_order)
  where v.slug = 'u-lipy'
  returning id, name
)
-- Položky
insert into menu_items (venue_id, category_id, name, description, price_czk, sort_order)
select v.id, cat.id, item.name, item.description, item.price_czk, item.sort_order
from venues v
join cat on true
join (
  values
    ('Jídlo', 'Burger', 'Hovězí burger, hranolky, dresink', 189, 1),
    ('Jídlo', 'Hranolky', NULL, 59, 2),
    ('Nápoje', 'Pivo 0,5 l', 'Točené', 59, 1),
    ('Nápoje', 'Limonáda 0,3 l', NULL, 49, 2)
) as item(cat_name, name, description, price_czk, sort_order)
  on item.cat_name = cat.name
where v.slug = 'u-lipy';

-- Po spuštění zkontroluj token stolu a otevři veřejnou stránku:
select v.slug as venue_slug, t.label, t.qr_token
from tables t
join venues v on v.id = t.venue_id
where v.slug = 'u-lipy';
-- URL bude: https://<tvoje-domena>/v/u-lipy/t/<qr_token>
