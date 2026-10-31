import { useCallback, useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { supabase } from '../../lib/supabaseClient'
import {
  FlaskaGetOrCreateSessionResult,
  FlaskaJoinResult,
  FlaskaSavedPlayer,
  FlaskaSessionRow,
  FlaskaSpinResult,
} from '../../types/flaska'
import { LanguageSwitcher } from '../../components/LanguageSwitcher'
import { useLanguage } from '../../lib/language'

const STORAGE_PREFIX = 'flaska_player_'

function loadSavedPlayer(tableToken: string): FlaskaSavedPlayer | null {
  try {
    const raw = localStorage.getItem(STORAGE_PREFIX + tableToken)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<FlaskaSavedPlayer>
    if (
      parsed &&
      typeof parsed.sessionId === 'string' &&
      typeof parsed.playerId === 'string' &&
      typeof parsed.playerToken === 'string' &&
      typeof parsed.name === 'string'
    ) {
      return parsed as FlaskaSavedPlayer
    }
    return null
  } catch {
    return null
  }
}

function savePlayer(tableToken: string, player: FlaskaSavedPlayer) {
  try {
    localStorage.setItem(STORAGE_PREFIX + tableToken, JSON.stringify(player))
  } catch {
    // Ignorujeme (např. soukromý režim bez localStorage) - hra pak jen nepřežije reload.
  }
}

function clearSavedPlayer(tableToken: string) {
  try {
    localStorage.removeItem(STORAGE_PREFIX + tableToken)
  } catch {
    // ignore
  }
}

/**
 * Etapa 4 (rozšíření): "Flaška" - společenská hra "otoč lahev" pro celý stůl,
 * ne jen pro dva hráče. Kdokoliv u stolu se připojí jménem, kdokoliv
 * připojený může "zatočit lahví" - server (migrace 0019) náhodně vybere
 * jednoho z hráčů jako cíl a nahodnou kartu (Pravda/Úkol) z pevné banky.
 * Žádná skrytá informace, žádné kolo/tah - stav se čte z flaska_sessions
 * (Realtime + záložní polling, stejný vzor jako u ostatních her).
 *
 * Etapa 5b: UI text dvojjazyčně (CS/EN) podle globálního přepínače jazyka.
 * Samotné texty karet (lastSpin.text) jdou z pevné banky na serveru a
 * zůstávají česky - překlad bankovních textů není v téhle etapě v rozsahu.
 */
export function FlaskaGamePage() {
  const { venueSlug, tableToken } = useParams<{ venueSlug: string; tableToken: string }>()
  const { lang } = useLanguage()

  const [sessionId, setSessionId] = useState<string | null>(null)
  const [myPlayerId, setMyPlayerId] = useState<string | null>(null)
  const [myToken, setMyToken] = useState<string | null>(null)
  const [myName, setMyName] = useState<string | null>(null)
  const [session, setSession] = useState<FlaskaSessionRow | null>(null)
  const [nameInput, setNameInput] = useState('')
  const [joining, setJoining] = useState(false)
  const [spinning, setSpinning] = useState(false)
  const [spinAnim, setSpinAnim] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!tableToken) return
    const saved = loadSavedPlayer(tableToken)
    if (saved) {
      setSessionId(saved.sessionId)
      setMyPlayerId(saved.playerId)
      setMyToken(saved.playerToken)
      setMyName(saved.name)
    }
  }, [tableToken])

  const loadSession = useCallback(async () => {
    if (!sessionId) return
    const { data, error: loadError } = await supabase
      .from('flaska_sessions')
      .select('*')
      .eq('id', sessionId)
      .maybeSingle()

    if (loadError || !data) {
      if (tableToken) clearSavedPlayer(tableToken)
      setSessionId(null)
      setMyPlayerId(null)
      setMyToken(null)
      setMyName(null)
      setSession(null)
      return
    }

    setSession(data as FlaskaSessionRow)
  }, [sessionId, tableToken])

  useEffect(() => {
    loadSession()
  }, [loadSession])

  useEffect(() => {
    if (!sessionId) return

    const channel = supabase
      .channel(`flaska-session-${sessionId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'flaska_sessions', filter: `id=eq.${sessionId}` },
        () => loadSession()
      )
      .subscribe()

    const interval = setInterval(loadSession, 3000)

    return () => {
      supabase.removeChannel(channel)
      clearInterval(interval)
    }
  }, [sessionId, loadSession])

  useEffect(() => {
    if (!session?.last_spin) return
    setSpinAnim(true)
    const t = setTimeout(() => setSpinAnim(false), 900)
    return () => clearTimeout(t)
  }, [session?.last_spin])

  async function joinTable() {
    if (!tableToken || joining) return
    const trimmed = nameInput.trim()
    if (!trimmed) {
      setError(lang === 'en' ? 'Please enter your name or nickname.' : 'Napiš, prosím, své jméno nebo přezdívku.')
      return
    }
    setJoining(true)
    setError(null)

    try {
      const { data: sessData } = await supabase.rpc('flaska_get_or_create_session', { p_qr_token: tableToken })
      const sessResult = sessData as FlaskaGetOrCreateSessionResult | null
      if (!sessResult?.session_id) {
        setError(
          lang === 'en' ? "Couldn't find or create the game. Try again." : 'Hru se nepodařilo najít ani založit. Zkus to znovu.'
        )
        setJoining(false)
        return
      }

      const { data: joinData } = await supabase.rpc('flaska_join', {
        p_session_id: sessResult.session_id,
        p_qr_token: tableToken,
        p_name: trimmed,
      })
      const joinResult = joinData as FlaskaJoinResult | null
      if (!joinResult?.ok || !joinResult.player_id || !joinResult.player_token) {
        setError(
          joinResult?.reason === 'full'
            ? lang === 'en'
              ? 'The table is already full (max 10 players).'
              : 'U stolu je už plno (max 10 hráčů).'
            : lang === 'en'
              ? "Couldn't join. Try again."
              : 'Připojení se nepodařilo. Zkus to znovu.'
        )
        setJoining(false)
        return
      }

      const player: FlaskaSavedPlayer = {
        sessionId: sessResult.session_id,
        playerId: joinResult.player_id,
        playerToken: joinResult.player_token,
        name: joinResult.name ?? trimmed,
        emoji: joinResult.emoji ?? '🦊',
      }
      savePlayer(tableToken, player)
      setSession(null)
      setSessionId(player.sessionId)
      setMyPlayerId(player.playerId)
      setMyToken(player.playerToken)
      setMyName(player.name)
    } catch {
      setError(lang === 'en' ? "Couldn't join. Try again." : 'Připojení se nepodařilo. Zkus to znovu.')
    }
    setJoining(false)
  }

  async function spin() {
    if (!sessionId || !myToken || spinning) return
    setSpinning(true)
    setError(null)
    const { data } = await supabase.rpc('flaska_spin', {
      p_session_id: sessionId,
      p_player_token: myToken,
    })
    const result = data as FlaskaSpinResult | null
    if (!result?.ok) {
      setError(lang === 'en' ? 'Spin failed, try again.' : 'Točení se nepodařilo, zkus to znovu.')
    }
    await loadSession()
    setSpinning(false)
  }

  function resetToIdle() {
    if (tableToken) clearSavedPlayer(tableToken)
    setSessionId(null)
    setMyPlayerId(null)
    setMyToken(null)
    setMyName(null)
    setSession(null)
    setError(null)
    setNameInput('')
  }

  const players = session?.players ?? []
  const lastSpin = session?.last_spin ?? null
  const iAmTarget = !!lastSpin && !!myPlayerId && lastSpin.target_id === myPlayerId
  const iAmSpinner = !!lastSpin && !!myPlayerId && lastSpin.spinner_id === myPlayerId

  const joined = !!sessionId && !!myToken

  return (
    <div className="game-page flaska-page">
      <header>
        <LanguageSwitcher />
        <Link to={`/v/${venueSlug ?? ''}/t/${tableToken ?? ''}`} className="back-link">
          {lang === 'en' ? '← Back to table' : '← Zpět ke stolu'}
        </Link>
        <h1>{lang === 'en' ? '🍾 Spin the Bottle' : '🍾 Flaška'}</h1>
      </header>

      {error && <p className="error">{error}</p>}

      {!joined && (
        <div className="game-idle flaska-join">
          <p>
            {lang === 'en'
              ? 'Spin the Bottle is a party game for the whole table (up to 10 players) - join with your name and anyone can then "spin the bottle". It lands on a random player at the table and picks a Truth or Dare card.'
              : 'Flaška je společenská hra pro celý stůl (až 10 hráčů) - připoj se jménem a kdokoliv pak může zatočit "lahví". Padne na náhodného hráče u stolu a vybere se karta Pravda nebo Úkol.'}
          </p>
          <input
            type="text"
            className="flaska-name-input"
            placeholder={lang === 'en' ? 'Your name or nickname' : 'Tvoje jméno nebo přezdívka'}
            value={nameInput}
            maxLength={24}
            onChange={(e) => setNameInput(e.target.value)}
          />
          <button type="button" onClick={joinTable} disabled={joining}>
            {joining ? (lang === 'en' ? 'Joining…' : 'Připojuji…') : lang === 'en' ? 'Join the table' : 'Přidat se ke stolu'}
          </button>
        </div>
      )}

      {joined && session && (
        <div className="flaska-table">
          <p className="flaska-me">
            {lang === 'en' ? 'Playing as: ' : 'Hraješ jako: '}
            {session.players.find((p) => p.id === myPlayerId)?.emoji ?? '🦊'} {myName}
          </p>

          <div className="flaska-players">
            {players.length === 0 && (
              <p>{lang === 'en' ? "No one's here yet - be the first!" : 'Zatím tu nikdo není - buď první!'}</p>
            )}
            {players.map((p) => (
              <span key={p.id} className={`flaska-player-chip ${p.id === myPlayerId ? 'me' : ''}`}>
                {p.emoji} {p.name}
              </span>
            ))}
          </div>

          <div className={`flaska-bottle-wrap ${spinAnim ? 'spinning' : ''}`}>
            <span className="flaska-bottle">🍾</span>
          </div>

          {lastSpin ? (
            <div className={`flaska-card ${lastSpin.category} ${iAmTarget ? 'flaska-card-me' : ''}`}>
              <p className="flaska-card-target">
                {lastSpin.target_emoji} <strong>{lastSpin.target_name}</strong>
                {iAmTarget && (lang === 'en' ? " (that's you!)" : ' (to jsi ty!)')}
              </p>
              <p className="flaska-card-category">
                {lastSpin.category === 'pravda'
                  ? lang === 'en'
                    ? '❓ Truth'
                    : '❓ Pravda'
                  : lang === 'en'
                    ? '🎭 Dare'
                    : '🎭 Úkol'}
              </p>
              <p className="flaska-card-text">{lastSpin.text}</p>
              <p className="flaska-card-meta">
                {lang === 'en' ? 'Spun by: ' : 'Zatočil/a: '}
                {lastSpin.spinner_emoji} {lastSpin.spinner_name}
                {iAmSpinner && (lang === 'en' ? ' (you)' : ' (ty)')}
              </p>
            </div>
          ) : (
            <p className="flaska-hint">
              {lang === 'en' ? 'No one has spun yet. Tap the button below!' : 'Ještě nikdo nezatočil. Ťukni na tlačítko níže!'}
            </p>
          )}

          <button type="button" className="flaska-spin-btn" onClick={spin} disabled={spinning || players.length < 1}>
            {spinning ? (lang === 'en' ? 'Spinning…' : 'Točím…') : lang === 'en' ? 'Spin the bottle' : 'Zatočit lahví'}
          </button>

          <button type="button" className="flaska-leave-btn" onClick={resetToIdle}>
            {lang === 'en' ? 'Leave the table' : 'Odejít od stolu'}
          </button>
        </div>
      )}
    </div>
  )
}
