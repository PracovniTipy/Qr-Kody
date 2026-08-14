import { FormEvent, useState } from 'react'
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
 * Tisk QR stojánků (PDF) je součástí Etapy 1.1, tady zatím stačí odkaz
 * ke zkopírování/naskenování.
 */
export function TablesManager({ venueId, venueSlug, tables, onChange }: Props) {
  const [label, setLabel] = useState('')
  const [adding, setAdding] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [copiedId, setCopiedId] = useState<string | null>(null)

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
      <h2>Stoly a QR odkazy</h2>

      {tables.length === 0 && <p>Zatím žádné stoly.</p>}

      <ul className="entity-list">
        {tables.map((t) => (
          <li key={t.id} className={t.is_active ? '' : 'inactive'}>
            <div className="entity-main">
              <strong>Stůl {t.label}</strong>
              <a href={tableUrl(t.qr_token)} target="_blank" rel="noreferrer" className="table-link">
                {tableUrl(t.qr_token)}
              </a>
            </div>
            <div className="entity-actions">
              <button type="button" onClick={() => copyLink(t)}>
                {copiedId === t.id ? 'Zkopírováno' : 'Kopírovat odkaz'}
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
