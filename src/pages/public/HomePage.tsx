import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { LanguageSwitcher } from '../../components/LanguageSwitcher'
import { useLanguage } from '../../lib/language'
import { LastTable, forgetLastTable, readLastTable } from '../../lib/lastTable'

function isInstalledApp(): boolean {
  try {
    return (
      window.matchMedia('(display-mode: standalone)').matches ||
      // Trusted Web Activity (aplikace pro Android) se hlásí přes referrer
      document.referrer.startsWith('android-app://')
    )
  } catch {
    return false
  }
}

/**
 * Domovská obrazovka aplikace (start_url instalované PWA i aplikace pro
 * Android). Dřív "/" přesměrovávalo rovnou do administrace, což po spuštění
 * appky z plochy dávalo hostovi přihlašovací formulář – teď dostane rozcestník:
 * naskenovat QR kód stolu, pokračovat u posledního stolu, mapa podniků, a
 * nenápadně dole vstup pro provozovatele.
 */
export function HomePage() {
  const { lang } = useLanguage()
  const [lastTable, setLastTable] = useState<LastTable | null>(null)
  const [installed, setInstalled] = useState(false)

  useEffect(() => {
    setLastTable(readLastTable())
    setInstalled(isInstalledApp())
  }, [])

  const t = (cs: string, en: string) => (lang === 'en' ? en : cs)

  return (
    <div className="home-page">
      <LanguageSwitcher />

      <header className="home-hero">
        <img src="/favicon.svg" alt="" className="home-logo" width={72} height={72} />
        <h1>StůlHraje</h1>
        <p className="home-tagline">
          {t('Objednávej, plať a hraj přímo od stolu.', 'Order, pay and play right from your table.')}
        </p>
      </header>

      <main className="home-actions">
        {lastTable && (
          <div className="home-continue">
            <Link to={lastTable.path} className="home-btn home-btn-primary">
              {t('🍺 Pokračovat u stolu', '🍺 Back to your table')}
              <span className="home-btn-sub">
                {lastTable.venueName} · {t('stůl', 'table')} {lastTable.tableLabel}
              </span>
            </Link>
            <button
              type="button"
              className="home-forget"
              onClick={() => {
                forgetLastTable()
                setLastTable(null)
              }}
            >
              {t('Už nejsem u tohoto stolu', "I'm not at this table anymore")}
            </button>
          </div>
        )}

        <Link to="/skenovat" className={`home-btn ${lastTable ? 'home-btn-secondary' : 'home-btn-primary'}`}>
          {t('📷 Naskenovat QR kód stolu', '📷 Scan table QR code')}
          <span className="home-btn-sub">
            {t('Kód najdeš na stojánku na stole.', "You'll find it on the stand on your table.")}
          </span>
        </Link>

        <Link to="/podniky" className="home-btn home-btn-secondary">
          {t('🗺️ Mapa podniků', '🗺️ Venue map')}
          <span className="home-btn-sub">
            {t('Hospody, kde StůlHraje funguje.', 'Pubs where StůlHraje works.')}
          </span>
        </Link>

        {!installed && (
          <Link to="/aplikace" className="home-btn home-btn-secondary">
            {t('📲 Stáhnout aplikaci', '📲 Get the app')}
            <span className="home-btn-sub">
              {t('Android, iPhone i počítač.', 'Android, iPhone and desktop.')}
            </span>
          </Link>
        )}
      </main>

      <footer className="home-footer">
        <Link to="/admin/login">{t('Pro provozovatele podniků →', 'For venue owners →')}</Link>
      </footer>
    </div>
  )
}
