// Datové typy pro administraci hospody (Etapa 1).

export interface VenueRow {
  id: string
  slug: string
  name: string
  is_active: boolean
  bank_account: string | null
  games_enabled: boolean
}

export interface TableRow {
  id: string
  venue_id: string
  label: string
  qr_token: string
  is_active: boolean
  tested_at: string | null
}

export interface MenuCategoryRow {
  id: string
  venue_id: string
  name: string
  name_en: string | null
  sort_order: number
}

export interface MenuItemRow {
  id: string
  venue_id: string
  category_id: string
  name: string
  name_en: string | null
  description: string | null
  description_en: string | null
  price_czk: number
  is_available: boolean
  sort_order: number
}
