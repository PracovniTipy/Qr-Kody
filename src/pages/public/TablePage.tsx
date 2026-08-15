import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { supabase } from '../../lib/supabaseClient'
import { TableContext } from '../../types/tableContext'
import { OrderSummary } from '../../types/order'
import { MenuList } from '../../components/MenuList'
import { OrdersList } from '../../components/OrdersList'
import { PaymentPanel } from '../../components/PaymentPanel'

/**
 * Veřejná stránka stolu: app.cz/v/:venueSlug/t/:tableToken
 * Hospodu i stůl vždy potvrzuje server (DB funkce get_table_context), nikdy jen klient –
 * viz podmínka dokončení MVP "QR kód vždy otevře správnou hospodu a správný stůl".
 *
 * Etapa 2: přidán košík a odeslání objednávky. Objednávka vzniká výhradně
 * přes bezpečnou RPC funkci submit_order, která si sama ověří platnost tokenu stolu
 * (stejný vzor jako get_table_context) – klient nikdy nezapisuje do orders/order_items
 * přímo. Kuchyňská obrazovka (KitchenPage) a QR platba (PaymentPanel) jsou taky
 * hotové, stejně jako přehled tržeb. Přidána i první arkádová hra (Etapa 4) –
 * odkaz "Hrát" vede na GamePage. Zbytek her a další kapitoly viz masterplán.
 */
export function TablePage() {
  const { venueSlug, tableToken } = useParams<{ venueSlug: string; tableToken: string }>()
  const [context, setContext] = useState<TableContext | null>(null)
  const [status, setStatus] = useState<'loading' | 'ok' | 'not_found' | 'error'>('loading')
  const [quantities, setQuantities] = useState<Record<string, number>>({})
  const [orders, setOrders] = useState<OrderSummary[]>([])
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)

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

  useEffect(() => {
    if (!tableToken || status !== 'ok') return

    let active = true

    supabase
      .rpc('get_table_orders', { p_qr_token: tableToken })
      .then(({ data }) => {
        if (!active) return
        if (Array.isArray(data)) setOrders(data as OrderSummary[])
      })

    return () => {
      active = false
    }
  }, [tableToken, status])

  function setQuantity(itemId: string, quantity: number) {
    setQuantities((prev) => {
      const next = { ...prev }
      if (quantity <= 0) {
        delete next[itemId]
      } else {
        next[itemId] = quantity
      }
      return next
    })
  }

  const allItems = (context?.menu ?? []).flatMap((category) => category.items)
  const cartLines = Object.entries(quantities)
    .map(([itemId, quantity]) => {
      const item = allItems.find((i) => i.id === itemId)
      return item ? { item, quantity } : null
    })
    .filter((line): line is { item: (typeof allItems)[number]; quantity: number } => line !== null)
  const cartTotal = cartLines.reduce((sum, line) => sum + line.item.price_czk * line.quantity, 0)
  const cartCount = cartLines.reduce((sum, line) => sum + line.quantity, 0)

  const unpaidTotal = orders
    .filter((o) => o.status !== 'zrusena' && !o.paid)
    .reduce((sum, o) => sum + o.items.reduce((s, it) => s + it.price_czk * it.quantity, 0), 0)

  async function handleSubmitOrder() {
    if (!tableToken || cartLines.length === 0) return

    setSubmitting(true)
    setSubmitError(null)

    try {
      const items = cartLines.map((line) => ({ menu_item_id: line.item.id, quantity: line.quantity }))
      const { error } = await supabase.rpc('submit_order', {
        p_qr_token: tableToken,
        p_items: items,
        p_note: null,
      })
      if (error) throw new Error(error.message)

      setQuantities({})

      const { data: refreshed } = await supabase.rpc('get_table_orders', { p_qr_token: tableToken })
      if (Array.isArray(refreshed)) setOrders(refreshed as OrderSummary[])
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Objednávku se nepodařilo odeslat.')
    } finally {
      setSubmitting(false)
    }
  }

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

      <Link to={`/v/${venueSlug}/t/${tableToken}/hra`} className="games-link">
        🎮 Hrát
      </Link>

      <OrdersList orders={orders} />

      <PaymentPanel
        amount={unpaidTotal}
        bankAccount={context.venue.bank_account}
        venueName={context.venue.name}
        tableLabel={context.table.label}
      />

      <MenuList categories={context.menu} quantities={quantities} onQuantityChange={setQuantity} />

      {submitError && <p className="error cart-error">{submitError}</p>}

      {cartCount > 0 && (
        <div className="cart-bar">
          <div>
            <strong>{cartCount}×</strong> v košíku · {cartTotal} Kč
          </div>
          <button type="button" onClick={handleSubmitOrder} disabled={submitting}>
            {submitting ? 'Odesílám…' : 'Odeslat objednávku'}
          </button>
        </div>
      )}
    </div>
  )
}
