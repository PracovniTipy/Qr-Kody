import { useCallback, useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { supabase } from '../../lib/supabaseClient'
import {
  Card,
  PrsiActionResult,
  PrsiCreateGameResult,
  PrsiFindWaitingGameResult,
  PrsiGetMyHandResult,
  PrsiJoinGameResult,
  PrsiSavedPlayer,
  PrsiSessionRow,
  Rank,
  Suit,
} from '../../types/prsi'

const SUIT_SYMBOL: Record<Suit, string> = { zaludy: '🌰', kule: '🔔', srdce: '♥', listy: '🍃' }
const SUIT_LABEL: Record<Suit, string> = { zaludy: 'žaludy', kule: 'kule', srdce: 'srdce', listy: 'listy' }
const RANK_LABEL: Record<Rank, string> = {
  '7': '7',
  '8': '8',
  '9': '9',
  '10': '10',
  spodek: 'Sp',
  svrsek: 'Sv',
  kral: 'Kr',
  eso: 'Es',
}
const ALL_SUITS: Suit[] = ['zaludy', 'kule', 'srdce', 'listy']
const STORAGE_PREFIX = 'prsi_player_'

type DisplayPhase = 'idle' | 'waiting' | 'playing' | 'finished'

function loadSavedPlayer(tableToken: string): PrsiSavedPlayer | null {
  try {
    const raw = localStorage.getItem(STORAGE_PREFIX + tableToken)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<PrsiSavedPlayer>
    if (
      parsed &&
      typeof parsed.sessionId === 'string' &&
      typeof parsed.playerToken === 'string' &&
      (parsed.playerNo === 1 || parsed.playerNo === 2)
    ) {
      return parsed as PrsiSavedPlayer
    }
    return null
  } catch {
    return null
  }
}

function savePlayer(tableToken: string, player: PrsiSavedPlayer) {
  try {
    localStorage.setItem(STORAGE_PREFIX + tableToken, JSON.stringify(player))
  } catch {
    // Ignorujeme (např. soukromý režim prohlížeče bez localStorage) - hra
    // pak jen nepřežije reload stránky, což nic nerozbije.
  }
}

function clearSavedPlayer(tableToken: string) {
  try {
    localStorage.removeItem(STORAGE_PREFIX + tableToken)
  } catch {
    // ignore
  }
}

function mapReason(reason?: string): string {
  switch (reason) {
    case 'not_your_turn':
      return 'Teď je na tahu soupeř.'
    case 'card_not_in_hand':
      return 'Tuhle kartu nemáš v ruce.'
    case 'card_not_playable':
      return 'Tuhle kartu teď nemůžeš zahrát.'
    case 'missing_declared_suit':
      return 'Musíš vybrat barvu.'
    case 'not_playing':
      return 'Hra právě neběží.'
    case 'invalid_token':
      return 'Neplatná relace, zkus obnovit stránku.'
    default:
      return 'Tah se nepodařil, zkus to znovu.'
  }
}

// Postava (Material "person" ikona) pro figurkove karty - Spodek/Svrsek/Kral.
// Spodek a Svrsek se tradicne rozeznavaji podle toho, jestli je znak barvy
// NAD postavou (Svrsek - "horni") nebo POD ni (Spodek - "dolni"); Kral ma
// misto toho korunku - viz CardFace nize.
const PERSON_PATH =
  'M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z'

function FaceFigure({ rank }: { rank: 'spodek' | 'svrsek' | 'kral' }) {
  if (rank === 'kral') {
    return (
      <svg viewBox="0 0 24 28" width="22" height="24" className="prsi-face-icon" aria-hidden="true">
        <g transform="translate(0,4)">
          <path d={PERSON_PATH} fill="currentColor" />
        </g>
        <g className="prsi-crown">
          <polygon points="5,6 7,1.5 9.5,5 12,0.5 14.5,5 17,1.5 19,6" />
          <rect x="5" y="5.5" width="14" height="2" />
        </g>
      </svg>
    )
  }
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" className="prsi-face-icon" aria-hidden="true">
      <path d={PERSON_PATH} fill="currentColor" />
    </svg>
  )
}

function CardFace({ card }: { card: Card }) {
  const isFace = card.rank === 'spodek' || card.rank === 'svrsek' || card.rank === 'kral'
  return (
    <span className={`prsi-card suit-${card.suit}${isFace ? ' prsi-card-face' : ''}`}>
      <span className="prsi-card-rank">{RANK_LABEL[card.rank]}</span>
      {card.rank === 'svrsek' && <span className="prsi-face-pip prsi-face-pip-top">{SUIT_SYMBOL[card.suit]}</span>}
      {isFace ? (
        <FaceFigure rank={card.rank as 'spodek' | 'svrsek' | 'kral'} />
      ) : (
        <span className="prsi-card-suit">{SUIT_SYMBOL[card.suit]}</span>
      )}
      {card.rank === 'spodek' && (
        <span className="prsi-face-pip prsi-face-pip-bottom">{SUIT_SYMBOL[card.suit]}</span>
      )}
    </span>
  )
}

/**
 * Etapa 4 (rozšíření): "Prší" - dvouhráčová karetní hra pro dva hosty u
 * stejného stolu, každý na svém telefonu. Na rozdíl od jednohráčových
 * arkádovek (GamePage a spol.) tu neběží žádná herní smyčka na klientovi -
 * server (migrace 0014) drží veškerý stav a klient jen posílá tahy přes RPC
 * a čte aktuální stav z prsi_sessions (Realtime + záložní polling, stejný
 * vzor jako KitchenPage) a svoji ruku přes prsi_get_my_hand.
 *
 * Token hráče se ukládá do localStorage podle tokenu stolu, takže reload
 * stránky hráče z rozehrané hry nevyhodí. Najít/založit hru řeší
 * prsi_find_waiting_game + prsi_join_game / prsi_create_game - druhý host u
 * stolu se tak připojí ke hře prvního bez sdílení kódu, jen tím, že si na
 * stejném stole otevře "Prší" a ťukne na Hrát.
 */
export function PrsiGamePage() {
  const { venueSlug, tableToken } = useParams<{ venueSlug: string; tableToken: string }>()

  const [sessionId, setSessionId] = useState<string | null>(null)
  const [myToken, setMyToken] = useState<string | null>(null)
  const [myPlayerNo, setMyPlayerNo] = useState<1 | 2 | null>(null)
  const [session, setSession] = useState<PrsiSessionRow | null>(null)
  const [hand, setHand] = useState<Card[]>([])
  const [starting, setStarting] = useState(false)
  const [acting, setActing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pendingWildCard, setPendingWildCard] = useState<Card | null>(null)
  const [suitChoiceOpen, setSuitChoiceOpen] = useState(false)

  useEffect(() => {
    if (!tableToken) return
    const saved = loadSavedPlayer(tableToken)
    if (saved) {
      setSessionId(saved.sessionId)
      setMyToken(saved.playerToken)
      setMyPlayerNo(saved.playerNo)
    }
  }, [tableToken])

  const loadSession = useCallback(async () => {
    if (!sessionId) return
    const { data, error: loadError } = await supabase
      .from('prsi_sessions')
      .select('*')
      .eq('id', sessionId)
      .maybeSingle()

    if (loadError || !data) {
      // Hra už neexistuje (např. staré testovací session smazané úklidem) -
      // vrátíme hráče na úvodní obrazovku, ať se nezasekne na chybě navždy.
      if (tableToken) clearSavedPlayer(tableToken)
      setSessionId(null)
      setMyToken(null)
      setMyPlayerNo(null)
      setSession(null)
      setHand([])
      return
    }

    setSession(data as PrsiSessionRow)
  }, [sessionId, tableToken])

  const loadHand = useCallback(async () => {
    if (!sessionId || !myToken) return
    const { data } = await supabase.rpc('prsi_get_my_hand', {
      p_session_id: sessionId,
      p_player_token: myToken,
    })
    const result = data as PrsiGetMyHandResult | null
    if (result?.hand) setHand(result.hand)
  }, [sessionId, myToken])

  useEffect(() => {
    loadSession()
    loadHand()
  }, [loadSession, loadHand])

  useEffect(() => {
    if (!sessionId) return

    const channel = supabase
      .channel(`prsi-session-${sessionId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'prsi_sessions', filter: `id=eq.${sessionId}` },
        () => {
          loadSession()
          loadHand()
        }
      )
      .subscribe()

    // Realtime je hlavní cesta, tohle je jen záložní obnovení pro případ výpadku spojení.
    const interval = setInterval(() => {
      loadSession()
      loadHand()
    }, 3000)

    return () => {
      supabase.removeChannel(channel)
      clearInterval(interval)
    }
  }, [sessionId, loadSession, loadHand])

  function applyNewPlayer(newSessionId: string, token: string, playerNo: 1 | 2) {
    if (tableToken) savePlayer(tableToken, { sessionId: newSessionId, playerToken: token, playerNo })
    setSession(null)
    setHand([])
    setSessionId(newSessionId)
    setMyToken(token)
    setMyPlayerNo(playerNo)
  }

  async function startOrJoin() {
    if (!tableToken || starting) return
    setStarting(true)
    setError(null)

    try {
      const { data: foundData } = await supabase.rpc('prsi_find_waiting_game', { p_qr_token: tableToken })
      const found = foundData as PrsiFindWaitingGameResult | null

      if (found?.session_id) {
        const { data: joinData } = await supabase.rpc('prsi_join_game', {
          p_session_id: found.session_id,
          p_qr_token: tableToken,
        })
        const joinResult = joinData as PrsiJoinGameResult | null
        if (joinResult?.ok && joinResult.player_token && joinResult.player_no) {
          applyNewPlayer(found.session_id, joinResult.player_token, joinResult.player_no)
          setStarting(false)
          return
        }
        // Hra mezitím přestala čekat (např. ji obsadil třetí telefon u stolu) - založíme vlastní.
      }

      const { data: createData } = await supabase.rpc('prsi_create_game', { p_qr_token: tableToken })
      const createResult = createData as PrsiCreateGameResult | null
      if (!createResult) {
        setError('Hru se nepodařilo založit. Zkus to znovu.')
        setStarting(false)
        return
      }
      applyNewPlayer(createResult.session_id, createResult.player_token, createResult.player_no)
    } catch {
      setError('Hru se nepodařilo spustit. Zkus to znovu.')
    }
    setStarting(false)
  }

  async function submitPlay(card: Card, declaredSuit: Suit | null) {
    if (!sessionId || !myToken) return
    setActing(true)
    setError(null)
    const { data } = await supabase.rpc('prsi_play_card', {
      p_session_id: sessionId,
      p_player_token: myToken,
      p_card: card,
      p_declared_suit: declaredSuit,
    })
    const result = data as PrsiActionResult | null
    if (!result?.ok) setError(mapReason(result?.reason))
    await loadSession()
    await loadHand()
    setActing(false)
  }

  function handleCardTap(card: Card) {
    if (!isMyTurn || acting) return
    if (card.rank === 'svrsek') {
      setPendingWildCard(card)
      setSuitChoiceOpen(true)
      return
    }
    void submitPlay(card, null)
  }

  function chooseSuit(suit: Suit) {
    if (!pendingWildCard) return
    setSuitChoiceOpen(false)
    const card = pendingWildCard
    setPendingWildCard(null)
    void submitPlay(card, suit)
  }

  async function drawCard() {
    if (!sessionId || !myToken || !isMyTurn || acting) return
    setActing(true)
    setError(null)
    const { data } = await supabase.rpc('prsi_draw_card', {
      p_session_id: sessionId,
      p_player_token: myToken,
    })
    const result = data as PrsiActionResult | null
    if (!result?.ok) setError(mapReason(result?.reason))
    await loadSession()
    await loadHand()
    setActing(false)
  }

  function resetToIdle() {
    if (tableToken) clearSavedPlayer(tableToken)
    setSessionId(null)
    setMyToken(null)
    setMyPlayerNo(null)
    setSession(null)
    setHand([])
    setError(null)
  }

  const opponentPlayerNo: 1 | 2 | null = myPlayerNo === 1 ? 2 : myPlayerNo === 2 ? 1 : null
  const opponentHandCount =
    session && opponentPlayerNo ? (opponentPlayerNo === 1 ? session.hand_count_1 : session.hand_count_2) : 0
  const isMyTurn = !!session && session.status === 'playing' && session.current_turn === myPlayerNo
  const requiredSuit = session?.current_suit ?? session?.discard_top?.suit ?? null

  function isCardPlayable(card: Card): boolean {
    if (!session) return false
    if (session.pending_draw > 0) return card.rank === '7'
    if (card.rank === 'svrsek') return true
    if (requiredSuit && card.suit === requiredSuit) return true
    if (session.discard_top && card.rank === session.discard_top.rank) return true
    return false
  }

  const displayPhase: DisplayPhase = !session ? 'idle' : session.status

  return (
    <div className="game-page prsi-page">
      <header>
        <Link to={`/v/${venueSlug ?? ''}/t/${tableToken ?? ''}`} className="back-link">
          ← Zpět ke stolu
        </Link>
        <h1>🃏 Prší</h1>
      </header>

      {error && <p className="error">{error}</p>}

      {displayPhase === 'idle' && (
        <div className="game-idle">
          <p>
            Prší je karetní hra pro dva hráče u stejného stolu - každý na svém telefonu. Ťukni na Hrát a druhý host
            ať udělá to samé.
          </p>
          <button type="button" onClick={startOrJoin} disabled={starting}>
            {starting ? 'Hledám hru…' : 'Hrát Prší'}
          </button>
        </div>
      )}

      {displayPhase === 'waiting' && (
        <div className="game-idle">
          <p>Čekám na druhého hráče… Ať se druhý host u stejného stolu taky ťukne na "Prší" a připojí se.</p>
          <button type="button" onClick={resetToIdle}>
            Zrušit hledání
          </button>
        </div>
      )}

      {displayPhase === 'playing' && session && (
        <div className="prsi-board">
          <div className="prsi-opponent">
            <span>Soupeř</span>
            <span className="prsi-card-back-stack">
              {opponentHandCount}× <span className="prsi-card back" />
            </span>
          </div>

          <div className="prsi-table">
            <div className="prsi-pile">
              <span className="prsi-card back" />
              <span className="prsi-pile-label">Talon: {session.draw_pile_count}</span>
            </div>
            <div className="prsi-pile">
              {session.discard_top ? <CardFace card={session.discard_top} /> : <span className="prsi-card back" />}
              {session.current_suit && (
                <span className="prsi-declared-suit">
                  Platí: {SUIT_SYMBOL[session.current_suit]} {SUIT_LABEL[session.current_suit]}
                </span>
              )}
            </div>
          </div>

          {session.pending_draw > 0 && <p className="prsi-pending-draw">Dluží se lízání: +{session.pending_draw}</p>}

          <p className="prsi-turn-indicator">{isMyTurn ? 'Jsi na tahu!' : 'Čekej, hraje soupeř…'}</p>

          <div className="prsi-hand">
            {hand.map((card, i) => (
              <button
                key={`${card.rank}${card.suit}-${i}`}
                type="button"
                className={`prsi-hand-card ${isCardPlayable(card) ? 'playable' : ''}`}
                onClick={() => handleCardTap(card)}
                disabled={!isMyTurn || acting}
              >
                <CardFace card={card} />
              </button>
            ))}
          </div>

          <button type="button" className="prsi-draw-button" onClick={drawCard} disabled={!isMyTurn || acting}>
            {acting ? 'Čekej…' : 'Líznout'}
          </button>
        </div>
      )}

      {displayPhase === 'finished' && session && (
        <div className="game-result">
          <p>{session.winner === myPlayerNo ? 'Vyhrál jsi! 🎉' : 'Prohrál jsi.'}</p>
          <button type="button" onClick={resetToIdle}>
            Hrát znovu
          </button>
        </div>
      )}

      {suitChoiceOpen && (
        <div className="prsi-suit-picker-overlay">
          <div className="prsi-suit-picker">
            <p>Vyber barvu, kterou svršek mění:</p>
            <div className="prsi-suit-picker-options">
              {ALL_SUITS.map((s) => (
                <button type="button" className={`suit-${s}`} key={s} onClick={() => chooseSuit(s)}>
                  {SUIT_SYMBOL[s]} <span className="prsi-suit-picker-label">{SUIT_LABEL[s]}</span>
                </button>
              ))}
            </div>
            <button
              type="button"
              className="prsi-suit-picker-cancel"
              onClick={() => {
                setSuitChoiceOpen(false)
                setPendingWildCard(null)
              }}
            >
              Zrušit
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
