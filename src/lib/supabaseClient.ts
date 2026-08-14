import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

if (!supabaseUrl || !supabaseAnonKey) {
  // Nezastavujeme celou appku pádem builtu, ale hlasitě upozorníme ve vývoji.
  // eslint-disable-next-line no-console
  console.error(
    'Chybí VITE_SUPABASE_URL nebo VITE_SUPABASE_ANON_KEY. Zkopíruj .env.example do .env.local a doplň hodnoty z tvého Supabase projektu.'
  )
}

export const supabase = createClient(supabaseUrl ?? '', supabaseAnonKey ?? '')
