import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { supabase } from '../../lib/supabaseClient'
import { gameLabel } from '../../lib/gameLabels'
import { ActiveTournament, TournamentLeaderboardResult } from '../../types/tournament'

/**
 * Turnaje (masterplán, "co zbývá": turnaje) - veřejná stránka pro hosty.
 * Zobrazí aktuálně běžící turnaje hospody a žebříček každého z nich.
 * Žebříček je jen výřez existující tabulky game_scores podle času turnaje
 * (get_tournament_leaderboard, migrace 0025) - skóre se pořád ukládá stejně
 * jako dřív přes submit_game_score na stránce dané hry.
 */
export function TournamentsPage() {
  const { venueSlug, tableToken } = useParams<{ venueSlug: string; tableToken: string }>()
  const [tournaments, setTournaments] = useState<ActiveTournament[]>([])
  const [boards, setBoards] = useState<Record<string, TournamentLeaderboardResult>>({})
  const [status, setStatus] = useState<'loading' | 'ok' | 'error'>('loading')

  useEffect(() => {
    if (!tableToken) return
    let active = true

    async function load() {
      const { data, error } = await supabase.rpc('get_active_tournaments', { p_qr_token: tableToken })
      if (!active) return
      if (error || !Array.isArray(data)) {
        setStatus('error')
        return
      }
      const list = data as ActiveTournament[]
      setTournaments(list)

      const entries = await Promise.all(
        list.map(async (t) => {
          const { data: lb } = await supabase.rpc('get_tournament_leaderboard', {
            p_qr_token: tableToken,
            p_tournament_id: t.id,
            p_limit: 10,
          })
          return [t.id, lb as TournamentLeaderboardResult] as const
        })
      )
      if (!active) return
      setBoards(Object.fromEntries(entries))
      setStatus('ok')
    }

    load()

    return () => {
      active = false
    }
  }, [tableToken])

  return (
    <div className="game-page tournaments-page">
      <header>
        <Link to={`/v/${venueSlug ?? ''}/t/${tableToken ?? ''}`} className="back-link">
          ← Zpět ke stolu
        </Link>
        <h1>🏆 Turnaje</h1>
      </header>

      {status === 'loading' && <p>Načítám…</p>}

      {status === 'error' && <p className="error">Turnaje se nepodařilo načíst. Zkus to znovu.</p>}

      {status === 'ok' && tournaments.length === 0 && <p>Momentálně tu neběží žádný turnaj.</p>}

      {tournaments.map((t) => {
        const board = boards[t.id]
        return (
          <section key={t.id} className="leaderboard tournament-board">
            <h2>
              {t.name}
              <span className="tournament-game-label"> — {gameLabel(t.game_id)}</span>
            </h2>
            {t.ends_at && (
              <p className="tournament-ends-hint">
                Končí {new Date(t.ends_at).toLocaleString('cs-CZ', {
                  day: 'numeric',
                  month: 'numeric',
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </p>
            )}
            {!board || board.scores.length === 0 ? (
              <p>Zatím žádné skóre.</p>
            ) : (
              <ol className="leaderboard-list">
                {board.scores.map((entry, i) => (
                  <li key={`${entry.nickname}-${entry.created_at}`}>
                    <span className="leaderboard-rank">{i + 1}.</span>
                    <span className="leaderboard-name">{entry.nickname}</span>
                    <span className="leaderboard-score">{entry.score}</span>
                  </li>
                ))}
              </ol>
            )}
          </section>
        )
      })}
    </div>
  )
}
