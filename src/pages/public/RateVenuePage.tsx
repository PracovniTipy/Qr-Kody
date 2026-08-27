import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { supabase } from '../../lib/supabaseClient'
import { SubmitRatingResult } from '../../types/rating'

const STORAGE_PREFIX = 'rated_venue_'

/**
 * Hodnocení podniku hostem (masterplan, "co zbývá": hodnocení) - jednoduchý
 * anonymní formulář 1-5 hvězdiček + volitelný komentář, dostupný ze stránky
 * stolu odkazem "Ohodnotit podnik". Odesílá se přes bezpečnou RPC funkci
 * submit_venue_rating (migrace 0023) - stejný vzor jako submit_order.
 * Hráčské účty (kapitola 9) zatím nejsou, takže localStorage jen zabrání
 * omylem odeslat formulář z tohoto telefonu vícekrát - není to tvrdá
 * ochrana proti podvodu, na tom tady nezáleží (žádné peníze, žádné skóre).
 */
export function RateVenuePage() {
  const { venueSlug, tableToken } = useParams<{ venueSlug: string; tableToken: string }>()
  const [stars, setStars] = useState(0)
  const [comment, setComment] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [done, setDone] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!tableToken) return
    try {
      if (localStorage.getItem(STORAGE_PREFIX + tableToken)) setDone(true)
    } catch {
      // ignore (např. soukromý režim)
    }
  }, [tableToken])

  async function submit() {
    if (!tableToken || submitting || stars < 1) return
    setSubmitting(true)
    setError(null)

    try {
      const { data } = await supabase.rpc('submit_venue_rating', {
        p_qr_token: tableToken,
        p_stars: stars,
        p_comment: comment.trim() || null,
      })
      const result = data as SubmitRatingResult | null
      if (!result?.ok) {
        setError('Hodnocení se nepodařilo odeslat. Zkus to znovu.')
        setSubmitting(false)
        return
      }
      try {
        localStorage.setItem(STORAGE_PREFIX + tableToken, '1')
      } catch {
        // ignore
      }
      setDone(true)
    } catch {
      setError('Hodnocení se nepodařilo odeslat. Zkus to znovu.')
    }
    setSubmitting(false)
  }

  return (
    <div className="game-page rate-venue-page">
      <header>
        <Link to={`/v/${venueSlug ?? ''}/t/${tableToken ?? ''}`} className="back-link">
          ← Zpět ke stolu
        </Link>
        <h1>⭐ Ohodnoť podnik</h1>
      </header>

      {done ? (
        <div className="rate-venue-thanks">
          <p>Díky za hodnocení! 🙌</p>
        </div>
      ) : (
        <div className="rate-venue-form">
          <p>Jak se ti tu dneska líbilo?</p>

          <div className="rate-venue-stars">
            {[1, 2, 3, 4, 5].map((n) => (
              <button
                key={n}
                type="button"
                className={`rate-venue-star ${n <= stars ? 'filled' : ''}`}
                onClick={() => setStars(n)}
                aria-label={`${n} z 5 hvězdiček`}
              >
                {n <= stars ? '★' : '☆'}
              </button>
            ))}
          </div>

          <textarea
            className="rate-venue-comment"
            placeholder="Chceš k tomu něco dodat? (nepovinné)"
            value={comment}
            maxLength={500}
            onChange={(e) => setComment(e.target.value)}
          />

          {error && <p className="error">{error}</p>}

          <button
            type="button"
            className="rate-venue-submit"
            onClick={submit}
            disabled={stars < 1 || submitting}
          >
            {submitting ? 'Odesílám…' : 'Odeslat hodnocení'}
          </button>
        </div>
      )}
    </div>
  )
}
