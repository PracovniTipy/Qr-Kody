// Tvar dat pro dvouhracovou karetni hru "Prsi" (viz supabase/migrations/0014_games_prsi.sql).
// Na rozdil od jednohracovych arkadovek (GamePage a spol.) tu nebezi zadna
// smycka na klientovi - veskery stav hry drzi server, klient jen posila tahy
// pres RPC funkce a cte aktualni stav z prsi_sessions (verejne citelne pres
// RLS) + svoji ruku pres prsi_get_my_hand (overenou tajnym tokenem hrace).

export type Suit = 'S' | 'H' | 'D' | 'C'
export type Rank = '7' | '8' | '9' | '10' | 'J' | 'Q' | 'K' | 'A'

export interface Card {
  rank: Rank
  suit: Suit
}

export type PrsiStatus = 'waiting' | 'playing' | 'finished'

export interface PrsiSessionRow {
  id: string
  venue_id: string
  table_id: string
  status: PrsiStatus
  current_turn: 1 | 2 | null
  current_suit: Suit | null
  discard_top: Card | null
  draw_pile_count: number
  hand_count_1: number
  hand_count_2: number
  pending_draw: number
  winner: 1 | 2 | null
  created_at: string
  updated_at: string
}

export interface PrsiCreateGameResult {
  session_id: string
  player_token: string
  player_no: 1
}

export interface PrsiFindWaitingGameResult {
  session_id: string
  created_at: string
}

export interface PrsiJoinGameResult {
  ok: boolean
  reason?: string
  player_token?: string
  player_no?: 2
}

export interface PrsiGetMyHandResult {
  player_no: 1 | 2
  hand: Card[]
}

export interface PrsiActionResult {
  ok: boolean
  reason?: string
  status?: PrsiStatus
  winner?: 1 | 2 | null
  drawn_count?: number
}

export interface PrsiSavedPlayer {
  sessionId: string
  playerToken: string
  playerNo: 1 | 2
}
