import { TableContext } from '../types/tableContext'

// "Funguje bez wifi" (Etapa 5): jakmile appka jednou úspěšně načte kontext
// stolu (hospoda + menu), uložíme ho do localStorage. Při dalším načtení
// stránky bez připojení (host obnoví stránku, nebo appka naběhne ze
// service workeru po výpadku) appka zobrazí poslední známý stav místo
// "Stůl nenalezen" / nekonečného loadingu – host tak pořád vidí menu a
// může objednávat (objednávka se zafrontuje, viz offlineOrderQueue).

const PREFIX = 'stulhraje_table_context_v1:'

export function cacheTableContext(tableToken: string, context: TableContext) {
  try {
    localStorage.setItem(PREFIX + tableToken, JSON.stringify({ context, cachedAt: Date.now() }))
  } catch {
    // localStorage nedostupný – appka funguje dál, jen bez offline cache.
  }
}

export function readCachedTableContext(tableToken: string): TableContext | null {
  try {
    const raw = localStorage.getItem(PREFIX + tableToken)
    if (!raw) return null
    const parsed = JSON.parse(raw) as { context: TableContext; cachedAt: number }
    return parsed.context ?? null
  } catch {
    return null
  }
}
