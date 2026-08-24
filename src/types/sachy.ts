// Tvar dat pro dvouhracovou desktovou hru "Sachy" (viz supabase/migrations/0018_games_sachy.sql).
// Stejny vzor jako Prsi/Poker/Dama - server (SECURITY DEFINER funkce) drzi
// cely stav hry, klient jen posila tahy pres RPC a cte aktualni stav ze
// sachy_sessions (verejne citelne pres RLS + Realtime). Zadna skryta
// informace (obe strany vidi celou desku), takze zadna "moje ruka" funkce
// neni potreba.
//
// Deska je pole 64 policek (index = radek*8 + sloupec, radek 0 = 1. rada
// (bila domovska), radek 7 = 8. rada (cerna domovska), sloupec 0 = "a").
// Kazde policko je '' (prazdne), nebo pismeno figury - velke pro bileho
// (P N B R Q K), male pro cerneho (p n b r q k).

export type ChessStatus = 'waiting' | 'playing' | 'finished'
export type ChessPiece = '' | 'P' | 'N' | 'B' | 'R' | 'Q' | 'K' | 'p' | 'n' | 'b' | 'r' | 'q' | 'k'
export type ChessGameOverReason = 'checkmate' | 'stalemate' | null

export interface ChessCastlingRights {
  wk: boolean
  wq: boolean
  bk: boolean
  bq: boolean
}

export interface ChessLastMove {
  from: number
  to: number
}

export interface ChessSessionRow {
  id: string
  venue_id: string
  table_id: string
  status: ChessStatus
  board: ChessPiece[]
  current_turn: 1 | 2 | null
  castling: ChessCastlingRights
  en_passant: number | null
  last_move: ChessLastMove | null
  winner: 1 | 2 | null
  game_over_reason: ChessGameOverReason
  created_at: string
  updated_at: string
}

export interface ChessCreateGameResult {
  session_id: string
  player_token: string
  player_no: 1
}

export interface ChessFindWaitingGameResult {
  session_id: string
  created_at: string
}

export interface ChessJoinGameResult {
  ok: boolean
  reason?: string
  player_token?: string
  player_no?: 2
}

export interface ChessMoveResult {
  ok: boolean
  reason?: string
  status?: ChessStatus
  winner?: 1 | 2 | null
  check?: boolean
}

export interface ChessSavedPlayer {
  sessionId: string
  playerToken: string
  playerNo: 1 | 2
}
