import { FormEvent, useState } from 'react'
import { supabase } from '../../lib/supabaseClient'
import { MenuItemRow } from '../../types/adminVenue'

interface Props {
  item: MenuItemRow
  onSaved: (item: MenuItemRow) => void
  onDeleted: (itemId: string) => void
}

/** Jeden řádek položky menu s inline editací (název, popis, cena, dostupnost). */
export function MenuItemRowEditor({ item, onSaved, onDeleted }: Props) {
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(item.name)
  const [nameEn, setNameEn] = useState(item.name_en ?? '')
  const [description, setDescription] = useState(item.description ?? '')
  const [descriptionEn, setDescriptionEn] = useState(item.description_en ?? '')
  const [price, setPrice] = useState(String(item.price_czk))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSave(e: FormEvent) {
    e.preventDefault()
    setSaving(true)
    setError(null)

    const { data, error: updateError } = await supabase
      .from('menu_items')
      .update({
        name: name.trim(),
        name_en: nameEn.trim() || null,
        description: description.trim() || null,
        description_en: descriptionEn.trim() || null,
        price_czk: Number(price),
      })
      .eq('id', item.id)
      .select()
      .single()

    setSaving(false)

    if (updateError) {
      setError(updateError.message)
      return
    }

    onSaved(data as MenuItemRow)
    setEditing(false)
  }

  async function toggleAvailable() {
    const { data, error: updateError } = await supabase
      .from('menu_items')
      .update({ is_available: !item.is_available })
      .eq('id', item.id)
      .select()
      .single()

    if (!updateError && data) onSaved(data as MenuItemRow)
  }

  async function handleDelete() {
    if (!window.confirm(`Smazat položku "${item.name}"?`)) return
    const { error: deleteError } = await supabase.from('menu_items').delete().eq('id', item.id)
    if (!deleteError) onDeleted(item.id)
  }

  if (editing) {
    return (
      <li>
        <form className="inline-form item-edit-form" onSubmit={handleSave}>
          <input value={name} onChange={(e) => setName(e.target.value)} required placeholder="Název" />
          <input
            value={nameEn}
            onChange={(e) => setNameEn(e.target.value)}
            placeholder="Název anglicky (nepovinné)"
          />
          <input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Popis (nepovinné)"
          />
          <input
            value={descriptionEn}
            onChange={(e) => setDescriptionEn(e.target.value)}
            placeholder="Popis anglicky (nepovinné)"
          />
          <input
            type="number"
            min={0}
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            required
            placeholder="Cena Kč"
          />
          <button type="submit" disabled={saving}>
            {saving ? 'Ukládám…' : 'Uložit'}
          </button>
          <button type="button" onClick={() => setEditing(false)}>
            Zrušit
          </button>
        </form>
        {error && <p className="error">{error}</p>}
      </li>
    )
  }

  return (
    <li className={item.is_available ? '' : 'inactive'}>
      <div className="entity-main">
        <strong>
          {item.name}
          {item.name_en && <span className="menu-name-en"> ({item.name_en})</span>}
        </strong>
        {item.description && <p className="menu-item-desc">{item.description}</p>}
      </div>
      <div className="entity-actions">
        <span className="menu-item-price">{item.price_czk} Kč</span>
        <button type="button" onClick={toggleAvailable}>
          {item.is_available ? 'Skrýt' : 'Zobrazit'}
        </button>
        <button type="button" onClick={() => setEditing(true)}>
          Upravit
        </button>
        <button type="button" className="danger" onClick={handleDelete}>
          Smazat
        </button>
      </div>
    </li>
  )
}
