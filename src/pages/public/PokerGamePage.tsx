import { useCallback, useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { supabase } from '../../lib/supabaseClient'
import {
  Card,
  PokerActionResult,
  PokerCreateGameResult,
  PokerFindWaitingGameResult,
  PokerGetMyCardsResult,
  PokerJoinGameResult,
  PokerPlayerRow,
  PokerSavedPlayer,
  PokerSessionRow,
  PokerStage,
} from '../../types/poker'

const SUIT_SYMBOL: Record<string, string> = { S: '♠', H: '♥', D: '♦', C: '♣' }
const RED_SUITS = new Set(['H', 'D'])
const STORAGE_PREFIX = 'poker_player_'
const STAGE_LABEL: Record<PokerStage, string> = {
  preflop: 'Před flopem',
  flop: 'Flop',
  turn: 'Turn',
  river: 'Řeka',
  showdown: 'Vyhodnocení',
}
const CATEGORY_LABEL = [
  'Vysoká karta',
  'Pár',
  'Dvě dvojice',
  'Trojice',
  'Postupka',
  'Barva',
  'Full house',
  'Čtveřice',
  'Postupka v barvě',
]

function loadSavedPlayer(tableToken: string): PokerSavedPlayer | null {
  try {
    const raw = localStorage.getItem(STORAGE_PREFIX + tableToken)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<PokerSavedPlayer>
    if (parsed && typeof parsed.sessionId === 'string' && typeof parsed.playerToken === 'string' && typeof parsed.seatNo === 'number') {
      return parsed as PokerSavedPlayer
    }
    return null
  } catch {
    return null
  }
}

function savePlayer(tableToken: string, player: PokerSavedPlayer) {
  try {
    localStorage.setItem(STORAGE_PREFIX + tableToken, JSON.stringify(player))
  } catch {
    // Ignorujeme (napr. soukromy rezim bez localStorage) - hra pak jen neprezije reload.
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
      return 'Teď je na tahu někdo jiný.'
    case 'not_active':
      return 'Momentálně nemůžeš hrát (složil jsi karty, nebo jsi all-in).'
    case 'must_call':
      return 'Musíš dorovnat, nebo složit karty.'
    case 'nothing_to_call':
      return 'Není co dorovnávat - zkontroluj (check).'
    case 'invalid_amount':
      return 'Zadej platnou částku.'
    case 'not_enough_chips':
      return 'Nemáš tolik žetonů.'
    case 'raise_too_small':
      return 'Navýšení musí být větší.'
    case 'not_playing':
      return 'Hra právě neběží.'
    case 'invalid_token':
      return 'Neplatná relace, zkus obnovit stránku.'
    case 'not_waiting':
      return 'Hra už začala.'
    case 'need_players':
      return 'Potřeba aspoň 2 hráče u stolu.'
    case 'full':
      return 'Stůl je plný (max 8 hráčů).'
    case 'not_ready':
      return 'Ještě není konec kola.'
    default:
      return 'Akci se nepodařilo provést, zkus to znovu.'
  }
}

function CardFace({ card }: { card: Card }) {
  const isRed = RED_SUITS.has(card.suit)
  return (
    <span className={`poker-card ${isRed ? 'red' : 'black'}`}>
      <span className="poker-card-rank">{card.rank}</span>
      <span className="poker-card-suit">{SUIT_SYMBOL[card.suit]}</span>
    </span>
  )
}

/**
 * Etapa 4 (rozsireni): "Poker" (Texas Hold'em) pro az 8 hostu u stejeho
 * stolu, kazdy na svem telefonu. Na rozdil od Prsi (2 hraci, jednoduchy
 * stav) tu server (migrace 0016) drzi cely stav sazeciho automatu - kolo
 * sazeni, spolecne karty, pot, kdo je na tahu - a klient jen posila tahy
 * pres poker_player_action a cte stav z poker_sessions/poker_players
 * (Realtime + zalozni polling, stejny vzor jako Prsi).
 */
export function PokerGamePage() {
  const { venueSlug, tableToken } = useParams<{ venueSlug: string; tableToken: string }>()

  const [sessionId, setSessionId] = useState<string | null>(null)
  const [myToken, setMyToken] = useState<string | null>(null)
  const [mySeatNo, setMySeatNo] = useState<number | null>(null)
  const [session, setSession] = useState<PokerSessionRow | null>(null)
  const [players, setPlayers] = useState<PokerPlayerRow[]>([])
  const [myCards, setMyCards] = useState<Card[]>([])
  const [starting, setStarting] = useState(false)
  const [acting, setActing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [raiseAmount, setRaiseAmount] = useState<number>(0)

  useEffect(() => {
    if (!tableToken) return
    const saved = loadSavedPlayer(tableToken)
    if (saved) {
      setSessionId(saved.sessionId)
      setMyToken(saved.playerToken)
      setMySeatNo(saved.seatNo)
    }
  }, [tableToken])

  const loadSession = useCallback(async () => {
    if (!sessionId) return
    const { data, error: loadError } = await supabase.from('poker_sessions').select('*').eq('id', sessionId).maybeSingle()

    if (loadError || !data) {
      if (tableToken) clearSavedPlayer(tableToken)
      setSessionId(null)
      setMyToken(null)
      setMySeatNo(null)
      setSession(null)
      setPlayers([])
      setMyCards([])
      return
    }

    setSession(data as PokerSessionRow)
  }, [sessionId, tableToken])

  const loadPlayers = useCallback(async () => {
    if (!sessionId) return
    const { data } = await supabase.from('poker_players').select('*').eq('session_id', sessionId).order('seat_no')
    if (Array.isArray(data)) setPlayers(data as PokerPlayerRow[])
  }, [sessionId])

  const loadMyCards = useCallback(async () => {
    if (!sessionId || !myToken) return
    const { data } = await supabase.rpc('poker_get_my_cards', { p_session_id: sessionId, p_player_token: myToken })
    const result = data as PokerGetMyCardsResult | null
    if (result?.cards) setMyCards(result.cards)
  }, [sessionId, myToken])

  const refreshAll = useCallback(() => {
    loadSession()
    loadPlayers()
    loadMyCards()
  }, [loadSession, loadPlayers, loadMyCards])

  useEffect(() => {
    refreshAll()
  }, [refreshAll])

  useEffect(() => {
    if (!sessionId) return

    const channel = supabase
      .channel(`poker-session-${sessionId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'poker_sessions', filter: `id=eq.${sessionId}` }, refreshAll)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'poker_players', filter: `session_id=eq.${sessionId}` }, refreshAll)
      .subscribe()

    const interval = setInterval(refreshAll, 3000)

    return () => {
      supabase.removeChannel(channel)
      clearInterval(interval)
    }
  }, [sessionId, refreshAll])

  function applyNewPlayer(newSessionId: string, token: string, seatNo: number) {
    if (tableToken) savePlayer(tableToken, { sessionId: newSessionId, playerToken: token, seatNo })
    setSession(null)
    setPlayers([])
    setMyCards([])
    setSessionId(newSessionId)
    setMyToken(token)
    setMySeatNo(seatNo)
  }

  async function startOrJoin() {
    if (!tableToken || starting) return
    setStarting(true)
    setError(null)

    try {
      const { data: foundData } = await supabase.rpc('poker_find_waiting_game', { p_qr_token: tableToken })
      const found = foundData as PokerFindWaitingGameResult | null

      if (found?.session_id) {
        const { data: joinData } = await supabase.rpc('poker_join_game', {
          p_session_id: found.session_id,
          p_qr_token: tableToken,
        })
        const joinResult = joinData as PokerJoinGameResult | null
        if (joinResult?.ok && joinResult.player_token && joinResult.seat_no) {
          applyNewPlayer(found.session_id, joinResult.player_token, joinResult.seat_no)
          setStarting(false)
          return
        }
        // Stul mezitim zaplnil nekdo jiny, nebo hra prestala cekat - zalozime vlastni.
      }

      const { data: createData } = await supabase.rpc('poker_create_game', { p_qr_token: tableToken })
      const createResult = createData as PokerCreateGameResult | null
      if (!createResult) {
        setError('Hru se nepodařilo založit. Zkus to znovu.')
        setStarting(false)
        return
      }
      applyNewPlayer(createResult.session_id, createResult.player_token, createResult.seat_no)
    } catch {
      setError('Hru se nepodařilo spustit. Zkus to znovu.')
    }
    setStarting(false)
  }

  async function beginGame() {
    if (!sessionId || !myToken || acting) return
    setActing(true)
    setError(null)
    const { data } = await supabase.rpc('poker_start_game', { p_session_id: sessionId, p_player_token: myToken })
    const result = data as PokerActionResult | null
    if (!result?.ok) setError(mapReason(result?.reason))
    await refreshAll()
    setActing(false)
  }

  async function nextHand() {
    if (!sessionId || !myToken || acting) return
    setActing(true)
    setError(null)
    const { data } = await supabase.rpc('poker_next_hand', { p_session_id: sessionId, p_player_token: myToken })
    const result = data as PokerActionResult | null
    if (!result?.ok) setError(mapReason(result?.reason))
    await refreshAll()
    setActing(false)
  }

  async function act(action: 'fold' | 'check' | 'call' | 'bet' | 'raise', amount?: number) {
    if (!sessionId || !myToken || acting) return
    setActing(true)
    setError(null)
    const { data } = await supabase.rpc('poker_player_action', {
      p_session_id: sessionId,
      p_player_token: myToken,
      p_action: action,
      p_amount: amount ?? null,
    })
    const result = data as PokerActionResult | null
    if (!result?.ok) setError(mapReason(result?.reason))
    await refreshAll()
    setActing(false)
  }

  function resetToIdle() {
    if (tableToken) clearSavedPlayer(tableToken)
    setSessionId(null)
    setMyToken(null)
    setMySeatNo(null)
    setSession(null)
    setPlayers([])
    setMyCards([])
    setError(null)
  }

  const myPlayer = players.find((p) => p.seat_no === mySeatNo) ?? null
  const isMyTurn = !!session && session.status === 'playing' && session.stage !== 'showdown' && session.to_act_seat === mySeatNo
  const callAmount = session && myPlayer ? Math.max(0, Math.min(session.current_bet - myPlayer.bet_this_round, myPlayer.chips)) : 0
  const canCheck = !!session && !!myPlayer && myPlayer.bet_this_round === session.current_bet
  const allInTotal = myPlayer ? myPlayer.bet_this_round + myPlayer.chips : 0
  const minRaiseTotal = session ? Math.min(session.current_bet === 0 ? session.big_blind : session.current_bet + session.min_raise, allInTotal) : 0

  useEffect(() => {
    if (isMyTurn) setRaiseAmount(minRaiseTotal)
  }, [isMyTurn, minRaiseTotal])

  const displayPhase = !session
    ? 'idle'
    : session.status === 'finished'
      ? 'finished'
      : session.status === 'waiting'
        ? 'waiting'
        : session.stage === 'showdown'
          ? 'showdown'
          : 'playing'

  const seatCount = players.length

  return (
    <div className="game-page poker-page">
      <header>
        <Link to={`/v/${venueSlug ?? ''}/t/${tableToken ?? ''}`} className="back-link">
          ← Zpět ke stolu
        </Link>
        <h1>♠️ Poker</h1>
      </header>

      {error && <p className="error">{error}</p>}

      {displayPhase === 'idle' && (
        <div className="game-idle">
          <p>
            Texas Hold'em poker pro 2 až 8 hráčů u stejného stolu - každý na svém telefonu. Ťukni na Hrát a hraje se
            na žetony (bez skutečných peněz), na vyřazování - kdo přijde o všechny žetony, je ze hry.
          </p>
          <button type="button" onClick={startOrJoin} disabled={starting}>
            {starting ? 'Připojuji…' : 'Hrát Poker'}
          </button>
        </div>
      )}

      {displayPhase === 'waiting' && session && (
        <div className="game-idle">
          <p>
            U stolu čeká {seatCount} {seatCount === 1 ? 'hráč' : seatCount < 5 ? 'hráči' : 'hráčů'} (max 8). Ať se
            další hosté u stolu taky ťuknou na "Poker" a připojí se, nebo hru rovnou začni.
          </p>
          <ul className="poker-waiting-list">
            {players.map((p) => (
              <li key={p.seat_no}>
                Hráč {p.seat_no} {p.seat_no === mySeatNo ? '(Ty)' : ''}
              </li>
            ))}
          </ul>
          <button type="button" onClick={beginGame} disabled={acting || seatCount < 2}>
            {acting ? 'Spouštím…' : 'Začít hru'}
          </button>
          <button type="button" className="poker-secondary" onClick={resetToIdle}>
            Odejít od stolu
          </button>
        </div>
      )}

      {(displayPhase === 'playing' || displayPhase === 'showdown') && session && (
        <div className="poker-board">
          <p className="poker-stage-label">
            Kolo {session.hand_number} · {STAGE_LABEL[session.stage]} · Pot: {session.pot}
          </p>

          <div className="poker-community">
            {session.community_cards.length === 0 ? (
              <span className="poker-community-empty">— zatím žádné spol. karty —</span>
            ) : (
              session.community_cards.map((c, i) => <CardFace card={c} key={`${c.rank}${c.suit}-${i}`} />)
            )}
          </div>

          <ul className="poker-seats">
            {players.map((p) => (
              <li
                key={p.seat_no}
                className={`poker-seat status-${p.status}${p.seat_no === session.to_act_seat ? ' on-turn' : ''}${
                  p.seat_no === mySeatNo ? ' is-me' : ''
                }`}
              >
                <span className="poker-seat-name">
                  Hráč {p.seat_no}
                  {p.seat_no === mySeatNo ? ' (Ty)' : ''}
                  {p.seat_no === session.dealer_seat ? ' · D' : ''}
                </span>
                <span className="poker-seat-chips">{p.chips} žetonů</span>
                {p.bet_this_round > 0 && <span className="poker-seat-bet">vklad: {p.bet_this_round}</span>}
                {p.status === 'folded' && <span className="poker-seat-status">Složil</span>}
                {p.status === 'all_in' && <span className="poker-seat-status">All-in</span>}
                {p.status === 'out' && <span className="poker-seat-status">Mimo hru</span>}
                {p.seat_no === session.to_act_seat && session.stage !== 'showdown' && (
                  <span className="poker-seat-status on-turn-label">Na tahu</span>
                )}
              </li>
            ))}
          </ul>

          {myCards.length > 0 && (
            <div className="poker-my-hand">
              <span className="poker-my-hand-label">Tvoje karty:</span>
              {myCards.map((c, i) => (
                <CardFace card={c} key={`${c.rank}${c.suit}-${i}`} />
              ))}
            </div>
          )}

          {displayPhase === 'playing' && (
            <p className="poker-turn-indicator">
              {isMyTurn ? 'Jsi na tahu!' : `Čekej, hraje hráč ${session.to_act_seat ?? '?'}…`}
            </p>
          )}

          {displayPhase === 'playing' && isMyTurn && myPlayer && (
            <div className="poker-actions">
              <button type="button" onClick={() => act('fold')} disabled={acting} className="poker-fold">
                Složit
              </button>
              {canCheck ? (
                <button type="button" onClick={() => act('check')} disabled={acting}>
                  Zkontrolovat
                </button>
              ) : (
                <button type="button" onClick={() => act('call')} disabled={acting || callAmount <= 0}>
                  Dorovnat {callAmount}
                </button>
              )}
              {allInTotal > session.current_bet && (
                <div className="poker-raise-row">
                  <input
                    type="number"
                    min={minRaiseTotal}
                    max={allInTotal}
                    step={session.big_blind}
                    value={raiseAmount}
                    onChange={(e) => setRaiseAmount(Number(e.target.value))}
                  />
                  <button
                    type="button"
                    onClick={() => act(session.current_bet === 0 ? 'bet' : 'raise', raiseAmount)}
                    disabled={acting}
                  >
                    {session.current_bet === 0 ? 'Vsadit' : 'Navýšit na'}
                  </button>
                  <button type="button" className="poker-secondary" onClick={() => act('raise', allInTotal)} disabled={acting}>
                    All-in ({allInTotal})
                  </button>
                </div>
              )}
            </div>
          )}

          {displayPhase === 'showdown' && session.last_result && (
            <div className="poker-result">
              {session.last_result.type === 'fold_win' ? (
                <p>
                  Hráč {session.last_result.winner_seats?.[0]} vyhrál pot ({session.last_result.amount}) - ostatní
                  složili karty.
                </p>
              ) : (
                <>
                  <ul className="poker-reveals">
                    {session.last_result.reveals?.map((r) => (
                      <li key={r.seat}>
                        Hráč {r.seat}: {r.cards.map((c) => `${c.rank}${SUIT_SYMBOL[c.suit]}`).join(' ')} —{' '}
                        {CATEGORY_LABEL[r.category] ?? '?'}
                      </li>
                    ))}
                  </ul>
                  <ul className="poker-pots">
                    {session.last_result.pots?.map((pot, i) => (
                      <li key={i}>
                        Pot {pot.amount}: vyhrál{pot.winners.length > 1 ? 'i' : ''} hráč{pot.winners.length > 1 ? 'i' : ''}{' '}
                        {pot.winners.join(', ')}
                      </li>
                    ))}
                  </ul>
                </>
              )}
              <button type="button" onClick={nextHand} disabled={acting}>
                {acting ? 'Rozdávám…' : 'Další kolo'}
              </button>
            </div>
          )}
        </div>
      )}

      {displayPhase === 'finished' && session && (
        <div className="game-result">
          <p>{session.winner_seat === mySeatNo ? 'Vyhrál jsi celý stůl! 🎉' : `Hru vyhrál hráč ${session.winner_seat}.`}</p>
          <button type="button" onClick={resetToIdle}>
            Hrát znovu
          </button>
        </div>
      )}
    </div>
  )
}
