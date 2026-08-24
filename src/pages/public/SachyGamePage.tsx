import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { supabase } from '../../lib/supabaseClient'
import {
  ChessCastlingRights,
  ChessCreateGameResult,
  ChessFindWaitingGameResult,
  ChessJoinGameResult,
  ChessMoveResult,
  ChessPiece,
  ChessSavedPlayer,
  ChessSessionRow,
} from '../../types/sachy'

const STORAGE_PREFIX = 'sachy_player_'

type DisplayPhase = 'idle' | 'waiting' | 'playing' | 'finished'
type Promotion = 'Q' | 'R' | 'B' | 'N'

const PIECE_GLYPH: Record<string, string> = {
  P: '♙',
  N: '♘',
  B: '♗',
  R: '♖',
  Q: '♕',
  K: '♔',
  p: '♟',
  n: '♞',
  b: '♝',
  r: '♜',
  q: '♛',
  k: '♚',
}

const PROMOTION_CHOICES: Array<{ value: Promotion; label: string }> = [
  { value: 'Q', label: 'Dáma' },
  { value: 'R', label: 'Věž' },
  { value: 'B', label: 'Střelec' },
  { value: 'N', label: 'Jezdec' },
]

function loadSavedPlayer(tableToken: string): ChessSavedPlayer | null {
  try {
    const raw = localStorage.getItem(STORAGE_PREFIX + tableToken)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<ChessSavedPlayer>
    if (
      parsed &&
      typeof parsed.sessionId === 'string' &&
      typeof parsed.playerToken === 'string' &&
      (parsed.playerNo === 1 || parsed.playerNo === 2)
    ) {
      return parsed as ChessSavedPlayer
    }
    return null
  } catch {
    return null
  }
}

function savePlayer(tableToken: string, player: ChessSavedPlayer) {
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

function pieceColor(p: ChessPiece): 'w' | 'b' | null {
  if (!p) return null
  return p === p.toUpperCase() ? 'w' : 'b'
}

// Klientske kopie serverove logiky (supabase/migrations/0018_games_sachy.sql) -
// pouzivaji se JEN pro zvyrazneni moznych tahu v UI, server je vzdy
// autoritativni a kazdy tah znovu overi sam.

function pathClear(board: ChessPiece[], from: number, to: number): boolean {
  const ff = from % 8
  const fr = Math.floor(from / 8)
  const tf = to % 8
  const tr = Math.floor(to / 8)
  const dfile = Math.sign(tf - ff)
  const drank = Math.sign(tr - fr)
  let cf = ff
  let cr = fr
  for (;;) {
    cf += dfile
    cr += drank
    if (cf === tf && cr === tr) break
    if (board[cr * 8 + cf] !== '') return false
  }
  return true
}

function attacks(board: ChessPiece[], from: number, to: number): boolean {
  const piece = board[from]
  if (!piece) return false
  const color = pieceColor(piece)
  const type = piece.toUpperCase()
  const ff = from % 8
  const fr = Math.floor(from / 8)
  const tf = to % 8
  const tr = Math.floor(to / 8)
  const df = Math.abs(tf - ff)
  const dr = Math.abs(tr - fr)

  if (type === 'P') return color === 'w' ? df === 1 && tr - fr === 1 : df === 1 && tr - fr === -1
  if (type === 'N') return (df === 1 && dr === 2) || (df === 2 && dr === 1)
  if (type === 'K') return df <= 1 && dr <= 1 && df + dr > 0
  if (type === 'B') return df === dr && df > 0 && pathClear(board, from, to)
  if (type === 'R') return ((df === 0 && dr > 0) || (dr === 0 && df > 0)) && pathClear(board, from, to)
  if (type === 'Q')
    return ((df === dr && df > 0) || (df === 0 && dr > 0) || (dr === 0 && df > 0)) && pathClear(board, from, to)
  return false
}

function isSquareAttacked(board: ChessPiece[], sq: number, byColor: 'w' | 'b'): boolean {
  for (let i = 0; i < 64; i++) {
    const piece = board[i]
    if (piece && pieceColor(piece) === byColor && attacks(board, i, sq)) return true
  }
  return false
}

function findKing(board: ChessPiece[], color: 'w' | 'b'): number | null {
  const target = color === 'w' ? 'K' : 'k'
  const idx = board.findIndex((p) => p === target)
  return idx === -1 ? null : idx
}

function applyRawMove(
  board: ChessPiece[],
  from: number,
  to: number,
  promotion: Promotion | null,
  enPassant: number | null
): ChessPiece[] {
  const next = board.slice()
  const piece = next[from]
  const type = piece.toUpperCase()
  const color = pieceColor(piece)
  const fromFile = from % 8
  const toFile = to % 8
  const fromRank = Math.floor(from / 8)

  if (type === 'P' && toFile !== fromFile && next[to] === '' && to === enPassant) {
    next[fromRank * 8 + toFile] = ''
  }

  if (type === 'K' && Math.abs(toFile - fromFile) === 2) {
    if (toFile === 6) {
      next[from + 3] = ''
      next[from + 1] = color === 'w' ? 'R' : 'r'
    } else if (toFile === 2) {
      next[from - 4] = ''
      next[from - 1] = color === 'w' ? 'R' : 'r'
    }
  }

  let targetPiece: ChessPiece = piece
  if (type === 'P' && (Math.floor(to / 8) === 7 || Math.floor(to / 8) === 0) && promotion) {
    targetPiece = (color === 'w' ? promotion : promotion.toLowerCase()) as ChessPiece
  }

  next[from] = ''
  next[to] = targetPiece
  return next
}

function pseudoLegal(
  board: ChessPiece[],
  from: number,
  to: number,
  turn: 'w' | 'b',
  castling: ChessCastlingRights,
  enPassant: number | null
): boolean {
  if (from < 0 || from > 63 || to < 0 || to > 63 || from === to) return false
  const piece = board[from]
  if (!piece) return false
  const color = pieceColor(piece)
  if (color !== turn) return false
  const type = piece.toUpperCase()
  const target = board[to]
  const targetColor = pieceColor(target)
  if (targetColor === color) return false

  const ff = from % 8
  const fr = Math.floor(from / 8)
  const tf = to % 8
  const tr = Math.floor(to / 8)
  const df = tf - ff
  const dr = tr - fr

  if (type === 'P') {
    if (color === 'w') {
      if (df === 0 && dr === 1 && target === '') return true
      if (df === 0 && dr === 2 && fr === 1 && target === '' && board[from + 8] === '') return true
      if (Math.abs(df) === 1 && dr === 1 && (targetColor === 'b' || to === enPassant)) return true
      return false
    }
    if (df === 0 && dr === -1 && target === '') return true
    if (df === 0 && dr === -2 && fr === 6 && target === '' && board[from - 8] === '') return true
    if (Math.abs(df) === 1 && dr === -1 && (targetColor === 'w' || to === enPassant)) return true
    return false
  }
  if (type === 'N') return (Math.abs(df) === 1 && Math.abs(dr) === 2) || (Math.abs(df) === 2 && Math.abs(dr) === 1)
  if (type === 'B') return Math.abs(df) === Math.abs(dr) && df !== 0 && pathClear(board, from, to)
  if (type === 'R') return ((df === 0 && dr !== 0) || (dr === 0 && df !== 0)) && pathClear(board, from, to)
  if (type === 'Q')
    return (
      ((Math.abs(df) === Math.abs(dr) && df !== 0) || (df === 0 && dr !== 0) || (dr === 0 && df !== 0)) &&
      pathClear(board, from, to)
    )
  if (type === 'K') {
    if (Math.abs(df) <= 1 && Math.abs(dr) <= 1 && Math.abs(df) + Math.abs(dr) > 0) return true
    if (Math.abs(df) === 2 && dr === 0) {
      if (color === 'w' && from === 4) {
        if (
          df === 2 &&
          castling.wk &&
          board[7] === 'R' &&
          board[5] === '' &&
          board[6] === '' &&
          !isSquareAttacked(board, 4, 'b') &&
          !isSquareAttacked(board, 5, 'b') &&
          !isSquareAttacked(board, 6, 'b')
        )
          return true
        if (
          df === -2 &&
          castling.wq &&
          board[0] === 'R' &&
          board[1] === '' &&
          board[2] === '' &&
          board[3] === '' &&
          !isSquareAttacked(board, 4, 'b') &&
          !isSquareAttacked(board, 3, 'b') &&
          !isSquareAttacked(board, 2, 'b')
        )
          return true
      } else if (color === 'b' && from === 60) {
        if (
          df === 2 &&
          castling.bk &&
          board[63] === 'r' &&
          board[61] === '' &&
          board[62] === '' &&
          !isSquareAttacked(board, 60, 'w') &&
          !isSquareAttacked(board, 61, 'w') &&
          !isSquareAttacked(board, 62, 'w')
        )
          return true
        if (
          df === -2 &&
          castling.bq &&
          board[56] === 'r' &&
          board[57] === '' &&
          board[58] === '' &&
          board[59] === '' &&
          !isSquareAttacked(board, 60, 'w') &&
          !isSquareAttacked(board, 59, 'w') &&
          !isSquareAttacked(board, 58, 'w')
        )
          return true
      }
    }
    return false
  }
  return false
}

function isLegalMove(
  board: ChessPiece[],
  from: number,
  to: number,
  turn: 'w' | 'b',
  castling: ChessCastlingRights,
  enPassant: number | null
): boolean {
  if (!pseudoLegal(board, from, to, turn, castling, enPassant)) return false
  const newBoard = applyRawMove(board, from, to, 'Q', enPassant)
  const kingSq = findKing(newBoard, turn)
  if (kingSq === null) return false
  return !isSquareAttacked(newBoard, kingSq, turn === 'w' ? 'b' : 'w')
}

function legalTargetsForSquare(
  board: ChessPiece[],
  from: number,
  turn: 'w' | 'b',
  castling: ChessCastlingRights,
  enPassant: number | null
): number[] {
  const targets: number[] = []
  for (let to = 0; to < 64; to++) {
    if (isLegalMove(board, from, to, turn, castling, enPassant)) targets.push(to)
  }
  return targets
}

/**
 * Etapa 4 (rozšíření): "Šachy" - dvouhráčová desková hra pro dva hosty u
 * stejného stolu, každý na svém telefonu. Server (migrace 0018) drží celý
 * stav (deska, kdo je na tahu, práva na rošádu, cíl braní mimochodem...),
 * klient jen posílá jednotlivé tahy přes sachy_move a čte stav ze
 * sachy_sessions (Realtime + záložní polling, stejný vzor jako Prší/Poker/Dáma).
 *
 * Deska se hráči 2 (černý) zobrazuje otočená vzhůru nohama, ať má taky své
 * figurky dole u sebe - server ale vždy pracuje s kanonickými souřadnicemi
 * (řádek 0 dole = 1. řada, bílý dole), otočení je čistě vizuální na klientovi.
 */
export function SachyGamePage() {
  const { venueSlug, tableToken } = useParams<{ venueSlug: string; tableToken: string }>()

  const [sessionId, setSessionId] = useState<string | null>(null)
  const [myToken, setMyToken] = useState<string | null>(null)
  const [myPlayerNo, setMyPlayerNo] = useState<1 | 2 | null>(null)
  const [session, setSession] = useState<ChessSessionRow | null>(null)
  const [starting, setStarting] = useState(false)
  const [acting, setActing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<number | null>(null)
  const [pendingPromotion, setPendingPromotion] = useState<{ from: number; to: number } | null>(null)

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
      .from('sachy_sessions')
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

    setSession(data as ChessSessionRow)
  }, [sessionId, tableToken])

  useEffect(() => {
    loadSession()
  }, [loadSession])

  useEffect(() => {
    if (!sessionId) return

    const channel = supabase
      .channel(`sachy-session-${sessionId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'sachy_sessions', filter: `id=eq.${sessionId}` },
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
    setPendingPromotion(null)
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
      const { data: foundData } = await supabase.rpc('sachy_find_waiting_game', { p_qr_token: tableToken })
      const found = foundData as ChessFindWaitingGameResult | null

      if (found?.session_id) {
        const { data: joinData } = await supabase.rpc('sachy_join_game', {
          p_session_id: found.session_id,
          p_qr_token: tableToken,
        })
        const joinResult = joinData as ChessJoinGameResult | null
        if (joinResult?.ok && joinResult.player_token && joinResult.player_no) {
          applyNewPlayer(found.session_id, joinResult.player_token, joinResult.player_no)
          setStarting(false)
          return
        }
      }

      const { data: createData } = await supabase.rpc('sachy_create_game', { p_qr_token: tableToken })
      const createResult = createData as ChessCreateGameResult | null
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
  const castling = session?.castling ?? { wk: false, wq: false, bk: false, bq: false }
  const enPassant = session?.en_passant ?? null

  const legalTargets: number[] = useMemo(() => {
    if (selected === null || !session || !myColor) return []
    return legalTargetsForSquare(board, selected, myColor, castling, enPassant)
  }, [selected, session, myColor, board, castling, enPassant])

  function canSelect(idx: number): boolean {
    if (!isMyTurn || !myColor || acting) return false
    if (pieceColor(board[idx]) !== myColor) return false
    return legalTargetsForSquare(board, idx, myColor, castling, enPassant).length > 0
  }

  async function submitMove(from: number, to: number, promotion: Promotion | null) {
    if (!sessionId || !myToken) return
    setActing(true)
    setError(null)
    const { data } = await supabase.rpc('sachy_move', {
      p_session_id: sessionId,
      p_player_token: myToken,
      p_from: from,
      p_to: to,
      p_promotion: promotion,
    })
    const result = data as ChessMoveResult | null
    if (!result?.ok) setError(mapReason(result?.reason))
    setSelected(null)
    setPendingPromotion(null)
    await loadSession()
    setActing(false)
  }

  function handleSquareTap(idx: number) {
    if (acting || pendingPromotion) return
    if (selected !== null && legalTargets.includes(idx)) {
      const piece = board[selected]
      const isPromotion = piece.toUpperCase() === 'P' && (Math.floor(idx / 8) === 7 || Math.floor(idx / 8) === 0)
      if (isPromotion) {
        setPendingPromotion({ from: selected, to: idx })
        return
      }
      void submitMove(selected, idx, null)
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
    setPendingPromotion(null)
  }

  const displayPhase: DisplayPhase = !session ? 'idle' : session.status
  const flip = myPlayerNo === 2

  const orderedSquares = useMemo(() => {
    const indices = Array.from({ length: 64 }, (_, i) => i)
    return flip ? indices.slice().reverse() : indices
  }, [flip])

  const opponentInCheck = useMemo(() => {
    if (!session || session.status !== 'playing' || session.current_turn === null) return false
    const turnColor: 'w' | 'b' = session.current_turn === 1 ? 'w' : 'b'
    const kingSq = findKing(board, turnColor)
    if (kingSq === null) return false
    return isSquareAttacked(board, kingSq, turnColor === 'w' ? 'b' : 'w')
  }, [session, board])

  return (
    <div className="game-page sachy-page">
      <header>
        <Link to={`/v/${venueSlug ?? ''}/t/${tableToken ?? ''}`} className="back-link">
          ← Zpět ke stolu
        </Link>
        <h1>♞ Šachy</h1>
      </header>

      {error && <p className="error">{error}</p>}

      {displayPhase === 'idle' && (
        <div className="game-idle">
          <p>
            Šachy jsou desková hra pro dva hráče u stejného stolu - každý na svém telefonu. Klasická pravidla včetně
            rošády, braní mimochodem a proměny pěšce. Ťukni na Hrát a druhý host ať udělá to samé.
          </p>
          <button type="button" onClick={startOrJoin} disabled={starting}>
            {starting ? 'Hledám hru…' : 'Hrát Šachy'}
          </button>
        </div>
      )}

      {displayPhase === 'waiting' && (
        <div className="game-idle">
          <p>Čekám na druhého hráče… Ať se druhý host u stejného stolu taky ťukne na "Šachy" a připojí se.</p>
          <button type="button" onClick={resetToIdle}>
            Zrušit hledání
          </button>
        </div>
      )}

      {displayPhase === 'playing' && session && (
        <div className="sachy-board-wrap">
          <p className="sachy-color-indicator">Hraješ za: {myColor === 'w' ? '⚪ bílé' : '⚫ černé'}</p>
          <p className="sachy-turn-indicator">
            {isMyTurn
              ? opponentInCheck
                ? 'Jsi na tahu - máš šach!'
                : 'Jsi na tahu!'
              : opponentInCheck
              ? 'Soupeř má šach…'
              : 'Čekej, hraje soupeř…'}
          </p>
          <div className="sachy-board">
            {orderedSquares.map((idx) => {
              const row = Math.floor(idx / 8)
              const col = idx % 8
              const dark = (row + col) % 2 === 1
              const piece = board[idx]
              const isSelected = selected === idx
              const isTarget = legalTargets.includes(idx)
              const isLastMove = session.last_move && (session.last_move.from === idx || session.last_move.to === idx)
              const selectable = canSelect(idx)
              return (
                <button
                  type="button"
                  key={idx}
                  className={`sachy-square ${dark ? 'dark' : 'light'} ${isSelected ? 'selected' : ''} ${
                    isTarget ? 'target' : ''
                  } ${selectable ? 'selectable' : ''} ${isLastMove ? 'last-move' : ''}`}
                  onClick={() => handleSquareTap(idx)}
                  disabled={!selectable && !isTarget}
                >
                  {piece && (
                    <span className={`sachy-piece ${pieceColor(piece) === 'w' ? 'piece-w' : 'piece-b'}`}>
                      {PIECE_GLYPH[piece]}
                    </span>
                  )}
                  {isTarget && <span className="sachy-target-dot" />}
                </button>
              )
            })}
          </div>

          {pendingPromotion && (
            <div className="sachy-promotion-overlay">
              <div className="sachy-promotion-picker">
                <p>Na co proměnit pěšce?</p>
                <div className="sachy-promotion-options">
                  {PROMOTION_CHOICES.map((choice) => (
                    <button
                      type="button"
                      key={choice.value}
                      onClick={() => void submitMove(pendingPromotion.from, pendingPromotion.to, choice.value)}
                    >
                      <span className="sachy-face-icon">{PIECE_GLYPH[myColor === 'w' ? choice.value : choice.value.toLowerCase()]}</span>
                      <span className="sachy-promotion-label">{choice.label}</span>
                    </button>
                  ))}
                </div>
                <button
                  type="button"
                  className="sachy-promotion-cancel"
                  onClick={() => setPendingPromotion(null)}
                >
                  Zrušit
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {displayPhase === 'finished' && session && (
        <div className="game-result">
          <p>
            {session.game_over_reason === 'stalemate'
              ? 'Pat - remíza.'
              : session.winner === myPlayerNo
              ? 'Vyhrál jsi matem! 🎉'
              : 'Prohrál jsi matem.'}
          </p>
          <button type="button" onClick={resetToIdle}>
            Hrát znovu
          </button>
        </div>
      )}
    </div>
  )
}
