import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import * as QRCode from 'qrcode'
import { LanguageSwitcher } from '../../components/LanguageSwitcher'
import { useLanguage } from '../../lib/language'

/**
 * Aplikace pro Android (Trusted Web Activity, balíček cz.stulhraje.app).
 * null = APK ještě není vydané, stránka pak nabídne jen instalaci z prohlížeče.
 */
const ANDROID_APK: { url: string; version: string; sizeMb: string } | null = null

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

function detectPlatform(): 'android' | 'ios' | 'desktop' {
  const ua = navigator.userAgent || ''
  if (/android/i.test(ua)) return 'android'
  if (/iphone|ipad|ipod/i.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)) return 'ios'
  return 'desktop'
}

/**
 * Stránka "Stáhnout aplikaci": Android APK ke stažení, návod pro iPhone
 * (Přidat na plochu) a pro počítač (instalace z Chrome/Edge). Na počítači
 * ukáže QR kód, ať si host stránku otevře rovnou v telefonu.
 */
export function AppDownloadPage() {
  const { lang } = useLanguage()
  const t = (cs: string, en: string) => (lang === 'en' ? en : cs)
  const [platform] = useState(detectPlatform)
  const [installEvent, setInstallEvent] = useState<BeforeInstallPromptEvent | null>(null)
  const [installed, setInstalled] = useState(false)
  const [pageQr, setPageQr] = useState<string | null>(null)

  useEffect(() => {
    function onBeforeInstall(e: Event) {
      e.preventDefault()
      setInstallEvent(e as BeforeInstallPromptEvent)
    }
    function onInstalled() {
      setInstalled(true)
      setInstallEvent(null)
    }
    window.addEventListener('beforeinstallprompt', onBeforeInstall)
    window.addEventListener('appinstalled', onInstalled)
    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstall)
      window.removeEventListener('appinstalled', onInstalled)
    }
  }, [])

  useEffect(() => {
    if (platform !== 'desktop') return
    let active = true
    QRCode.toDataURL(`${window.location.origin}/aplikace`, { width: 200, margin: 1 }).then((url) => {
      if (active) setPageQr(url)
    })
    return () => {
      active = false
    }
  }, [platform])

  async function installPwa() {
    if (!installEvent) return
    await installEvent.prompt()
    const choice = await installEvent.userChoice
    if (choice.outcome === 'accepted') setInstalled(true)
    setInstallEvent(null)
  }

  const androidSection = (
    <section className="app-dl-card" key="android">
      <h2>🤖 Android</h2>
      {ANDROID_APK ? (
        <>
          <a className="home-btn home-btn-primary" href={ANDROID_APK.url} download>
            {t('Stáhnout aplikaci pro Android', 'Download the Android app')}
            <span className="home-btn-sub">
              APK · {t('verze', 'version')} {ANDROID_APK.version} · {ANDROID_APK.sizeMb} MB
            </span>
          </a>
          <ol className="app-dl-steps">
            <li>{t('Ťukni na tlačítko výše a stáhni soubor.', 'Tap the button above to download the file.')}</li>
            <li>
              {t(
                'Otevři stažený soubor. Pokud se telefon zeptá, povol instalaci z tohoto zdroje (prohlížeče).',
                'Open the downloaded file. If your phone asks, allow installing from this source (your browser).'
              )}
            </li>
            <li>{t('Ťukni na Instalovat – hotovo, appka je na ploše.', 'Tap Install – done, the app is on your home screen.')}</li>
          </ol>
        </>
      ) : (
        <p>
          {t(
            'Otevři tuhle stránku v Chrome a v menu ⋮ zvol „Přidat na plochu“ / „Nainstalovat aplikaci“.',
            'Open this page in Chrome and choose "Add to Home screen" / "Install app" in the ⋮ menu.'
          )}
        </p>
      )}
    </section>
  )

  const iosSection = (
    <section className="app-dl-card" key="ios">
      <h2>🍎 iPhone / iPad</h2>
      <ol className="app-dl-steps">
        <li>{t('Otevři tuhle stránku v Safari.', 'Open this page in Safari.')}</li>
        <li>{t('Ťukni na ikonu Sdílet (čtvereček se šipkou).', 'Tap the Share icon (square with an arrow).')}</li>
        <li>{t('Zvol „Přidat na plochu“ a potvrď.', 'Choose "Add to Home Screen" and confirm.')}</li>
      </ol>
    </section>
  )

  const desktopSection = (
    <section className="app-dl-card" key="desktop">
      <h2>💻 {t('Počítač', 'Desktop')}</h2>
      <p>
        {t(
          'V Chrome nebo Edge klikni na ikonu instalace v adresním řádku (monitor se šipkou), nebo použij tlačítko níže.',
          'In Chrome or Edge, click the install icon in the address bar (monitor with an arrow), or use the button below.'
        )}
      </p>
      {pageQr && (
        <div className="app-dl-qr">
          <img src={pageQr} alt={t('QR kód této stránky', 'QR code of this page')} width={200} height={200} />
          <p>{t('Naskenuj telefonem a nainstaluj appku do mobilu.', 'Scan with your phone to install the app on mobile.')}</p>
        </div>
      )}
    </section>
  )

  const ordered =
    platform === 'android'
      ? [androidSection, iosSection, desktopSection]
      : platform === 'ios'
        ? [iosSection, androidSection, desktopSection]
        : [desktopSection, androidSection, iosSection]

  return (
    <div className="home-page app-dl-page">
      <LanguageSwitcher />
      <header>
        <Link to="/" className="back-link">
          {t('← Zpět', '← Back')}
        </Link>
        <h1>{t('📲 Aplikace StůlHraje', '📲 The StůlHraje app')}</h1>
        <p className="home-tagline">
          {t(
            'Objednávky, platby a hry u stolu – rychleji, na celou obrazovku a s ikonou na ploše.',
            'Orders, payments and games at your table – faster, full screen and right on your home screen.'
          )}
        </p>
      </header>

      {installed && <p className="success">{t('Aplikace je nainstalovaná. 🎉', 'The app is installed. 🎉')}</p>}

      {installEvent && !installed && (
        <button type="button" className="home-btn home-btn-primary app-dl-install" onClick={installPwa}>
          {t('Nainstalovat do tohoto zařízení', 'Install on this device')}
        </button>
      )}

      {ordered}
    </div>
  )
}
