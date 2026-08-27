// Tvar dat pro spolecenskou hru "Flaska" (otoc lahev) pro cely stul - viz
// supabase/migrations/0019_games_flaska.sql. Na rozdil od 1v1 her (Prsi,
// Poker, Dama, Sachy) tu neni "waiting"/"playing" zivotni cyklus - hra na
// stole zije cely vecer a kdokoliv se muze kdykoliv pripojit. Server drzi
// seznam hracu a posledni "tocenku", klient jen posila flaska_join a
// flaska_spin a cte aktualni stav z flaska_sessions (verejne pres RLS +
// Realtime).

export type FlaskaCardCategory = 'pravda' | 'ukol'

export interface FlaskaPlayer {
  id: string
  name: string
  emoji: string
}

export interface FlaskaSpin {
  spinner_id: string
  spinner_name: string
  spinner_emoji: string
  target_id: string
  target_name: string
  target_emoji: string
  category: FlaskaCardCategory
  text: string
  at: string
}

export interface FlaskaSessionRow {
  id: string
  venue_id: string
  table_id: string
  players: FlaskaPlayer[]
  used_cards: number[]
  last_spin: FlaskaSpin | null
  spin_count: number
  created_at: string
  updated_at: string
}

export interface FlaskaGetOrCreateSessionResult {
  session_id: string
}

export interface FlaskaJoinResult {
  ok: boolean
  reason?: string
  player_id?: string
  player_token?: string
  name?: string
  emoji?: string
}

export interface FlaskaSpinResult {
  ok: boolean
  reason?: string
  spin?: FlaskaSpin
}

export interface FlaskaSavedPlayer {
  sessionId: string
  playerId: string
  playerToken: string
  name: string
  emoji: string
}
