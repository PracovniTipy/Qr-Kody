/**
 * Poslední navštívený stůl (aplikace pro Android / instalovaná PWA): po
 * znovuotevření appky z plochy nabídne domovská stránka "Pokračovat u stolu",
 * aby host nemusel znovu skenovat QR kód. Platnost je omezená – druhý den už
 * je host nejspíš v jiné hospodě.
 */

const STORAGE_KEY = 'stulhraje_last_table_v1'
const MAX_AGE_MS = 12 * 60 * 60 * 1000

export interface LastTable {
  path: string
  venueName: string
  tableLabel: string
  savedAt: number
}

export function rememberLastTable(entry: Omit<LastTable, 'savedAt'>) {
  try {
    const value: LastTable = { ...entry, savedAt: Date.now() }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(value))
  } catch {
    // localStorage nedostupné (soukromý režim) – funkce je jen pohodlí navíc
  }
}

export function readLastTable(): LastTable | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<LastTable>
    if (
      typeof parsed.path !== 'string' ||
      !parsed.path.startsWith('/v/') ||
      typeof parsed.venueName !== 'string' ||
      typeof parsed.tableLabel !== 'string' ||
      typeof parsed.savedAt !== 'number'
    ) {
      return null
    }
    if (Date.now() - parsed.savedAt > MAX_AGE_MS) return null
    return parsed as LastTable
  } catch {
    return null
  }
}

export function forgetLastTable() {
  try {
    localStorage.removeItem(STORAGE_KEY)
  } catch {
    // ignore
  }
}

/**
 * Z naskenovaného textu QR kódu vytáhne cestu ke stolu (/v/:slug/t/:token).
 * Přijímá jen odkazy na tuhle aplikaci (stejný host, nebo produkční doména),
 * cizí QR kódy (reklamy, Wi-Fi apod.) odmítne.
 */
const KNOWN_HOSTS = ['stulhraje-web-production.up.railway.app']

export function tablePathFromQr(text: string): string | null {
  let url: URL
  try {
    url = new URL(text.trim())
  } catch {
    return null
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
  const hostOk = url.host === window.location.host || KNOWN_HOSTS.includes(url.host)
  if (!hostOk) return null
  const match = url.pathname.match(/^\/v\/([A-Za-z0-9_-]+)\/t\/([A-Za-z0-9_-]+)\/?$/)
  if (!match) return null
  return `/v/${match[1]}/t/${match[2]}`
}
