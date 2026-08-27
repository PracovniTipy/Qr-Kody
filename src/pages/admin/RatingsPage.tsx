import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { supabase } from '../../lib/supabaseClient'
import { AdminRatingRow } from '../../types/rating'

/**
 * Přehled hodnocení pro personál/majitele (masterplan, "co zbývá":
 * hodnocení). Čtení jde přímo přes Supabase klienta - chrání to RLS
 * pravidlo venue_ratings_select_staff (migrace 0023), stejný vzor jako
 * u Tržeb (RevenuePage) - žádná zvláštní RPC funkce tu není potřeba.
 */
export function RatingsPage() {
  const { venueId } = useParams<{ venueId: string }>()
  const [ratings, setRatings] = useState<AdminRatingRow[]>([])
  const [status, setStatus] = useState<'loading' | 'ok' | 'error'>('loading')

  useEffect(() => {
    if (!venueId) return
    let active = true

    supabase
      .from('venue_ratings')
      .select('id, stars, comment, created_at')
      .eq('venue_id', venueId)
      .order('created_at', { ascending: false })
      .limit(200)
      .then(({ data, error }) => {
        if (!active) return
        if (error) {
          setStatus('error')
          return
        }
        setRatings((data ?? []) as AdminRatingRow[])
        setStatus('ok')
      })

    return () => {
      active = false
    }
  }, [venueId])

  if (status === 'loading') return <p style={{ padding: 24 }}>Načítám…</p>

  if (status === 'error') {
    return (
      <div style={{ padding: 24 }}>
        <h1>Něco se pokazilo</h1>
        <p>Zkus stránku znovu načíst.</p>
        <Link to={`/admin/hospoda/${venueId ?? ''}`}>← Zpět na hospodu</Link>
      </div>
    )
  }

  const count = ratings.length
  const avg = count > 0 ? ratings.reduce((sum, r) => sum + r.stars, 0) / count : 0
  const distribution = [5, 4, 3, 2, 1].map((n) => ({
    stars: n,
    count: ratings.filter((r) => r.stars === n).length,
  }))

  return (
    <div className="revenue-page ratings-page">
      <header>
        <div>
          <Link to={`/admin/hospoda/${venueId ?? ''}`} className="back-link">
            ← Zpět na hospodu
          </Link>
          <h1>Hodnocení</h1>
        </div>
      </header>

      <div className="revenue-summary">
        <div className="revenue-card">
          <span className="revenue-card-label">Průměr</span>
          <strong className="revenue-card-value">{count > 0 ? avg.toFixed(1) : '–'} ★</strong>
          <span className="revenue-card-hint">{count} hodnocení</span>
        </div>
        <div className="revenue-card ratings-distribution">
          {distribution.map((d) => (
            <div key={d.stars} className="ratings-distribution-row">
              <span>{d.stars} ★</span>
              <span className="ratings-distribution-count">{d.count}</span>
            </div>
          ))}
        </div>
      </div>

      {ratings.filter((r) => r.comment).length === 0 ? (
        <p>Zatím žádné komentáře.</p>
      ) : (
        <ul className="ratings-comments">
          {ratings
            .filter((r) => r.comment)
            .map((r) => (
              <li key={r.id} className="ratings-comment">
                <span className="ratings-comment-stars">{'★'.repeat(r.stars)}{'☆'.repeat(5 - r.stars)}</span>
                <p className="ratings-comment-text">{r.comment}</p>
                <span className="ratings-comment-date">
                  {new Date(r.created_at).toLocaleDateString('cs-CZ', {
                    day: 'numeric',
                    month: 'numeric',
                    year: 'numeric',
                  })}
                </span>
              </li>
            ))}
        </ul>
      )}
    </div>
  )
}
