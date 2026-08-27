import { FormEvent, useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { supabase } from '../../lib/supabaseClient'
import { SCORE_GAME_LABELS, gameLabel } from '../../lib/gameLabels'
import { TournamentRow } from '../../types/tournament'

interface ScoreEntry {
  nickname: string | null
  score: number
  created_at: string
}

/**
 * Turnaje (masterplán, "co zbývá": turnaje) - administrace pro personál/
 * majitele. Založení a čtení jde přímo přes Supabase klienta, chráněné RLS
 * pravidly tournaments_select_staff / tournaments_write_staff (migrace
 * 0025) - stejný vzor jako Kategorie a položky menu (MenuManager). Žebříček
 * turnaje se čte přímo z game_scores díky nové staff RLS policy
 * (game_scores_select_staff) - stejný vzor jako Tržby (RevenuePage).
 */
export function TournamentsAdminPage() {
  const { venueId } = useParams<{ venueId: string }>()
  const [tournaments, setTournaments] = useState<TournamentRow[]>([])
  const [scores, setScores] = useState<Record<string, ScoreEntry[]>>({})
  const [status, setStatus] = useState<'loading' | 'ok' | 'error'>('loading')

  const [name, setName] = useState('')
  const [gameId, setGameId] = useState('kosik')
  const [durationHours, setDurationHours] = useState('')
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)

  async function loadTournaments() {
    if (!venueId) return
    const { data, error } = await supabase
      .from('tournaments')
      .select('*')
      .eq('venue_id', venueId)
      .order('starts_at', { ascending: false })

    if (error) {
      setStatus('error')
      return
    }

    const rows = (data ?? []) as TournamentRow[]
    setTournaments(rows)
    setStatus('ok')

    const entries = await Promise.all(
      rows.map(async (t) => {
        const { data: sc } = await supabase
          .from('game_scores')
          .select('nickname, score, created_at')
          .eq('venue_id', venueId)
          .eq('game_id', t.game_id)
          .gte('created_at', t.starts_at)
          .lte('created_at', t.ends_at ?? new Date().toISOString())
          .order('score', { ascending: false })
          .limit(10)
        return [t.id, (sc ?? []) as ScoreEntry[]] as const
      })
    )
    setScores(Object.fromEntries(entries))
  }

  useEffect(() => {
    loadTournaments()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [venueId])

  async function handleCreate(e: FormEvent) {
    e.preventDefault()
    if (!venueId || !name.trim()) return
    setCreating(true)
    setCreateError(null)

    const hours = durationHours.trim() ? Number(durationHours) : null
    const endsAt = hours && hours > 0 ? new Date(Date.now() + hours * 3600_000).toISOString() : null

    const { error } = await supabase.from('tournaments').insert({
      venue_id: venueId,
      game_id: gameId,
      name: name.trim(),
      ends_at: endsAt,
    })

    setCreating(false)

    if (error) {
      setCreateError(error.message)
      return
    }

    setName('')
    setDurationHours('')
    loadTournaments()
  }

  async function handleEndNow(tournament: TournamentRow) {
    if (!window.confirm(`Ukončit turnaj "${tournament.name}" teď?`)) return
    const { error } = await supabase
      .from('tournaments')
      .update({ ends_at: new Date().toISOString() })
      .eq('id', tournament.id)
    if (!error) loadTournaments()
  }

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

  const now = Date.now()

  return (
    <div className="revenue-page tournaments-admin-page">
      <header>
        <div>
          <Link to={`/admin/hospoda/${venueId ?? ''}`} className="back-link">
            ← Zpět na hospodu
          </Link>
          <h1>Turnaje</h1>
        </div>
      </header>

      <div className="panel">
        <h2>Nový turnaj</h2>
        <form className="inline-form" onSubmit={handleCreate}>
          <select value={gameId} onChange={(e) => setGameId(e.target.value)}>
            {Object.entries(SCORE_GAME_LABELS).map(([id, label]) => (
              <option key={id} value={id}>
                {label}
              </option>
            ))}
          </select>
          <input
            placeholder="Název turnaje"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
          />
          <input
            type="number"
            min={0}
            placeholder="Trvání v hodinách (nepovinné)"
            value={durationHours}
            onChange={(e) => setDurationHours(e.target.value)}
          />
          <button type="submit" disabled={creating}>
            {creating ? 'Zakládám…' : 'Založit turnaj'}
          </button>
        </form>
        {createError && <p className="error">{createError}</p>}
        <p className="menu-item-desc">
          Bez vyplněné doby trvání turnaj běží, dokud ho ručně neukončíš.
        </p>
      </div>

      {tournaments.length === 0 && <p>Zatím žádné turnaje.</p>}

      {tournaments.map((t) => {
        const isActive = new Date(t.starts_at).getTime() <= now && (!t.ends_at || new Date(t.ends_at).getTime() > now)
        const entries = scores[t.id] ?? []
        return (
          <div key={t.id} className="panel tournament-admin-card">
            <div className="entity-main category-header">
              <h3>
                {t.name}
                <span className="menu-name-en"> — {gameLabel(t.game_id)}</span>
                <span className={`tournament-status ${isActive ? 'active' : 'ended'}`}>
                  {isActive ? 'Aktivní' : 'Ukončený'}
                </span>
              </h3>
              {isActive && (
                <button type="button" className="danger" onClick={() => handleEndNow(t)}>
                  Ukončit teď
                </button>
              )}
            </div>

            {entries.length === 0 ? (
              <p>Zatím žádné skóre.</p>
            ) : (
              <ol className="leaderboard-list">
                {entries.map((entry, i) => (
                  <li key={`${entry.nickname}-${entry.created_at}`}>
                    <span className="leaderboard-rank">{i + 1}.</span>
                    <span className="leaderboard-name">{entry.nickname ?? 'Anonym'}</span>
                    <span className="leaderboard-score">{entry.score}</span>
                  </li>
                ))}
              </ol>
            )}
          </div>
        )
      })}
    </div>
  )
}
