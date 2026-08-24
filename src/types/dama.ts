// Tvar dat pro dvouhracovou desktovou hru "Dama" (viz supabase/migrations/0017_games_dama.sql).
// Stejny vzor jako Prsi/Poker - server (SECURITY DEFINER funkce) drzi cely
// stav hry, klient jen posila tahy pres RPC a cte aktualni stav z
// dama_sessions (verejne citelne pres RLS + Realtime). Na rozdil od
// Prsi/Pokeru tu neni zadna skryta informace (obe strany vidi celou desku),
// takze zadna "moje ruka" funkce neni potreba.
//
// Deska je pole 64 policek (index = radek*8 + sloupec, radek i sloupec 0-7),
// kazde bud '' (prazdne), 'w'/'b' (bily/cerny kamen), nebo 'W'/'B' (dama).
// Hraji se jen tmava policka (radek+sloupec liche).

export type DamaStatus = 'waiting' | 'playing' | 'finished'
export type DamaSquare = '' | 'w' | 'b' | 'W' | 'B'

export interface DamaSessionRow {
  id: string
  venue_id: string
  table_id: string
  status: DamaStatus
  board: DamaSquare[]
  current_turn: 1 | 2 | null
  must_continue_from: number | null
  winner: 1 | 2 | null
  created_at: string
  updated_at: string
}

export interface DamaCreateGameResult {
  session_id: string
  player_token: string
  player_no: 1
}

export interface DamaFindWaitingGameResult {
  session_id: string
  created_at: string
}

export interface DamaJoinGameResult {
  ok: boolean
  reason?: string
  player_token?: string
  player_no?: 2
}

export interface DamaMoveResult {
  ok: boolean
  reason?: string
  status?: DamaStatus
  winner?: 1 | 2 | null
  continued?: boolean
}

export interface DamaSavedPlayer {
  sessionId: string
  playerToken: string
  playerNo: 1 | 2
}
