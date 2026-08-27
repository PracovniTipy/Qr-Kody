import { FormEvent, useState } from 'react'
import { supabase } from '../../lib/supabaseClient'
import { MenuCategoryRow, MenuItemRow } from '../../types/adminVenue'
import { MenuItemRowEditor } from './MenuItemRowEditor'

interface Props {
  venueId: string
  categories: MenuCategoryRow[]
  items: MenuItemRow[]
  onCategoriesChange: (categories: MenuCategoryRow[]) => void
  onItemsChange: (items: MenuItemRow[]) => void
}

/**
 * Kategorie a položky menu. Pořadí zatím řešíme jednoduše – nová kategorie/položka
 * se přidá na konec (sort_order = max + 1). Ruční přeskládání přijde později, pokud
 * bude potřeba – držíme se pravidla "nejdřív jednoduše funkční".
 */
export function MenuManager({ venueId, categories, items, onCategoriesChange, onItemsChange }: Props) {
  const [newCategoryName, setNewCategoryName] = useState('')
  const [newCategoryNameEn, setNewCategoryNameEn] = useState('')
  const [addingCategory, setAddingCategory] = useState(false)
  const [categoryError, setCategoryError] = useState<string | null>(null)
  const [newItemDrafts, setNewItemDrafts] = useState<
    Record<string, { name: string; nameEn: string; price: string }>
  >({})

  async function handleAddCategory(e: FormEvent) {
    e.preventDefault()
    if (!newCategoryName.trim()) return
    setAddingCategory(true)
    setCategoryError(null)

    const nextSort = categories.reduce((max, c) => Math.max(max, c.sort_order), -1) + 1

    const { data, error } = await supabase
      .from('menu_categories')
      .insert({
        venue_id: venueId,
        name: newCategoryName.trim(),
        name_en: newCategoryNameEn.trim() || null,
        sort_order: nextSort,
      })
      .select()
      .single()

    setAddingCategory(false)

    if (error) {
      setCategoryError(error.message)
      return
    }

    onCategoriesChange([...categories, data as MenuCategoryRow])
    setNewCategoryName('')
    setNewCategoryNameEn('')
  }

  async function handleDeleteCategory(category: MenuCategoryRow) {
    const itemCount = items.filter((i) => i.category_id === category.id).length
    const msg =
      itemCount > 0
        ? `Kategorie "${category.name}" obsahuje ${itemCount} položek – smažou se s ní. Pokračovat?`
        : `Smazat kategorii "${category.name}"?`
    if (!window.confirm(msg)) return

    const { error } = await supabase.from('menu_categories').delete().eq('id', category.id)
    if (!error) {
      onCategoriesChange(categories.filter((c) => c.id !== category.id))
      onItemsChange(items.filter((i) => i.category_id !== category.id))
    }
  }

  async function handleAddItem(e: FormEvent, category: MenuCategoryRow) {
    e.preventDefault()
    const draft = newItemDrafts[category.id]
    if (!draft?.name.trim() || draft.price === undefined || draft.price === '') return

    const categoryItems = items.filter((i) => i.category_id === category.id)
    const nextSort = categoryItems.reduce((max, i) => Math.max(max, i.sort_order), -1) + 1

    const { data, error } = await supabase
      .from('menu_items')
      .insert({
        venue_id: venueId,
        category_id: category.id,
        name: draft.name.trim(),
        name_en: draft.nameEn.trim() || null,
        price_czk: Number(draft.price),
        sort_order: nextSort,
      })
      .select()
      .single()

    if (!error && data) {
      onItemsChange([...items, data as MenuItemRow])
      setNewItemDrafts((prev) => ({ ...prev, [category.id]: { name: '', nameEn: '', price: '' } }))
    }
  }

  const sortedCategories = [...categories].sort((a, b) => a.sort_order - b.sort_order)

  return (
    <div className="panel">
      <h2>Kategorie a položky menu</h2>

      {sortedCategories.length === 0 && <p>Zatím žádné kategorie.</p>}

      {sortedCategories.map((category) => {
        const categoryItems = items
          .filter((i) => i.category_id === category.id)
          .sort((a, b) => a.sort_order - b.sort_order)
        const draft = newItemDrafts[category.id] ?? { name: '', nameEn: '', price: '' }

        return (
          <div key={category.id} className="menu-category-admin">
            <div className="entity-main category-header">
              <h3>
                {category.name}
                {category.name_en && <span className="menu-name-en"> ({category.name_en})</span>}
              </h3>
              <button type="button" className="danger" onClick={() => handleDeleteCategory(category)}>
                Smazat kategorii
              </button>
            </div>

            <ul className="entity-list">
              {categoryItems.map((item) => (
                <MenuItemRowEditor
                  key={item.id}
                  item={item}
                  onSaved={(updated) =>
                    onItemsChange(items.map((i) => (i.id === updated.id ? updated : i)))
                  }
                  onDeleted={(itemId) => onItemsChange(items.filter((i) => i.id !== itemId))}
                />
              ))}
            </ul>

            <form
              className="inline-form"
              onSubmit={(e) => handleAddItem(e, category)}
            >
              <input
                placeholder="Nová položka"
                value={draft.name}
                onChange={(e) =>
                  setNewItemDrafts((prev) => ({
                    ...prev,
                    [category.id]: { ...draft, name: e.target.value },
                  }))
                }
              />
              <input
                placeholder="Název anglicky (nepovinné)"
                value={draft.nameEn}
                onChange={(e) =>
                  setNewItemDrafts((prev) => ({
                    ...prev,
                    [category.id]: { ...draft, nameEn: e.target.value },
                  }))
                }
              />
              <input
                type="number"
                min={0}
                placeholder="Cena Kč"
                value={draft.price}
                onChange={(e) =>
                  setNewItemDrafts((prev) => ({
                    ...prev,
                    [category.id]: { ...draft, price: e.target.value },
                  }))
                }
              />
              <button type="submit">Přidat položku</button>
            </form>
          </div>
        )
      })}

      <form className="inline-form" onSubmit={handleAddCategory}>
        <input
          placeholder="Nová kategorie, např. Předkrmy"
          value={newCategoryName}
          onChange={(e) => setNewCategoryName(e.target.value)}
          required
        />
        <input
          placeholder="Anglicky (nepovinné)"
          value={newCategoryNameEn}
          onChange={(e) => setNewCategoryNameEn(e.target.value)}
        />
        <button type="submit" disabled={addingCategory}>
          {addingCategory ? 'Přidávám…' : 'Přidat kategorii'}
        </button>
      </form>
      {categoryError && <p className="error">{categoryError}</p>}
    </div>
  )
}
