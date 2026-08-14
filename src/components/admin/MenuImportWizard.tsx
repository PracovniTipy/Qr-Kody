import { ChangeEvent, useState } from 'react'
import { supabase } from '../../lib/supabaseClient'
import { MenuCategoryRow, MenuItemRow } from '../../types/adminVenue'

interface DraftItem {
  key: string
  category: string
  name: string
  description: string
  price: string
}

interface Props {
  venueId: string
  categories: MenuCategoryRow[]
  items: MenuItemRow[]
  onCategoriesChange: (categories: MenuCategoryRow[]) => void
  onItemsChange: (items: MenuItemRow[]) => void
}

let draftKeyCounter = 0
function nextKey(): string {
  draftKeyCounter += 1
  return `draft-${draftKeyCounter}`
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = reader.result as string
      const commaIndex = result.indexOf(',')
      resolve(commaIndex >= 0 ? result.slice(commaIndex + 1) : result)
    }
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })
}

interface ParsedCategory {
  name: string
  items: Array<{ name: string; description?: string; price_czk: number | null }>
}

/**
 * Etapa 1.1: import menu z fotky nebo PDF. Soubor pošleme do Edge Function
 * `import-menu`, která zavolá Claude vision API a vrátí navržené kategorie
 * a položky. Nic se rovnou nezapíše do menu_categories/menu_items – admin
 * si výsledek nejdřív zkontroluje a upraví v editovatelné tabulce (kapitola
 * 11 hlavního plánu: "kontrola a publikování"), a teprve tlačítkem
 * "Publikovat" se položky uloží běžnými Supabase inserty přes stejná RLS
 * pravidla jako ruční přidávání v MenuManageru.
 */
export function MenuImportWizard({ venueId, categories, items, onCategoriesChange, onItemsChange }: Props) {
  const [status, setStatus] = useState<'idle' | 'analyzing' | 'review' | 'publishing' | 'done'>('idle')
  const [error, setError] = useState<string | null>(null)
  const [drafts, setDrafts] = useState<DraftItem[]>([])

  async function handleFileChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return

    setError(null)
    setStatus('analyzing')

    try {
      const dataBase64 = await fileToBase64(file)
      const { data, error: fnError } = await supabase.functions.invoke('import-menu', {
        body: { venueId, mimeType: file.type, dataBase64 },
      })

      if (fnError) {
        throw new Error(fnError.message)
      }
      if (data?.error) {
        throw new Error(data.error)
      }

      const parsedCategories = (data?.categories ?? []) as ParsedCategory[]

      const newDrafts: DraftItem[] = []
      for (const cat of parsedCategories) {
        for (const it of cat.items ?? []) {
          newDrafts.push({
            key: nextKey(),
            category: cat.name || 'Menu',
            name: it.name || '',
            description: it.description || '',
            price: it.price_czk != null ? String(it.price_czk) : '',
          })
        }
      }

      if (newDrafts.length === 0) {
        setError('V souboru se nepodařilo najít žádné položky menu. Zkus jinou fotku nebo je přidej ručně.')
        setStatus('idle')
        return
      }

      setDrafts(newDrafts)
      setStatus('review')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Rozpoznávání menu selhalo.')
      setStatus('idle')
    }
  }

  function updateDraft(key: string, patch: Partial<DraftItem>) {
    setDrafts((prev) => prev.map((d) => (d.key === key ? { ...d, ...patch } : d)))
  }

  function removeDraft(key: string) {
    setDrafts((prev) => prev.filter((d) => d.key !== key))
  }

  function addEmptyDraft() {
    setDrafts((prev) => [...prev, { key: nextKey(), category: 'Menu', name: '', description: '', price: '' }])
  }

  async function handlePublish() {
    const valid = drafts.filter((d) => d.category.trim() && d.name.trim() && d.price.trim() !== '')
    if (valid.length === 0) {
      setError('Nejsou tu žádné vyplněné položky k publikování.')
      return
    }

    setStatus('publishing')
    setError(null)

    try {
      const categoryByName = new Map(categories.map((c) => [c.name, c]))
      let nextCategorySort = categories.reduce((max, c) => Math.max(max, c.sort_order), -1) + 1
      const newCategories: MenuCategoryRow[] = []

      const uniqueCategoryNames = Array.from(new Set(valid.map((d) => d.category.trim())))
      for (const name of uniqueCategoryNames) {
        if (categoryByName.has(name)) continue
        const { data, error: catError } = await supabase
          .from('menu_categories')
          .insert({ venue_id: venueId, name, sort_order: nextCategorySort })
          .select()
          .single()
        if (catError) throw new Error(catError.message)
        nextCategorySort += 1
        categoryByName.set(name, data as MenuCategoryRow)
        newCategories.push(data as MenuCategoryRow)
      }

      const sortCounters = new Map<string, number>()
      for (const c of categories) {
        const currentMax = items
          .filter((i) => i.category_id === c.id)
          .reduce((max, i) => Math.max(max, i.sort_order), -1)
        sortCounters.set(c.id, currentMax + 1)
      }

      const rowsToInsert = valid.map((d) => {
        const category = categoryByName.get(d.category.trim())!
        const sort = sortCounters.get(category.id) ?? 0
        sortCounters.set(category.id, sort + 1)
        return {
          venue_id: venueId,
          category_id: category.id,
          name: d.name.trim(),
          description: d.description.trim() || null,
          price_czk: Number(d.price),
          sort_order: sort,
        }
      })

      const { data: insertedItems, error: itemsError } = await supabase
        .from('menu_items')
        .insert(rowsToInsert)
        .select()

      if (itemsError) throw new Error(itemsError.message)

      onCategoriesChange([...categories, ...newCategories])
      onItemsChange([...items, ...((insertedItems ?? []) as MenuItemRow[])])
      setDrafts([])
      setStatus('done')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Publikování se nepovedlo.')
      setStatus('review')
    }
  }

  return (
    <div className="panel">
      <h2>Import menu z fotky nebo PDF</h2>

      {status === 'idle' && (
        <>
          <p className="menu-item-desc">
            Vyfoť nebo nahraj PDF jídelního/nápojového lístku – navrhneme kategorie a položky, které si
            před uložením zkontroluješ a upravíš.
          </p>
          <input type="file" accept="image/*,application/pdf" onChange={handleFileChange} />
        </>
      )}

      {status === 'analyzing' && <p>Analyzuji menu…</p>}

      {status === 'publishing' && <p>Publikuji…</p>}

      {status === 'done' && (
        <>
          <p className="success">✓ Menu bylo přidáno.</p>
          <button type="button" onClick={() => setStatus('idle')}>
            Importovat další soubor
          </button>
        </>
      )}

      {status === 'review' && (
        <>
          <p className="menu-item-desc">Zkontroluj a uprav rozpoznané položky, pak je publikuj.</p>
          <ul className="entity-list">
            {drafts.map((d) => (
              <li key={d.key}>
                <div className="entity-main item-edit-form">
                  <input
                    value={d.category}
                    onChange={(e) => updateDraft(d.key, { category: e.target.value })}
                    placeholder="Kategorie"
                  />
                  <input
                    value={d.name}
                    onChange={(e) => updateDraft(d.key, { name: e.target.value })}
                    placeholder="Název položky"
                  />
                  <input
                    value={d.description}
                    onChange={(e) => updateDraft(d.key, { description: e.target.value })}
                    placeholder="Popis (nepovinné)"
                  />
                  <input
                    type="number"
                    min={0}
                    value={d.price}
                    onChange={(e) => updateDraft(d.key, { price: e.target.value })}
                    placeholder="Cena Kč"
                  />
                </div>
                <div className="entity-actions">
                  <button type="button" className="danger" onClick={() => removeDraft(d.key)}>
                    Smazat řádek
                  </button>
                </div>
              </li>
            ))}
          </ul>

          <div className="entity-actions">
            <button type="button" onClick={addEmptyDraft}>
              Přidat řádek
            </button>
            <button type="button" onClick={handlePublish}>
              Publikovat ({drafts.length})
            </button>
            <button
              type="button"
              onClick={() => {
                setDrafts([])
                setStatus('idle')
              }}
            >
              Zahodit
            </button>
          </div>
        </>
      )}

      {error && <p className="error">{error}</p>}
    </div>
  )
}
