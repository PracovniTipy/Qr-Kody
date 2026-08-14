import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import * as QRCode from 'qrcode'
import { supabase } from '../../lib/supabaseClient'
import { TableRow, VenueRow } from '../../types/adminVenue'

interface StandTable extends TableRow {
  qrDataUrl: string
}

/**
 * Etapa 1.1: generátor tiskových QR stojánků. Pro každý aktivní stůl
 * vygeneruje QR obrázek (knihovna qrcode, čistě na klientovi) a připraví
 * stránku pro tisk přes window.print() – viz @media print v index.css.
 */
export function QrStandPage() {
  const { venueId } = useParams<{ venueId: string }>()

  const [venue, setVenue] = useState<VenueRow | null>(null)
  const [items, setItems] = useState<StandTable[]>([])
  const [status, setStatus] = useState<'loading' | 'ok' | 'error'>('loading')

  useEffect(() => {
    if (!venueId) {
      setStatus('error')
      return
    }

    let active = true

    async function load() {
      const [venueRes, tablesRes] = await Promise.all([
        supabase.from('venues').select('*').eq('id', venueId).single(),
        supabase
          .from('tables')
          .select('*')
          .eq('venue_id', venueId)
          .eq('is_active', true)
          .order('label'),
      ])

      if (!active) return

      if (venueRes.error || !venueRes.data) {
        setStatus('error')
        return
      }

      const venueData = venueRes.data as VenueRow
      const tableRows = (tablesRes.data ?? []) as TableRow[]

      const withCodes = await Promise.all(
        tableRows.map(async (t) => {
          const url = `${window.location.origin}/v/${venueData.slug}/t/${t.qr_token}`
          const qrDataUrl = await QRCode.toDataURL(url, { width: 320, margin: 1 })
          return { ...t, qrDataUrl }
        })
      )

      if (!active) return

      setVenue(venueData)
      setItems(withCodes)
      setStatus('ok')
    }

    load()

    return () => {
      active = false
    }
  }, [venueId])

  if (status === 'loading') return <p style={{ padding: 24 }}>Načítám…</p>

  if (status === 'error' || !venue) {
    return (
      <div style={{ padding: 24 }}>
        <h1>Nepodařilo se načíst stoly</h1>
        <Link to={`/admin/hospoda/${venueId ?? ''}`}>Zpět na hospodu</Link>
      </div>
    )
  }

  return (
    <div className="qr-stand-page">
      <div className="qr-stand-toolbar">
        <Link to={`/admin/hospoda/${venue.id}`} className="back-link">
          ← Zpět na hospodu
        </Link>
        <button type="button" onClick={() => window.print()}>
          Vytisknout
        </button>
      </div>

      {items.length === 0 && <p>Žádné aktivní stoly k vytisknutí.</p>}

      <div className="qr-stand-grid">
        {items.map((t) => (
          <div className="qr-stand-card" key={t.id}>
            <p className="qr-stand-venue">{venue.name}</p>
            <img src={t.qrDataUrl} alt={`QR kód pro stůl ${t.label}`} />
            <p className="qr-stand-table">Stůl {t.label}</p>
            <p className="qr-stand-hint">Naskenuj a objednávej</p>
          </div>
        ))}
      </div>
    </div>
  )
}
