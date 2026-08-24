import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { supabase } from '../../lib/supabaseClient'
import {
  DamaCreateGameResult,
  DamaFindWaitingGameResult,
  DamaJoinGameResult,
  DamaMoveResult,
  DamaSavedPlayer,
  DamaSessionRow,
  DamaSquare,
} from '../../types/dama'

const STORAGE_PREFIX = 'dama_player_'

type DisplayPhase = 'idle' | 'waiting' | 'playing' | 'finished'
type Capture = { mid: number; to: number }

function loadSavedPlayer(tableToken: string): DamaSavedPlayer | null {
  try {
    const raw = localStorage.getItem(STORAGE_PREFIX + tableToken)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<DamaSavedPlayer>
    if (
      parsed &&
      typeof parsed.sessionId === 'string' &&
      typeof parsed.playerToken === 'string' &&
      (parsed.playerNo === 1 || parsed.playerNo === 2)
    ) {
      return parsed as DamaSavedPlayer
    }
    return null
  } catch {
    return null
  }
}

function savePlayer(tableToken: string, player: DamaSavedPlayer) {
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

function mapReason(reason?: string): string {
  switch (reason) {
    case 'not_your_turn':
      return 'Teď je na tahu soupeř.'
    case 'must_capture':
      return 'Musíš brát - braní je povinné.'
    case 'must_continue':
      return 'Musíš pokračovat v braní stejným kamenem.'
    case 'invalid_move':
      return 'Tenhle tah není možný.'
    case 'not_playing':
      return 'Hra právě neběží.'
    case 'invalid_token':
      return 'Neplatná relace, zkus obnovit stránku.'
    default:
      return 'Tah se nepodařil, zkus to znovu.'
  }
}

function pieceColor(p: DamaSquare): 'w' | 'b' | null {
  if (p === 'w' || p === 'W') return 'w'
  if (p === 'b' || p === 'B') return 'b'
  return null
}

const DIRS: Array<[number, number]> = [
  [-1, -1],
  [-1, 1],
  [1, -1],
  [1, 1],
]

function sq(row: number, col: number): number | null {
  return row >= 0 && row < 8 && col >= 0 && col < 8 ? row * 8 + col : null
}

// Klientske kopie serverove logiky (supabase/migrations/0017_games_dama.sql) -
// pouziva se JEN pro zvyrazneni moznych tahu v UI, server je vzdy autoritativni
// a kazdy tah znovu overi sam.
function capturesForPiece(board: DamaSquare[], idx: number): Capture[] {
  const piece = board[idx]
  if (!piece) return []
  const color = pieceColor(piece)
  const row = Math.floor(idx / 8)
  const col = idx % 8
  const result: Capture[] = []
  for (const [dr, dc] of DIRS) {
    const midIdx = sq(row + dr, col + dc)
    const toIdx = sq(row + 2 * dr, col + 2 * dc)
    if (midIdx === null || toIdx === null) continue
    const midPiece = board[midIdx]
    const toPiece = board[toIdx]
    if (midPiece && pieceColor(midPiece) !== color && !toPiece) {
      result.push({ mid: midIdx, to: toIdx })
    }
  }
  return result
}

function simpleMovesForPiece(board: DamaSquare[], idx: number): number[] {
  const piece = board[idx]
  if (!piece) return []
  const row = Math.floor(idx / 8)
  const col = idx % 8
  const dirs: Array<[number, number]> =
    piece === 'w' ? [[1, -1], [1, 1]] : piece === 'b' ? [[-1, -1], [-1, 1]] : DIRS
  const result: number[] = []
  for (const [dr, dc] of dirs) {
    const toIdx = sq(row + dr, col + dc)
    if (toIdx !== null && board[toIdx] === '') result.push(toIdx)
  }
  return result
}

function anyCaptureAvailable(board: DamaSquare[], color: 'w' | 'b'): boolean {
  for (let idx = 0; idx < 64; idx++) {
    if (pieceColor(board[idx]) === color && capturesForPiece(board, idx).length > 0) return true
  }
  return false
}

/**
 * Etapa 4 (rozšíření): "Dáma" - dvouhráčová desková hra pro dva hosty u
 * stejného stolu, každý na svém telefonu. Server (migrace 0017) drží celý
 * stav (deska, kdo je na tahu, povinné pokračování v braní...), klient jen
 * posílá jednotlivé "skoky" přes dama_move a čte stav z dama_sessions
 * (Realtime + záložní polling, stejný vzor jako Prší/Poker).
 *
 * Deska se hráči 2 (černý) zobrazuje otočená vzhůru nohama, ať má taky své
 * kameny dole u sebe - server ale vždy pracuje s kanonickými souřadnicemi
 * (řádek 0 nahoře, bílý dole), otočení je čistě vizuální na klientovi.
 */
export function DamaGamePage() {
  const { venueSlug, tableToken } = useParams<{ venueSlug: string; tableToken: string }>()

  const [sessionId, setSessionId] = useState<string | null>(null)
  const [myToken, setMyToken] = useState<string | null>(null)
  const [myPlayerNo, setMyPlayerNo] = useState<1 | 2 | null>(null)
  const [session, setSession] = useState<DamaSessionRow | null>(null)
  const [starting, setStarting] = useState(false)
  const [acting, setActing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<number | null>(null)

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
      .from('dama_sessions')
      .select('*')
      .eq('id', sessionId)
      .maybeSingle()

    if (loadError || !data) {
      if (tableToken) clearSavedPlayer(tableToken)
      setSessionId(null)
      setMyToken(null)
      setMyPlayerNo(null)
      setSession(null)
      return
    }

    setSession(data as DamaSessionRow)
  }, [sessionId, tableToken])

  useEffect(() => {
    loadSession()
  }, [loadSession])

  useEffect(() => {
    if (!sessionId) return

    const channel = supabase
      .channel(`dama-session-${sessionId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'dama_sessions', filter: `id=eq.${sessionId}` },
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
    setSelected(null)
  }, [session?.board, session?.current_turn])

  function applyNewPlayer(newSessionId: string, token: string, playerNo: 1 | 2) {
    if (tableToken) savePlayer(tableToken, { sessionId: newSessionId, playerToken: token, playerNo })
    setSession(null)
    setSessionId(newSessionId)
    setMyToken(token)
    setMyPlayerNo(playerNo)
  }

  async function startOrJoin() {
    if (!tableToken || starting) return
    setStarting(true)
    setError(null)

    try {
      const { data: foundData } = await supabase.rpc('dama_find_waiting_game', { p_qr_token: tableToken })
      const found = foundData as DamaFindWaitingGameResult | null

      if (found?.session_id) {
        const { data: joinData } = await supabase.rpc('dama_join_game', {
          p_session_id: found.session_id,
          p_qr_token: tableToken,
        })
        const joinResult = joinData as DamaJoinGameResult | null
        if (joinResult?.ok && joinResult.player_token && joinResult.player_no) {
          applyNewPlayer(found.session_id, joinResult.player_token, joinResult.player_no)
          setStarting(false)
          return
        }
      }

      const { data: createData } = await supabase.rpc('dama_create_game', { p_qr_token: tableToken })
      const createResult = createData as DamaCreateGameResult | null
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

  const myColor: 'w' | 'b' | null = myPlayerNo === 1 ? 'w' : myPlayerNo === 2 ? 'b' : null
  const isMyTurn = !!session && session.status === 'playing' && session.current_turn === myPlayerNo
  const board = session?.board ?? []

  const mustCaptureFrom = session?.must_continue_from ?? null
  const captureMandatory = useMemo(() => {
    if (!session || !myColor) return false
    if (mustCaptureFrom !== null) return true
    return anyCaptureAvailable(board, myColor)
  }, [session, myColor, board, mustCaptureFrom])

  const legalTargets: number[] = useMemo(() => {
    if (selected === null || !session) return []
    if (captureMandatory) return capturesForPiece(board, selected).map((c) => c.to)
    return simpleMovesForPiece(board, selected)
  }, [selected, session, board, captureMandatory])

  function canSelect(idx: number): boolean {
    if (!isMyTurn || !myColor || acting) return false
    if (mustCaptureFrom !== null) return idx === mustCaptureFrom
    if (pieceColor(board[idx]) !== myColor) return false
    if (captureMandatory) return capturesForPiece(board, idx).length > 0
    return simpleMovesForPiece(board, idx).length > 0
  }

  async function submitMove(to: number) {
    if (!sessionId || !myToken || selected === null) return
    setActing(true)
    setError(null)
    const { data } = await supabase.rpc('dama_move', {
      p_session_id: sessionId,
      p_player_token: myToken,
      p_from: selected,
      p_to: to,
    })
    const result = data as DamaMoveResult | null
    if (!result?.ok) setError(mapReason(result?.reason))
    setSelected(null)
    await loadSession()
    setActing(false)
  }

  function handleSquareTap(idx: number) {
    if (acting) return
    if (selected !== null && legalTargets.includes(idx)) {
      void submitMove(idx)
      return
    }
    if (canSelect(idx)) {
      setSelected(idx)
    } else if (selected !== null) {
      setSelected(null)
    }
  }

  function resetToIdle() {
    if (tableToken) clearSavedPlayer(tableToken)
    setSessionId(null)
    setMyToken(null)
    setMyPlayerNo(null)
    setSession(null)
    setError(null)
    setSelected(null)
  }

  const displayPhase: DisplayPhase = !session ? 'idle' : session.status
  const flip = myPlayerNo === 2

  const orderedSquares = useMemo(() => {
    const indices = Array.from({ length: 64 }, (_, i) => i)
    return flip ? indices.slice().reverse() : indices
  }, [flip])

  return (
    <div className="game-page dama-page">
      <header>
        <Link to={`/v/${venueSlug ?? ''}/t/${tableToken ?? ''}`} className="back-link">
          ← Zpět ke stolu
        </Link>
        <h1>⚫ Dáma</h1>
      </header>

      {error && <p className="error">{error}</p>}

      {displayPhase === 'idle' && (
        <div className="game-idle">
          <p>
            Dáma je desková hra pro dva hráče u stejného stolu - každý na svém telefonu. Braní je povinné - pokud
            můžeš brát, musíš. Ťukni na Hrát a druhý host ať udělá to samé.
          </p>
          <button type="button" onClick={startOrJoin} disabled={starting}>
            {starting ? 'Hledám hru…' : 'Hrát Dámu'}
          </button>
        </div>
      )}

      {displayPhase === 'waiting' && (
        <div className="game-idle">
          <p>Čekám na druhého hráče… Ať se druhý host u stejného stolu taky ťukne na "Dáma" a připojí se.</p>
          <button type="button" onClick={resetToIdle}>
            Zrušit hledání
          </button>
        </div>
      )}

      {displayPhase === 'playing' && session && (
        <div className="dama-board-wrap">
          <p className="dama-color-indicator">
            Hraješ za: {myColor === 'w' ? '⚪ bílé' : '⚫ černé'}
          </p>
          <p className="dama-turn-indicator">
            {isMyTurn ? (captureMandatory ? 'Jsi na tahu - musíš brát!' : 'Jsi na tahu!') : 'Čekej, hraje soupeř…'}
          </p>
          <div className="dama-board">
            {orderedSquares.map((idx) => {
              const row = Math.floor(idx / 8)
              const col = idx % 8
              const dark = (row + col) % 2 === 1
              const piece = board[idx]
              const isSelected = selected === idx
              const isTarget = legalTargets.includes(idx)
              const selectable = dark && canSelect(idx)
              return (
                <button
                  type="button"
                  key={idx}
                  className={`dama-square ${dark ? 'dark' : 'light'} ${isSelected ? 'selected' : ''} ${
                    isTarget ? 'target' : ''
                  } ${selectable ? 'selectable' : ''}`}
                  onClick={() => dark && handleSquareTap(idx)}
                  disabled={!dark || (!selectable && !isTarget)}
                >
                  {piece === 'w' && <span className="dama-piece piece-w" />}
                  {piece === 'b' && <span className="dama-piece piece-b" />}
                  {piece === 'W' && <span className="dama-piece piece-w king" />}
                  {piece === 'B' && <span className="dama-piece piece-b king" />}
                  {isTarget && <span className="dama-target-dot" />}
                </button>
              )
            })}
          </div>
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
    </div>
  )
}
