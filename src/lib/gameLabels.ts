// Sdílené české názvy arkádových her se skóre (jediné hry, které podporují
// turnaje - žebříček je výřez game_scores podle času, viz migrace 0025).
export const SCORE_GAME_LABELS: Record<string, string> = {
  kosik: 'Chytání surovin',
  flappy: 'Let mezi sudy',
  runner: 'Hospodský běh',
  climb: 'Skákání nahoru',
  breakout: 'Rozbíjení lahví',
}

export function gameLabel(gameId: string): string {
  return SCORE_GAME_LABELS[gameId] ?? gameId
}
