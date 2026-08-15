import { OrderStatus, OrderSummary } from '../types/order'

const STATUS_LABELS: Record<OrderStatus, string> = {
  nova: 'Přijato',
  pripravuje_se: 'Připravuje se',
  hotovo: 'Hotovo',
  zrusena: 'Zrušeno',
}

/**
 * Etapa 2 (část): host po odeslání objednávky (i po refreshi stránky) vidí
 * poslední objednávky svého stolu – data přes bezpečnou funkci get_table_orders,
 * stejný vzor jako get_table_context (viz supabase/migrations/0005_orders.sql).
 */
export function OrdersList({ orders }: { orders: OrderSummary[] }) {
  if (orders.length === 0) return null

  return (
    <section className="orders-list">
      <h2>Moje objednávky</h2>
      <ul className="entity-list">
        {orders.map((order) => (
          <li key={order.id}>
            <div className="entity-main">
              <span className={`order-status order-status-${order.status}`}>
                {STATUS_LABELS[order.status]}
              </span>
              <ul className="order-items">
                {order.items.map((it, idx) => (
                  <li key={idx}>
                    {it.quantity}× {it.name}
                  </li>
                ))}
              </ul>
            </div>
          </li>
        ))}
      </ul>
    </section>
  )
}
