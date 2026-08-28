import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { supabase } from '../../lib/supabaseClient'

interface RevenueOrder {
  created_at: string
  order_items: { price_czk_snapshot: number; quantity: number }[]
}

interface DayRevenue {
  date: string
  label: string
  total: number
  count: number
}

const DAYS_BACK = 30

function csvEscape(value: string): string {
  if (/[";\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`
  }
  return value
}

function buildRevenueCsv(days: DayRevenue[]): string {
  const header = ['Den', 'Datum', 'Tržby (Kč)', 'Objednávky']
  const rows = days.map((d) => [d.label, d.date, String(d.total), String(d.count)])
  const totalAll = days.reduce((sum, d) => sum + d.total, 0)
  const countAll = days.reduce((sum, d) => sum + d.count, 0)
  const lines = [header, ...rows, ['Celkem', '', String(totalAll), String(countAll)]]
  return lines.map((line) => line.map(csvEscape).join(';')).join('\r\n')
}

function downloadCsv(days: DayRevenue[]) {
  const csv = '﻿' + buildRevenueCsv(days)
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const todayKey = new Date().toLocaleDateString('sv-SE')
  const a = document.createElement('a')
  a.href = url
  a.download = `trzby-${todayKey}.csv`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

/**
 * Etapa 2 (část): přehled tržeb pro personál/majitele. Počítá se ze
 * zaplacených objednávek (orders.paid = true, viz PaymentPanel a migrace
 * 0007) za posledních 30 dní. Čtení jde přímo přes Supabase klienta – chrání
 * to stejné RLS pravidlo orders_select_staff jako kuchyňská obrazovka
 * (migrace 0005), žádná nová RPC funkce ani migrace tu není potřeba.
 */
export function RevenuePage() {
  const { venueId } = useParams<{ venueId: string }>()
  const [days, setDays] = useState<DayRevenue[]>([])
  const [status, setStatus] = useState<'loading' | 'ok' | 'error'>('loading')

  useEffect(() => {
    if (!venueId) return
    let active = true

    async function load() {
      const since = new Date()
      since.setDate(since.getDate() - DAYS_BACK)

      const { data, error } = await supabase
        .from('orders')
        .select('created_at, order_items(price_czk_snapshot, quantity)')
        .eq('venue_id', venueId)
        .eq('paid', true)
        .gte('created_at', since.toISOString())

      if (!active) return
      if (error) {
        setStatus('error')
        return
      }

      const byDate = new Map<string, { total: number; count: number }>()
      for (const order of (data ?? []) as RevenueOrder[]) {
        const key = new Date(order.created_at).toLocaleDateString('sv-SE')
        const orderTotal = order.order_items.reduce(
          (sum, it) => sum + it.price_czk_snapshot * it.quantity,
          0
        )
        const prev = byDate.get(key) ?? { total: 0, count: 0 }
        byDate.set(key, { total: prev.total + orderTotal, count: prev.count + 1 })
      }

      const rows: DayRevenue[] = [...byDate.entries()]
        .sort((a, b) => (a[0] < b[0] ? 1 : -1))
        .map(([date, v]) => ({
          date,
          label: new Date(date).toLocaleDateString('cs-CZ', {
            weekday: 'short',
            day: 'numeric',
            month: 'numeric',
          }),
          total: v.total,
          count: v.count,
        }))

      setDays(rows)
      setStatus('ok')
    }

    load()
    return () => {
      active = false
    }
  }, [venueId])

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

  const todayKey = new Date().toLocaleDateString('sv-SE')
  const today = days.find((d) => d.date === todayKey)
  const totalAll = days.reduce((sum, d) => sum + d.total, 0)
  const countAll = days.reduce((sum, d) => sum + d.count, 0)

  return (
    <div className="revenue-page">
      <header>
        <div>
          <Link to={`/admin/hospoda/${venueId ?? ''}`} className="back-link">
            ← Zpět na hospodu
          </Link>
          <h1>Tržby</h1>
        </div>
        {days.length > 0 && (
          <button type="button" className="revenue-export-btn" onClick={() => downloadCsv(days)}>
            Stáhnout CSV
          </button>
        )}
      </header>

      <div className="revenue-summary">
        <div className="revenue-card">
          <span className="revenue-card-label">Dnes</span>
          <strong className="revenue-card-value">{today?.total ?? 0} Kč</strong>
          <span className="revenue-card-hint">{today?.count ?? 0} objednávek</span>
        </div>
        <div className="revenue-card">
          <span className="revenue-card-label">Posledních {DAYS_BACK} dní</span>
          <strong className="revenue-card-value">{totalAll} Kč</strong>
          <span className="revenue-card-hint">{countAll} objednávek</span>
        </div>
      </div>

      {days.length === 0 ? (
        <p>Zatím žádné zaplacené objednávky.</p>
      ) : (
        <table className="revenue-table">
          <thead>
            <tr>
              <th>Den</th>
              <th>Tržby</th>
              <th>Objednávky</th>
            </tr>
          </thead>
          <tbody>
            {days.map((d) => (
              <tr key={d.date}>
                <td>{d.label}</td>
                <td>{d.total} Kč</td>
                <td>{d.count}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
