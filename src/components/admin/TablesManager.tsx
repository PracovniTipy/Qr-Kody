import { FormEvent, useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../../lib/supabaseClient'
import { TableRow } from '../../types/adminVenue'

interface Props {
  venueId: string
  venueSlug: string
  tables: TableRow[]
  onChange: (tables: TableRow[]) => void
}

/**
 * Stoly a jejich QR odkazy. qr_token generuje databáze sama (viz sloupec
 * tables.qr_token v migraci 0001), takže admin jen zadá popisek stolu.
 * Etapa 1.1 přidává obnovu (zneplatnění) QR tokenu, značku testovacího
 * skenu a odkaz na tisk QR stojánků (QrStandPage). Etapa 2 přidává přehled
 * nezaplacené útraty stolu a tlačítko pro její označení jako zaplacené
 * (host platí přes QR platbu na stránce stolu, viz PaymentPanel a migrace
 * 0007) – čtení i zápis chrání stejné RLS jako zbytek téhle stránky.
 */
export function TablesManager({ venueId, venueSlug, tables, onChange }: Props) {
  const [label, setLabel] = useState('')
  const [adding, setAdding] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [unpaidTotals, setUnpaidTotals] = useState<Record<string, number>>({})

  const loadUnpaidTotals = useCallback(async () => {
    const { data } = await supabase
      .from('orders')
      .select('table_id, order_items(price_czk_snapshot, quantity)')
      .eq('venue_id', venueId)
      .eq('paid', false)
      .neq('status', 'zrusena')

    const totals: Record<string, number> = {}
    for (const order of (data ?? []) as {
      table_id: string
      order_items: { price_czk_snapshot: number; quantity: number }[]
    }[]) {
      const orderTotal = order.order_items.reduce(
        (sum, it) => sum + it.price_czk_snapshot * it.quantity,
        0
      )
      totals[order.table_id] = (totals[order.table_id] ?? 0) + orderTotal
    }
    setUnpaidTotals(totals)
  }, [venueId])

  useEffect(() => {
    loadUnpaidTotals()
  }, [loadUnpaidTotals])

  async function markPaid(t: TableRow) {
    const { error: updateError } = await supabase
      .from('orders')
      .update({ paid: true })
      .eq('table_id', t.id)
      .eq('paid', false)
      .neq('status', 'zrusena')

    if (!updateError) loadUnpaidTotals()
  }

  function tableUrl(qrToken: string) {
    return `${window.location.origin}/v/${venueSlug}/t/${qrToken}`
  }

  async function handleAdd(e: FormEvent) {
    e.preventDefault()
    if (!label.trim()) return
    setAdding(true)
    setError(null)

    const { data, error: insertError } = await supabase
      .from('tables')
      .insert({ venue_id: venueId, label: label.trim() })
      .select()
      .single()

    setAdding(false)

    if (insertError) {
      setError(
        insertError.code === '23505'
          ? 'Stůl s tímhle označením už existuje.'
          : insertError.message
      )
      return
    }

    onChange([...tables, data as TableRow])
    setLabel('')
  }

  async function toggleActive(t: TableRow) {
    const { data, error: updateError } = await supabase
      .from('tables')
      .update({ is_active: !t.is_active })
      .eq('id', t.id)
      .select()
      .single()

    if (!updateError && data) {
      onChange(tables.map((row) => (row.id === t.id ? (data as TableRow) : row)))
    }
  }

  async function regenerateToken(t: TableRow) {
    if (
      !window.confirm(
        `Vygenerovat nový QR odkaz pro stůl "${t.label}"? Starý odkaz i vytištěný stojánek přestanou fungovat.`
      )
    ) {
      return
    }

    const newToken =
      typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID().replace(/-/g, '')
        : Math.random().toString(16).slice(2) + Date.now().toString(16)

    const { data, error: updateError } = await supabase
      .from('tables')
      .update({ qr_token: newToken, tested_at: null })
      .eq('id', t.id)
      .select()
      .single()

    if (!updateError && data) {
      onChange(tables.map((row) => (row.id === t.id ? (data as TableRow) : row)))
    }
  }

  async function markTested(t: TableRow) {
    const { data, error: updateError } = await supabase
      .from('tables')
      .update({ tested_at: new Date().toISOString() })
      .eq('id', t.id)
      .select()
      .single()

    if (!updateError && data) {
      onChange(tables.map((row) => (row.id === t.id ? (data as TableRow) : row)))
    }
  }

  async function handleDelete(t: TableRow) {
    if (!window.confirm(`Opravdu smazat stůl "${t.label}"? QR kód přestane fungovat.`)) return

    const { error: deleteError } = await supabase.from('tables').delete().eq('id', t.id)
    if (!deleteError) {
      onChange(tables.filter((row) => row.id !== t.id))
    }
  }

  async function copyLink(t: TableRow) {
    try {
      await navigator.clipboard.writeText(tableUrl(t.qr_token))
      setCopiedId(t.id)
      setTimeout(() => setCopiedId(null), 1500)
    } catch {
      // Clipboard API nemusí být v nezabezpečeném kontextu dostupné – odkaz jde zkopírovat ručně.
    }
  }

  return (
    <div className="panel">
      <div className="panel-header">
        <h2>Stoly a QR odkazy</h2>
        <Link to={`/admin/hospoda/${venueId}/tisk`} className="back-link">
          Tisk QR stojánků →
        </Link>
      </div>

      {tables.length === 0 && <p>Zatím žádné stoly.</p>}

      <ul className="entity-list">
        {tables.map((t) => (
          <li key={t.id} className={t.is_active ? '' : 'inactive'}>
            <div className="entity-main">
              <strong>Stůl {t.label}</strong>
              <a href={tableUrl(t.qr_token)} target="_blank" rel="noreferrer" className="table-link">
                {tableUrl(t.qr_token)}
              </a>
              {unpaidTotals[t.id] > 0 && (
                <span className="unpaid-badge">K zaplacení: {unpaidTotals[t.id]} Kč</span>
              )}
            </div>
            <div className="entity-actions">
              <button type="button" onClick={() => copyLink(t)}>
                {copiedId === t.id ? 'Zkopírováno' : 'Kopírovat odkaz'}
              </button>
              {unpaidTotals[t.id] > 0 && (
                <button type="button" onClick={() => markPaid(t)}>
                  Označit jako zaplaceno
                </button>
              )}
              {t.tested_at ? (
                <span className="success">✓ Otestováno</span>
              ) : (
                <button type="button" onClick={() => markTested(t)}>
                  Označit jako otestované
                </button>
              )}
              <button type="button" onClick={() => regenerateToken(t)}>
                Nový QR
              </button>
              <button type="button" onClick={() => toggleActive(t)}>
                {t.is_active ? 'Deaktivovat' : 'Aktivovat'}
              </button>
              <button type="button" className="danger" onClick={() => handleDelete(t)}>
                Smazat
              </button>
            </div>
          </li>
        ))}
      </ul>

      <form className="inline-form" onSubmit={handleAdd}>
        <input
          placeholder="Označení stolu, např. 5"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          required
        />
        <button type="submit" disabled={adding}>
          {adding ? 'Přidávám…' : 'Přidat stůl'}
        </button>
      </form>
      {error && <p className="error">{error}</p>}
    </div>
  )
}
