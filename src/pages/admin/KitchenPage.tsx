import { useCallback, useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { supabase } from '../../lib/supabaseClient'
import { OrderStatus } from '../../types/order'

interface KitchenOrderItem {
  id: string
  name_snapshot: string
  price_czk_snapshot: number
  quantity: number
  note: string | null
}

interface KitchenOrder {
  id: string
  status: OrderStatus
  note: string | null
  created_at: string
  table: { label: string } | null
  items: KitchenOrderItem[]
}

const STATUS_LABELS: Record<OrderStatus, string> = {
  nova: 'Přijato',
  pripravuje_se: 'Připravuje se',
  hotovo: 'Hotovo',
  zrusena: 'Zrušena',
}

const NEXT_STATUS: Partial<Record<OrderStatus, OrderStatus>> = {
  nova: 'pripravuje_se',
  pripravuje_se: 'hotovo',
}

const NEXT_LABEL: Partial<Record<OrderStatus, string>> = {
  nova: 'Začít připravovat',
  pripravuje_se: 'Hotovo',
}

/**
 * Etapa 2 (část): kuchyňská obrazovka pro personál. Čtení i změna stavu
 * objednávek jde přímo přes Supabase klienta – chrání to RLS pravidla
 * orders_select_staff / orders_update_staff z migrace 0005, žádná zvláštní
 * RPC funkce tu není potřeba (na rozdíl od hostovské strany, viz submit_order
 * / get_table_orders). Nové objednávky a změny stavu se promítnou hned přes
 * Supabase Realtime (migrace 0006) a pro jistotu i pravidelným obnovením.
 */
export function KitchenPage() {
  const { venueId } = useParams<{ venueId: string }>()

  const [orders, setOrders] = useState<KitchenOrder[]>([])
  const [status, setStatus] = useState<'loading' | 'ok' | 'error'>('loading')
  const [pendingId, setPendingId] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!venueId) return

    const { data, error } = await supabase
      .from('orders')
      .select(
        'id, status, note, created_at, table:tables(label), items:order_items(id, name_snapshot, price_czk_snapshot, quantity, note)'
      )
      .eq('venue_id', venueId)
      .order('created_at', { ascending: true })

    if (error) {
      setStatus('error')
      return
    }

    setOrders((data ?? []) as unknown as KitchenOrder[])
    setStatus('ok')
  }, [venueId])

  useEffect(() => {
    load()
  }, [load])

  useEffect(() => {
    if (!venueId) return

    const channel = supabase
      .channel(`kitchen-orders-${venueId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'orders', filter: `venue_id=eq.${venueId}` },
        () => load()
      )
      .subscribe()

    // Realtime je hlavní cesta, tohle je jen záložní obnovení pro případ výpadku spojení.
    const interval = setInterval(load, 20000)

    return () => {
      supabase.removeChannel(channel)
      clearInterval(interval)
    }
  }, [venueId, load])

  async function updateStatus(orderId: string, newStatus: OrderStatus) {
    setPendingId(orderId)
    const { error } = await supabase
      .from('orders')
      .update({ status: newStatus, updated_at: new Date().toISOString() })
      .eq('id', orderId)
    setPendingId(null)
    if (!error) load()
  }

  if (status === 'loading') return <p style={{ padding: 24 }}>Načítám…</p>

  if (status === 'error') {
    return (
      <div style={{ padding: 24 }}>
        <h1>Něco se pokazilo</h1>
        <p>Zkus stránku znovu načíst.</p>
        <Link to={`/admin/hospoda/${venueId ?? ''}`}>← Zpět na hospodu</Link>
      </div>
    )
  }

  const active = orders.filter((o) => o.status === 'nova' || o.status === 'pripravuje_se')
  const finished = orders.filter((o) => o.status === 'hotovo' || o.status === 'zrusena')

  return (
    <div className="kitchen-page">
      <header>
        <div>
          <Link to={`/admin/hospoda/${venueId ?? ''}`} className="back-link">
            ← Zpět na hospodu
          </Link>
          <h1>Kuchyň</h1>
        </div>
      </header>

      {active.length === 0 && <p>Žádné aktivní objednávky.</p>}

      <ul className="kitchen-orders">
        {active.map((order) => (
          <li key={order.id} className={`kitchen-order kitchen-order-${order.status}`}>
            <div className="kitchen-order-head">
              <span className="kitchen-order-table">Stůl {order.table?.label ?? '?'}</span>
              <span className={`order-status order-status-${order.status}`}>
                {STATUS_LABELS[order.status]}
              </span>
            </div>

            <ul className="order-items">
              {order.items.map((it) => (
                <li key={it.id}>
                  {it.quantity}× {it.name_snapshot}
                  {it.note && <span className="kitchen-item-note"> ({it.note})</span>}
                </li>
              ))}
            </ul>

            {order.note && <p className="kitchen-order-note">Poznámka: {order.note}</p>}

            <div className="kitchen-order-actions">
              {NEXT_STATUS[order.status] && (
                <button
                  type="button"
                  disabled={pendingId === order.id}
                  onClick={() => updateStatus(order.id, NEXT_STATUS[order.status] as OrderStatus)}
                >
                  {NEXT_LABEL[order.status]}
                </button>
              )}
              <button
                type="button"
                className="kitchen-cancel"
                disabled={pendingId === order.id}
                onClick={() => updateStatus(order.id, 'zrusena')}
              >
                Zrušit
              </button>
            </div>
          </li>
        ))}
      </ul>

      {finished.length > 0 && (
        <section className="kitchen-finished">
          <h2>Dokončené / zrušené</h2>
          <ul className="entity-list">
            {finished.map((order) => (
              <li key={order.id}>
                <div className="entity-main">
                  <strong>Stůl {order.table?.label ?? '?'}</strong>
                  <span
                    className={`order-status order-status-${order.status}`}
                    style={{ marginLeft: 8 }}
                  >
                    {STATUS_LABELS[order.status]}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}
