import { useCallback, useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { supabase } from '../../lib/supabaseClient'
import { FlappyGame } from '../../games/FlappyGame'
import { LanguageSwitcher } from '../../components/LanguageSwitcher'
import { useLanguage } from '../../lib/language'

const GAME_ID = 'flappy'
const GAME_LABEL_CS = 'Let mezi sudy'
const GAME_LABEL_EN = 'Flight between barrels'

interface LeaderboardEntry {
  nickname: string
  score: number
  created_at: string
}

type Phase = 'idle' | 'playing' | 'result'

/**
 * Etapa 4 (masterplán, kapitola 11): arkádová hra pro hosty u stolu – stejná
 * kostra jako GamePage (Chytání padajících surovin), jen napojená na
 * FlappyGame a herní ID 'flappy'. Server (start_game_session /
 * submit_game_score, migrace 0008-0010) hlídá realistickou délku hraní a
 * maximální možné skóre pro danou hru. Žebříček (get_game_leaderboard) je
 * veřejný a anonymní – hráčské účty (kapitola 9, Etapa 9) zatím nejsou, jen
 * dobrovolná přezdívka u skóre.
 *
 * Etapa 5b: UI text dvojjazyčně (CS/EN) podle globálního přepínače jazyka.
 */
export function FlappyGamePage() {
  const { venueSlug, tableToken } = useParams<{ venueSlug: string; tableToken: string }>()
  const { lang } = useLanguage()
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
      setError(lang === 'en' ? "Couldn't start the game. Try again." : 'Hru se nepodařilo spustit. Zkus to znovu.')
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
      setError(lang === 'en' ? "Couldn't save the score." : 'Skóre se nepodařilo uložit.')
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
        <LanguageSwitcher />
        <Link to={`/v/${venueSlug ?? ''}/t/${tableToken ?? ''}`} className="back-link">
          {lang === 'en' ? '← Back to table' : '← Zpět ke stolu'}
        </Link>
        <h1>{lang === 'en' ? GAME_LABEL_EN : GAME_LABEL_CS}</h1>
      </header>

      {error && <p className="error">{error}</p>}

      {phase === 'idle' && (
        <div className="game-idle">
          <button type="button" onClick={startGame}>
            {lang === 'en' ? 'Play' : 'Hrát'}
          </button>
          {savedRank !== null && finalScore !== null && (
            <p className="game-result-hint">
              {lang === 'en'
                ? `Saved! Your score ${finalScore} is currently rank ${savedRank}.`
                : `Uloženo! Tvoje skóre ${finalScore} je aktuálně na ${savedRank}. místě.`}
            </p>
          )}
        </div>
      )}

      {phase === 'playing' && <FlappyGame onGameOver={handleGameOver} />}

      {phase === 'result' && finalScore !== null && (
        <div className="game-result">
          <p>{lang === 'en' ? `Game over! Score: ${finalScore}` : `Konec hry! Skóre: ${finalScore}`}</p>
          <input
            value={nickname}
            onChange={(e) => setNickname(e.target.value.slice(0, 20))}
            placeholder={lang === 'en' ? 'Nickname (optional)' : 'Přezdívka (nepovinné)'}
            maxLength={20}
          />
          <div className="game-result-actions">
            <button type="button" onClick={submitScore} disabled={saving}>
              {saving ? (lang === 'en' ? 'Saving…' : 'Ukládám…') : lang === 'en' ? 'Save score' : 'Uložit skóre'}
            </button>
            <button type="button" onClick={playAgain} disabled={saving}>
              {lang === 'en' ? 'Discard' : 'Zahodit'}
            </button>
          </div>
        </div>
      )}

      <section className="leaderboard">
        <h2>{lang === 'en' ? 'Pub leaderboard' : 'Žebříček hospody'}</h2>
        {leaderboard.length === 0 ? (
          <p>{lang === 'en' ? 'No scores yet.' : 'Zatím žádné skóre.'}</p>
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
