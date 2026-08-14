-- StůlHraje – Etapa 1: správa hospody, stolů a menu z administrace.
-- Etapa 0 dala personálu právo VIDĚT vlastní hospodu (venues_select_own) a
-- plné právo spravovat její stoly/menu (tables_write_staff, menu_*_write_staff).
-- Chybělo právo UPRAVIT samotný záznam hospody (název, slug, aktivní/neaktivní) –
-- to má smysl svěřit jen majiteli/manažerovi, ne každé obsluze.

create or replace function is_venue_manager(p_venue_id uuid)
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
      and vu.role in ('MAJITEL', 'MANAZER')
  );
$$;

create policy venues_update_manager on venues
  for update
  using (is_venue_manager(id))
  with check (is_venue_manager(id));
