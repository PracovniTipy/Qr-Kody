import { FormEvent, useState } from 'react'
import { supabase } from '../../lib/supabaseClient'
import { VenueRow } from '../../types/adminVenue'

interface Props {
  venue: VenueRow
  onSaved: (venue: VenueRow) => void
}

/**
 * Základní údaje hospody: název, slug (součást veřejné URL /v/:slug/t/:token)
 * a přepínač aktivní/neaktivní. Editovat smí jen MAJITEL/MANAZER – vynucuje
 * to RLS pravidlo venues_update_manager (viz migrace 0002).
 */
export function VenueSettingsForm({ venue, onSaved }: Props) {
  const [name, setName] = useState(venue.name)
  const [slug, setSlug] = useState(venue.slug)
  const [isActive, setIsActive] = useState(venue.is_active)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [savedMsg, setSavedMsg] = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setSaving(true)
    setError(null)
    setSavedMsg(false)

    const { data, error: updateError } = await supabase
      .from('venues')
      .update({ name, slug, is_active: isActive })
      .eq('id', venue.id)
      .select()
      .single()

    setSaving(false)

    if (updateError) {
      setError(
        updateError.code === '23505'
          ? 'Tenhle slug už používá jiná hospoda, zvol jiný.'
          : updateError.message
      )
      return
    }

    onSaved(data as VenueRow)
    setSavedMsg(true)
  }

  return (
    <form className="panel" onSubmit={handleSubmit}>
      <h2>Nastavení hospody</h2>

      <label htmlFor="venue-name">Název</label>
      <input id="venue-name" value={name} onChange={(e) => setName(e.target.value)} required />

      <label htmlFor="venue-slug">Slug (adresa v URL)</label>
      <input
        id="venue-slug"
        value={slug}
        onChange={(e) => setSlug(e.target.value.trim().toLowerCase())}
        required
        pattern="[a-z0-9\-]+"
        title="Jen malá písmena, čísla a pomlčky."
      />

      <label className="checkbox-row">
        <input
          type="checkbox"
          checked={isActive}
          onChange={(e) => setIsActive(e.target.checked)}
        />
        Hospoda je aktivní (jinak QR kódy stolů přestanou fungovat)
      </label>

      {error && <p className="error">{error}</p>}
      {savedMsg && !error && <p className="success">Uloženo.</p>}

      <button type="submit" disabled={saving}>
        {saving ? 'Ukládám…' : 'Uložit'}
      </button>
    </form>
  )
}
