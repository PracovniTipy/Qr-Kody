import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { supabase } from '../../lib/supabaseClient'
import { VenueRow, TableRow, MenuCategoryRow, MenuItemRow } from '../../types/adminVenue'
import { VenueSettingsForm } from '../../components/admin/VenueSettingsForm'
import { TablesManager } from '../../components/admin/TablesManager'
import { MenuManager } from '../../components/admin/MenuManager'
import { MenuImportWizard } from '../../components/admin/MenuImportWizard'

/**
 * Etapa 1: administrace jedné hospody – základní údaje, stoly/QR odkazy
 * a kategorie/položky menu. Přístup i zápis hlídá RLS (is_venue_staff /
 * is_venue_manager v migracích 0001 a 0002), tahle stránka je jen UI.
 * Etapa 1.1 přidává MenuImportWizard – import menu z fotky/PDF přes
 * Edge Function import-menu (Claude vision API).
 */
export function AdminVenuePage() {
  const { venueId } = useParams<{ venueId: string }>()

  const [venue, setVenue] = useState<VenueRow | null>(null)
  const [tables, setTables] = useState<TableRow[]>([])
  const [categories, setCategories] = useState<MenuCategoryRow[]>([])
  const [items, setItems] = useState<MenuItemRow[]>([])
  const [status, setStatus] = useState<'loading' | 'ok' | 'not_found' | 'error'>('loading')

  useEffect(() => {
    if (!venueId) {
      setStatus('not_found')
      return
    }

    let active = true

    async function load() {
      const [venueRes, tablesRes, categoriesRes, itemsRes] = await Promise.all([
        supabase.from('venues').select('*').eq('id', venueId).single(),
        supabase.from('tables').select('*').eq('venue_id', venueId).order('label'),
        supabase.from('menu_categories').select('*').eq('venue_id', venueId).order('sort_order'),
        supabase.from('menu_items').select('*').eq('venue_id', venueId).order('sort_order'),
      ])

      if (!active) return

      if (venueRes.error || !venueRes.data) {
        setStatus(venueRes.error ? 'error' : 'not_found')
        return
      }

      setVenue(venueRes.data as VenueRow)
      setTables((tablesRes.data ?? []) as TableRow[])
      setCategories((categoriesRes.data ?? []) as MenuCategoryRow[])
      setItems((itemsRes.data ?? []) as MenuItemRow[])
      setStatus('ok')
    }

    load()

    return () => {
      active = false
    }
  }, [venueId])

  if (status === 'loading') return <p style={{ padding: 24 }}>Načítám…</p>

  if (status === 'not_found') {
    return (
      <div style={{ padding: 24 }}>
        <h1>Hospoda nenalezena</h1>
        <p>Buď neexistuje, nebo k ní nemáš přiřazenou roli.</p>
        <Link to="/admin">Zpět na přehled</Link>
      </div>
    )
  }

  if (status === 'error' || !venue) {
    return (
      <div style={{ padding: 24 }}>
        <h1>Něco se pokazilo</h1>
        <p>Zkus stránku znovu načíst.</p>
        <Link to="/admin">Zpět na přehled</Link>
      </div>
    )
  }

  return (
    <div className="dashboard">
      <header>
        <div>
          <Link to="/admin" className="back-link">
            ← Moje hospody
          </Link>
          <h1>{venue.name}</h1>
        </div>
        <div className="header-links">
          <Link to={`/admin/hospoda/${venue.id}/kuchyne`} className="kitchen-link">
            Kuchyň →
          </Link>
          <Link to={`/admin/hospoda/${venue.id}/trzby`} className="kitchen-link">
            Tržby →
          </Link>
          <Link to={`/admin/hospoda/${venue.id}/hodnoceni`} className="kitchen-link">
            Hodnocení →
          </Link>
        </div>
      </header>

      <VenueSettingsForm venue={venue} onSaved={setVenue} />
      <TablesManager venueId={venue.id} venueSlug={venue.slug} tables={tables} onChange={setTables} />
      <MenuManager
        venueId={venue.id}
        categories={categories}
        items={items}
        onCategoriesChange={setCategories}
        onItemsChange={setItems}
      />
      <MenuImportWizard
        venueId={venue.id}
        categories={categories}
        items={items}
        onCategoriesChange={setCategories}
        onItemsChange={setItems}
      />
    </div>
  )
}
