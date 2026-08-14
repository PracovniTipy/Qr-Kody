import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { supabase } from '../../lib/supabaseClient'
import { TableContext } from '../../types/tableContext'
import { MenuList } from '../../components/MenuList'

/**
 * Veřejná stránka stolu: app.cz/v/:venueSlug/t/:tableToken
 * Hospodu i stůl vždy potvrzuje server (DB funkce get_table_context), nikdy jen klient –
 * viz podmínka dokončení MVP "QR kód vždy otevře správnou hospodu a správný stůl".
 */
export function TablePage() {
  const { venueSlug, tableToken } = useParams<{ venueSlug: string; tableToken: string }>()
  const [context, setContext] = useState<TableContext | null>(null)
  const [status, setStatus] = useState<'loading' | 'ok' | 'not_found' | 'error'>('loading')

  useEffect(() => {
    if (!venueSlug || !tableToken) {
      setStatus('not_found')
      return
    }

    let active = true

    supabase
      .rpc('get_table_context', { p_venue_slug: venueSlug, p_table_token: tableToken })
      .then(({ data, error }) => {
        if (!active) return
        if (error || !data) {
          setStatus(error ? 'error' : 'not_found')
          return
        }
        setContext(data as TableContext)
        setStatus('ok')
      })

    return () => {
      active = false
    }
  }, [venueSlug, tableToken])

  if (status === 'loading') return <p style={{ padding: 24 }}>Načítám…</p>

  if (status === 'not_found') {
    return (
      <div style={{ padding: 24 }}>
        <h1>Stůl nenalezen</h1>
        <p>Tenhle QR kód neodpovídá žádné aktivní hospodě nebo stolu. Zkus obsluhu.</p>
      </div>
    )
  }

  if (status === 'error' || !context) {
    return (
      <div style={{ padding: 24 }}>
        <h1>Něco se pokazilo</h1>
        <p>Zkus stránku znovu načíst, případně přivolej obsluhu.</p>
      </div>
    )
  }

  return (
    <div className="table-page">
      <header className="table-header">
        <h1>{context.venue.name}</h1>
        <p>Stůl {context.table.label}</p>
      </header>

      {/* Testovací menu pro Etapu 0 – košík, objednávka a platba přijdou v dalších etapách. */}
      <MenuList categories={context.menu} />
    </div>
  )
}
