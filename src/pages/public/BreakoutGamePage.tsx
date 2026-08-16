import { useCallback, useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { supabase } from '../../lib/supabaseClient'
import { BreakoutGame } from '../../games/BreakoutGame'

const GAME_ID = 'breakout'
const GAME_LABEL = 'Rozbíjení lahví'

interface LeaderboardEntry {
  nickname: string
  score: number
  created_at: string
}

type Phase = 'idle' | 'playing' | 'result'

/**
 * Etapa 4 (masterplán, kapitola 11): pátá a poslední arkádová hra se skóre
 * pro hosty u stolu – stejná kostra jako GamePage, FlappyGamePage,
 * RunnerGamePage a ClimbGamePage, jen napojená na BreakoutGame a herní ID
 * 'breakout'. Server (start_game_session / submit_game_score, migrace
 * 0008–0013) hlídá realistickou délku hraní a maximální možné skóre pro
 * danou hru. Žebříček (get_game_leaderboard) je veřejný a anonymní –
 * hráčské účty (kapitola 9, Etapa 9) zatím nejsou, jen volná přezdívka u
 * skóre.
 */
export function BreakoutGamePage() {
  const { venueSlug, tableToken } = useParams<{ venueSlug: string; tableToken: string }>()
  const [phase, setPhase] = useState<Phase>('idle')
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [finalScore, setFinalScore] = useState<number | null>(null)
  const [savedRank, setSavedRank] = useState<number | null>(null)
  const [nickname, setNickname] = useState('')
  const [saving, setSaving] = useState(false)
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([])
  const [error, setError] = useState<string | null>(null)

  const loadLeaderboard = useCallback(async () => {
    if (!tableToken) return
    const { data } = await supabase.rpc('get_game_leaderboard', {
      p_qr_token: tableToken,
      p_game_id: GAME_ID,
      p_limit: 10,
    })
    if (Array.isArray(data)) setLeaderboard(data as LeaderboardEntry[])
  }, [tableToken])

  useEffect(() => {
    loadLeaderboard()
  }, [loadLeaderboard])

  async function startGame() {
    if (!tableToken) return
    setError(null)
    const { data, error: startError } = await supabase.rpc('start_game_session', {
      p_qr_token: tableToken,
      p_game_id: GAME_ID,
    })
    if (startError || !data) {
      setError('Hru se nepodařilo spustit. Zkus to znovu.')
      return
    }
    setSessionId((data as { session_id: string }).session_id)
    setFinalScore(null)
    setSavedRank(null)
    setPhase('playing')
  }

  function handleGameOver(score: number) {
    setFinalScore(score)
    setPhase('result')
  }

  async function submitScore() {
    if (!sessionId || finalScore === null) return
    setSaving(true)
    setError(null)
    const { data, error: submitError } = await supabase.rpc('submit_game_score', {
      p_session_id: sessionId,
      p_score: finalScore,
      p_nickname: nickname.trim() || null,
    })
    setSaving(false)
    const result = data as { ok: boolean; rank?: number } | null
    if (submitError || !result || !result.ok) {
      setError('Skóre se nepodařilo uložit.')
      return
    }
    setSavedRank(result.rank ?? null)
    setSessionId(null)
    setNickname('')
    setPhase('idle')
    loadLeaderboard()
  }

  function playAgain() {
    setFinalScore(null)
    setSavedRank(null)
    setPhase('idle')
  }

  return (
    <div className="game-page">
      <header>
        <Link to={`/v/${venueSlug ?? ''}/t/${tableToken ?? ''}`} className="back-link">
          ← Zpět ke stolu
        </Link>
        <h1>{GAME_LABEL}</h1>
      </header>

      {error && <p className="error">{error}</p>}

      {phase === 'idle' && (
        <div className="game-idle">
          <button type="button" onClick={startGame}>
            Hrát
          </button>
          {savedRank !== null && finalScore !== null && (
            <p className="game-result-hint">
              Uloženo! Tvoje skóre {finalScore} je aktuálně na {savedRank}. místě.
            </p>
          )}
        </div>
      )}

      {phase === 'playing' && <BreakoutGame onGameOver={handleGameOver} />}

      {phase === 'result' && finalScore !== null && (
        <div className="game-result">
          <p>Konec hry! Skóre: {finalScore}</p>
          <input
            value={nickname}
            onChange={(e) => setNickname(e.target.value.slice(0, 20))}
            placeholder="Přezdívka (nepovinná)"
            maxLength={20}
          />
          <div className="game-result-actions">
            <button type="button" onClick={submitScore} disabled={saving}>
              {saving ? 'Ukládám…' : 'Uložit skóre'}
            </button>
            <button type="button" onClick={playAgain} disabled={saving}>
              Zahodit
            </button>
          </div>
        </div>
      )}

      <section className="leaderboard">
        <h2>Žebříček hospody</h2>
        {leaderboard.length === 0 ? (
          <p>Zatím žádné skóre.</p>
        ) : (
          <ol className="leaderboard-list">
            {leaderboard.map((entry, i) => (
              <li key={`${entry.nickname}-${entry.created_at}`}>
                <span className="leaderboard-rank">{i + 1}.</span>
                <span className="leaderboard-name">{entry.nickname}</span>
                <span className="leaderboard-score">{entry.score}</span>
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  )
}
