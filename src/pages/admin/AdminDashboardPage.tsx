import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabaseClient'

interface MyVenue {
  role: string
  venues: { name: string; slug: string } | null
}

/**
 * Etapa 0: jen ověřuje, že přihlášený admin/obsluha vidí přes RLS pravidla
 * pouze hospody, ke kterým má přiřazenou roli ve venue_users.
 * Skutečná administrace menu, stolů a objednávek přijde v dalších etapách.
 */
export function AdminDashboardPage() {
  const [venues, setVenues] = useState<MyVenue[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true

    supabase
      .from('venue_users')
      .select('role, venues(name, slug)')
      .then(({ data, error: queryError }) => {
        if (!active) return
        if (queryError) {
          setError(queryError.message)
        } else {
          setVenues((data ?? []) as unknown as MyVenue[])
        }
        setLoading(false)
      })

    return () => {
      active = false
    }
  }, [])

  async function handleLogout() {
    await supabase.auth.signOut()
    window.location.href = '/admin/login'
  }

  return (
    <div className="dashboard">
      <header>
        <h1>Moje hospody</h1>
        <button onClick={handleLogout}>Odhlásit se</button>
      </header>

      {loading && <p>Načítám…</p>}
      {error && <p className="error">{error}</p>}

      {!loading && !error && venues.length === 0 && (
        <p>K tvému účtu zatím není přiřazená žádná hospoda.</p>
      )}

      <ul>
        {venues.map((v, i) => (
          <li key={i}>
            <strong>{v.venues?.name ?? '(bez názvu)'}</strong> — role: {v.role}
          </li>
        ))}
      </ul>
    </div>
  )
}
