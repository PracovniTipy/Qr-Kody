// Turnaje (masterplán, "co zbývá": turnaje) - viz supabase/migrations/0025_tournaments.sql

export interface TournamentRow {
  id: string
  venue_id: string
  game_id: string
  name: string
  starts_at: string
  ends_at: string | null
  created_at: string
}

export interface ActiveTournament {
  id: string
  game_id: string
  name: string
  starts_at: string
  ends_at: string | null
}

export interface TournamentScoreEntry {
  nickname: string
  score: number
  created_at: string
}

export interface TournamentLeaderboardResult {
  tournament: {
    id: string
    game_id: string
    name: string
    starts_at: string
    ends_at: string | null
    is_active: boolean
  }
  scores: TournamentScoreEntry[]
}
