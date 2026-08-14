import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../../lib/supabaseClient'
import { CreateVenueForm } from '../../components/admin/CreateVenueForm'

interface MyVenue {
  role: string
  venues: { id: string; name: string; slug: string } | null
}

/**
 * Přehled hospod, ke kterým má přihlášený uživatel přiřazenou roli (RLS
 * pravidlo venue_users_select_own). Klik na hospodu vede do administrace
 * (Etapa 1) – stoly, QR odkazy a menu. Etapa 1.1 přidává CreateVenueForm
 * pro založení nové hospody přímo z UI.
 */
export function AdminDashboardPage() {
  const [venues, setVenues] = useState<MyVenue[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true

    supabase
      .from('venue_users')
      .select('role, venues(id, name, slug)')
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
        <p>K tvému účtu zatím není přiřazena žádná hospoda.</p>
      )}

      <ul className="entity-list">
        {venues.map((v, i) => (
          <li key={i}>
            <div className="entity-main">
              {v.venues ? (
                <Link to={`/admin/hospoda/${v.venues.id}`}>
                  <strong>{v.venues.name}</strong>
                </Link>
              ) : (
                <strong>(bez názvu)</strong>
              )}
              <p className="menu-item-desc">role: {v.role}</p>
            </div>
          </li>
        ))}
      </ul>

      <CreateVenueForm />
    </div>
  )
}
