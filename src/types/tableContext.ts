// Tvar dat, která vrací DB funkce public.get_table_context(p_venue_slug, p_table_token).
// Viz supabase/migrations/0001_init_schema.sql a 0007_payments.sql

export interface MenuItem {
  id: string
  name: string
  description: string | null
  price_czk: number
  is_available: boolean
  sort_order: number
}

export interface MenuCategory {
  id: string
  name: string
  sort_order: number
  items: MenuItem[]
}

export interface TableContext {
  venue: {
    name: string
    bank_account: string | null
    games_enabled: boolean
  }
  table: {
    label: string
  }
  menu: MenuCategory[]
}
