import { Lang } from './language'

// Sdílené dvojjazyčné názvy arkádových her se skóre (jediné hry, které
// podporují turnaje - žebříček je výřez game_scores podle času, viz migrace
// 0025).
export const SCORE_GAME_LABELS: Record<string, { cs: string; en: string }> = {
  kosik: { cs: 'Chytání surovin', en: 'Catch the ingredients' },
  flappy: { cs: 'Let mezi sudy', en: 'Flight between barrels' },
  runner: { cs: 'Hospodský běh', en: 'Pub run' },
  climb: { cs: 'Skákání nahoru', en: 'Jump up' },
  breakout: { cs: 'Rozbíjení lahví', en: 'Bottle smash' },
}

export function gameLabel(gameId: string, lang: Lang = 'cs'): string {
  const entry = SCORE_GAME_LABELS[gameId]
  if (!entry) return gameId
  return lang === 'en' ? entry.en : entry.cs
}
