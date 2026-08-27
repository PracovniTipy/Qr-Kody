// Mapa podniků (masterplán, "co zbývá": mapa podniků) - viz
// supabase/migrations/0026_venue_directory.sql

import { MenuCategory } from './tableContext'

export interface PublicVenue {
  slug: string
  name: string
  city: string | null
  address: string | null
}

export interface VenuePreview {
  venue: {
    name: string
    city: string | null
    address: string | null
  }
  menu: MenuCategory[]
}
