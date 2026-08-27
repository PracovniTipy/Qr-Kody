import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../../lib/supabaseClient'
import { PublicVenue } from '../../types/venueDirectory'

/**
 * Mapa podniků (masterplán, "co zbývá": mapa podniků) - veřejný adresář
 * hospod používajících StůlHraje. Zobrazí jen hospody, které se do
 * adresáře samy přihlásily (venues.listed_publicly, migrace 0026) -
 * stejná opatrnost jako u zbytku veřejného API, žádné scrapování cizích
 * dat bez souhlasu. Klik na hospodu vede na neveřejný náhled menu
 * (VenuePreviewPage) - bez objednávání, jen orientační.
 */
export function VenueMapPage() {
  const [venues, setVenues] = useState<PublicVenue[]>([])
  const [status, setStatus] = useState<'loading' | 'ok' | 'error'>('loading')

  useEffect(() => {
    let active = true

    supabase
      .rpc('get_public_venues')
      .then(({ data, error }) => {
        if (!active) return
        if (error || !Array.isArray(data)) {
          setStatus('error')
          return
        }
        setVenues(data as PublicVenue[])
        setStatus('ok')
      })

    return () => {
      active = false
    }
  }, [])

  return (
    <div className="venue-map-page">
      <header>
        <h1>🗺️ Mapa podniků</h1>
        <p className="menu-item-desc">Hospody, které používají StůlHraje a chtějí být vidět.</p>
      </header>

      {status === 'loading' && <p>Načítám…</p>}
      {status === 'error' && <p className="error">Adresář se nepodařilo načíst. Zkus to znovu.</p>}
      {status === 'ok' && venues.length === 0 && <p>Zatím tu žádná hospoda není zveřejněná.</p>}

      <ul className="venue-directory-list">
        {venues.map((v) => (
          <li key={v.slug}>
            <Link to={`/v/${v.slug}`} className="venue-directory-item">
              <strong>{v.name}</strong>
              {(v.city || v.address) && (
                <span className="venue-directory-address">
                  {[v.address, v.city].filter(Boolean).join(', ')}
                </span>
              )}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  )
}
