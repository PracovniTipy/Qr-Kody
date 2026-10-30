import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { supabase } from '../../lib/supabaseClient'
import { TableContext } from '../../types/tableContext'
import { OrderSummary } from '../../types/order'
import { RatingSummary } from '../../types/rating'
import { ActiveTournament } from '../../types/tournament'
import { MenuList } from '../../components/MenuList'
import { OrdersList } from '../../components/OrdersList'
import { PaymentPanel } from '../../components/PaymentPanel'
import { OfflineBanner } from '../../components/OfflineBanner'
import { useOnlineStatus } from '../../hooks/useOnlineStatus'
import { cacheTableContext, readCachedTableContext } from '../../lib/offlineTableContext'
import { enqueueOrder, flushOrderQueue, getQueueForTable } from '../../lib/offlineOrderQueue'

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
 *
 * Etapa 5 (spolehlivost, "funguje bez wifi"): kontext stolu se při úspěšném
 * načtení uloží do localStorage (offlineTableContext) a při výpadku
 * připojení se použije místo chybové stránky – host dál vidí menu. Odeslání
 * objednávky bez připojení (nebo při síťové chybě) jde do lokální fronty
 * (offlineOrderQueue) a odešle se automaticky po návratu připojení.
 */
export function TablePage() {
  const { venueSlug, tableToken } = useParams<{ venueSlug: string; tableToken: string }>()
  const isOnline = useOnlineStatus()
  const [context, setContext] = useState<TableContext | null>(null)
  const [status, setStatus] = useState<'loading' | 'ok' | 'not_found' | 'error'>('loading')
  const [quantities, setQuantities] = useState<Record<string, number>>({})
  const [orders, setOrders] = useState<OrderSummary[]>([])
  const [ratingSummary, setRatingSummary] = useState<RatingSummary | null>(null)
  const [activeTournaments, setActiveTournaments] = useState<ActiveTournament[]>([])
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [pendingCount, setPendingCount] = useState(0)

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
          // Síťová chyba (appka je offline, nebo Supabase chvilkově neodpovídá)
          // – zkusíme poslední známý stav téhle stránky stolu z localStorage,
          // ať host dál vidí menu místo chybové hlášky.
          const cached = error ? readCachedTableContext(tableToken!) : null
          if (cached) {
            setContext(cached)
            setStatus('ok')
            return
          }
          setStatus(error ? 'error' : 'not_found')
          return
        }
        setContext(data as TableContext)
        cacheTableContext(tableToken!, data as TableContext)
        setStatus('ok')
      })
      .catch(() => {
        if (!active) return
        const cached = readCachedTableContext(tableToken!)
        if (cached) {
          setContext(cached)
          setStatus('ok')
        } else {
          setStatus('error')
        }
      })

    return () => {
      active = false
    }
  }, [venueSlug, tableToken])

  // Fronta čekajících objednávek pro tenhle stůl – pro zobrazení v banneru.
  useEffect(() => {
    if (!tableToken) return

    function refresh() {
      setPendingCount(getQueueForTable(tableToken!).length)
    }

    refresh()
    window.addEventListener('stulhraje:order-queue-changed', refresh)
    return () => window.removeEventListener('stulhraje:order-queue-changed', refresh)
  }, [tableToken])

  // Jakmile je appka online a ve frontě něco čeká, zkusí se to odeslat –
  // hned při návratu připojení a pak pravidelně (pro jistotu, kdyby
  // 'online' event nespolehlivě vystřelil, např. za firemním/hospodským wifi).
  useEffect(() => {
    if (!isOnline || !tableToken) return

    let cancelled = false

    async function tryFlush() {
      const { sent } = await flushOrderQueue()
      if (cancelled) return
      if (sent > 0) {
        const { data: refreshed } = await supabase.rpc('get_table_orders', { p_qr_token: tableToken! })
        if (!cancelled && Array.isArray(refreshed)) setOrders(refreshed as OrderSummary[])
      }
    }

    tryFlush()
    const interval = setInterval(tryFlush, 20000)
    return () => {
      cancelled = true
      clearInterval(interval)
    }
  }, [isOnline, tableToken])

  useEffect(() => {
    if (!tableToken || status !== 'ok' || !context?.venue.ordering_enabled) return

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
  }, [tableToken, status, context])

  useEffect(() => {
    if (!tableToken || status !== 'ok') return

    let active = true

    supabase
      .rpc('get_venue_rating_summary', { p_qr_token: tableToken })
      .then(({ data }) => {
        if (!active) return
        if (data) setRatingSummary(data as RatingSummary)
      })

    return () => {
      active = false
    }
  }, [tableToken, status])

  useEffect(() => {
    if (!tableToken || status !== 'ok') return

    let active = true

    supabase
      .rpc('get_active_tournaments', { p_qr_token: tableToken })
      .then(({ data }) => {
        if (!active) return
        if (Array.isArray(data)) setActiveTournaments(data as ActiveTournament[])
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

  function isNetworkErrorMessage(message: string) {
    const m = message.toLowerCase()
    return m.includes('failed to fetch') || m.includes('network') || m.includes('load failed')
  }

  async function handleSubmitOrder() {
    if (!tableToken || cartLines.length === 0) return

    const items = cartLines.map((line) => ({ menu_item_id: line.item.id, quantity: line.quantity }))

    // Offline rovnou do fronty, ani nezkoušíme síť – ušetří to hostovi
    // čekání na timeout a objednávka se stejně odešle, jen později.
    if (!navigator.onLine) {
      enqueueOrder(tableToken, items, null)
      setQuantities({})
      setSubmitError(null)
      return
    }

    setSubmitting(true)
    setSubmitError(null)

    try {
      const { error } = await supabase.rpc('submit_order', {
        p_qr_token: tableToken,
        p_items: items,
        p_note: null,
      })
      if (error) {
        if (isNetworkErrorMessage(error.message)) {
          enqueueOrder(tableToken, items, null)
          setQuantities({})
          return
        }
        throw new Error(error.message)
      }

      setQuantities({})

      const { data: refreshed } = await supabase.rpc('get_table_orders', { p_qr_token: tableToken })
      if (Array.isArray(refreshed)) setOrders(refreshed as OrderSummary[])
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Objednávku se nepodařilo odeslat.'
      if (isNetworkErrorMessage(message)) {
        enqueueOrder(tableToken, items, null)
        setQuantities({})
        return
      }
      setSubmitError(message)
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
      <OfflineBanner isOnline={isOnline} pendingCount={pendingCount} />
      <header className="table-header">
        <h1>{context.venue.name}</h1>
        <p>Stůl {context.table.label}</p>
        {ratingSummary && ratingSummary.count > 0 && (
          <p className="table-rating-summary">
            ★ {ratingSummary.avg_stars.toFixed(1)} ({ratingSummary.count} hodnocení)
          </p>
        )}
      </header>

      <Link to={`/v/${venueSlug}/t/${tableToken}/hodnoceni`} className="rate-venue-link">
        ⭐ Ohodnotit podnik
      </Link>

      {context.venue.games_enabled && activeTournaments.length > 0 && (
        <Link to={`/v/${venueSlug}/t/${tableToken}/turnaje`} className="rate-venue-link tournaments-link">
          🏆 Turnaje ({activeTournaments.length})
        </Link>
      )}

      {context.venue.games_enabled && (
        <div className="games-links">
          <Link to={`/v/${venueSlug}/t/${tableToken}/hra`} className="games-link">
            🥕 Chytání surovin
          </Link>
          <Link to={`/v/${venueSlug}/t/${tableToken}/hra-let`} className="games-link">
            🍺 Let mezi sudy
          </Link>
          <Link to={`/v/${venueSlug}/t/${tableToken}/hra-beh`} className="games-link">
            🏃 Hospodský běh
          </Link>
          <Link to={`/v/${venueSlug}/t/${tableToken}/hra-skok`} className="games-link">
            🕺 Skákání nahoru
          </Link>
          <Link to={`/v/${venueSlug}/t/${tableToken}/hra-lahve`} className="games-link">
            🍾 Rozbíjení lahví
          </Link>
          <Link to={`/v/${venueSlug}/t/${tableToken}/hra-prsi`} className="games-link">
            🃏 Prší
          </Link>
          <Link to={`/v/${venueSlug}/t/${tableToken}/hra-poker`} className="games-link">
            ♠️ Poker
          </Link>
          <Link to={`/v/${venueSlug}/t/${tableToken}/hra-dama`} className="games-link">
            ⚫ Dáma
          </Link>
          <Link to={`/v/${venueSlug}/t/${tableToken}/hra-sachy`} className="games-link">
            ♞ Šachy
          </Link>
          <Link to={`/v/${venueSlug}/t/${tableToken}/hra-flaska`} className="games-link">
            🍾 Flaška
          </Link>
        </div>
      )}

      {context.venue.ordering_enabled && (
        <>
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
                {submitting ? 'Odesílám…' : isOnline ? 'Odeslat objednávku' : 'Odeslat (offline – doručí se později)'}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  )
}
