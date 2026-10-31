import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { supabase } from '../../lib/supabaseClient'
import { VenuePreview } from '../../types/venueDirectory'
import { MenuList } from '../../components/MenuList'
import { LanguageSwitcher } from '../../components/LanguageSwitcher'
import { useLanguage } from '../../lib/language'

/**
 * Mapa podniků (masterplán, "co zbývá"): neveřejný náhled menu hospody bez
 * konkrétního stolu (get_venue_preview, migrace 0026) - dostupný jen pro
 * hospody přihlášené do adresáře. Jen orientační, žádné objednávání ani
 * hry - na to slouží QR kód na skutečném stole.
 */
export function VenuePreviewPage() {
  const { venueSlug } = useParams<{ venueSlug: string }>()
  const { lang } = useLanguage()
  const [preview, setPreview] = useState<VenuePreview | null>(null)
  const [status, setStatus] = useState<'loading' | 'ok' | 'not_found' | 'error'>('loading')

  useEffect(() => {
    if (!venueSlug) {
      setStatus('not_found')
      return
    }

    let active = true

    supabase
      .rpc('get_venue_preview', { p_venue_slug: venueSlug })
      .then(({ data, error }) => {
        if (!active) return
        if (error || !data) {
          setStatus(error ? 'error' : 'not_found')
          return
        }
        setPreview(data as VenuePreview)
        setStatus('ok')
      })

    return () => {
      active = false
    }
  }, [venueSlug])

  if (status === 'loading') {
    return (
      <div style={{ padding: 24 }}>
        <LanguageSwitcher />
        <p>{lang === 'en' ? 'Loading…' : 'Načítám…'}</p>
      </div>
    )
  }

  if (status === 'not_found') {
    return (
      <div style={{ padding: 24 }}>
        <LanguageSwitcher />
        <h1>{lang === 'en' ? 'Pub not found' : 'Hospoda nenalezena'}</h1>
        <p>
          {lang === 'en'
            ? "Either it doesn't exist, or it's not listed in the directory."
            : 'Buď neexistuje, nebo není v adresáři zveřejněná.'}
        </p>
        <Link to="/podniky">{lang === 'en' ? '← Back to venue map' : '← Zpět na mapu podniků'}</Link>
      </div>
    )
  }

  if (status === 'error' || !preview) {
    return (
      <div style={{ padding: 24 }}>
        <LanguageSwitcher />
        <h1>{lang === 'en' ? 'Something went wrong' : 'Něco se pokazilo'}</h1>
        <p>{lang === 'en' ? 'Please try reloading the page.' : 'Zkus stránku znovu načíst.'}</p>
      </div>
    )
  }

  return (
    <div className="table-page venue-preview-page">
      <LanguageSwitcher />
      <header className="table-header">
        <Link to="/podniky" className="back-link">
          {lang === 'en' ? '← Back to venue map' : '← Zpět na mapu podniků'}
        </Link>
        <h1>{preview.venue.name}</h1>
        {(preview.venue.address || preview.venue.city) && (
          <p className="venue-directory-address">
            {[preview.venue.address, preview.venue.city].filter(Boolean).join(', ')}
          </p>
        )}
        {preview.venue.opening_hours && (
          <p className="venue-directory-hours">{preview.venue.opening_hours}</p>
        )}
        <p className="venue-preview-hint">
          {lang === 'en'
            ? 'Menu preview. Ordering and games are only available by scanning the QR code on a table in the venue.'
            : 'Náhled menu. Objednávat a hrát jde jen naskenováním QR kódu na stole v podniku.'}
        </p>
      </header>

      <MenuList categories={preview.menu} />
    </div>
  )
}
