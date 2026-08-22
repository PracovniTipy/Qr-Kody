// Tvar dat pro vicehracovou hru "Poker" (Texas Hold'em, az 8 hracu u stolu,
// viz supabase/migrations/0016_games_poker.sql). Stejny vzor jako Prsi
// (types/prsi.ts) - veskery stav drzi server, klient jen posila RPC volani
// a cte verejny stav z poker_sessions/poker_players (RLS cteni pro vsechny)
// + svoje karty pres poker_get_my_cards (overene tajnym tokenem hrace).
//
// Mezinarodni 52listovy balicek (2-10, J, Q, K, A x 4 barvy) - na rozdil od
// Prsi, ktera pouziva cesky marasovy balicek.

export type Suit = 'S' | 'H' | 'D' | 'C'
export type Rank = '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | '10' | 'J' | 'Q' | 'K' | 'A'

export interface Card {
  rank: Rank
  suit: Suit
}

export type PokerStatus = 'waiting' | 'playing' | 'finished'
export type PokerStage = 'preflop' | 'flop' | 'turn' | 'river' | 'showdown'
export type PlayerStatus = 'active' | 'folded' | 'all_in' | 'out'

export interface PokerSessionRow {
  id: string
  venue_id: string
  table_id: string
  status: PokerStatus
  stage: PokerStage
  max_players: number
  small_blind: number
  big_blind: number
  starting_chips: number
  dealer_seat: number | null
  to_act_seat: number | null
  current_bet: number
  min_raise: number
  pot: number
  community_cards: Card[]
  hand_number: number
  last_result: PokerLastResult | null
  winner_seat: number | null
  created_at: string
  updated_at: string
}

export interface PokerPlayerRow {
  session_id: string
  seat_no: number
  chips: number
  bet_this_round: number
  committed_this_hand: number
  status: PlayerStatus
  acted_this_round: boolean
  created_at: string
}

export interface PokerPotResult {
  amount: number
  winners: number[]
  eligible_seats: number[]
}

export interface PokerReveal {
  seat: number
  cards: Card[]
  category: number
}

export interface PokerLastResult {
  type: 'fold_win' | 'showdown'
  amount?: number
  winner_seats?: number[]
  pots?: PokerPotResult[]
  reveals?: PokerReveal[]
}

export interface PokerCreateGameResult {
  session_id: string
  player_token: string
  seat_no: number
}

export interface PokerFindWaitingGameResult {
  session_id: string
  seat_count: number
}

export interface PokerJoinGameResult {
  ok: boolean
  reason?: string
  player_token?: string
  seat_no?: number
}

export interface PokerGetMyCardsResult {
  seat_no: number
  cards: Card[]
}

export interface PokerActionResult {
  ok: boolean
  reason?: string
}

export interface PokerSavedPlayer {
  sessionId: string
  playerToken: string
  seatNo: number
}
