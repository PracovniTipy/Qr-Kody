export interface RatingSummary {
  avg_stars: number
  count: number
}

export interface SubmitRatingResult {
  ok: boolean
  reason?: string
}

export interface AdminRatingRow {
  id: string
  stars: number
  comment: string | null
  created_at: string
}
