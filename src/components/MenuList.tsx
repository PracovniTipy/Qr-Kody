import { useState } from 'react'
import { MenuCategory } from '../types/tableContext'

interface MenuListProps {
  categories: MenuCategory[]
  quantities?: Record<string, number>
  onQuantityChange?: (itemId: string, quantity: number) => void
}

/**
 * Vícejazyčné menu (masterplán, "co zbývá"): přepínač CS/EN nahoře nad menu.
 * Chybějící anglický překlad (name_en/description_en) se zobrazí jako fallback
 * na český text - admin tedy nemusí vyplnit překlad pro každou položku.
 */
export function MenuList({ categories, quantities, onQuantityChange }: MenuListProps) {
  const [lang, setLang] = useState<'cs' | 'en'>('cs')

  if (categories.length === 0) {
    return <p>Menu zatím není naplněné.</p>
  }

  return (
    <div className="menu-list">
      <div className="menu-lang-toggle">
        <button
          type="button"
          className={lang === 'cs' ? 'active' : ''}
          onClick={() => setLang('cs')}
        >
          CS
        </button>
        <button
          type="button"
          className={lang === 'en' ? 'active' : ''}
          onClick={() => setLang('en')}
        >
          EN
        </button>
      </div>

      {categories
        .slice()
        .sort((a, b) => a.sort_order - b.sort_order)
        .map((category) => {
          const categoryName = (lang === 'en' && category.name_en) || category.name
          return (
            <section key={category.id} className="menu-category">
              <h2>{categoryName}</h2>
              <ul>
                {category.items
                  .filter((item) => item.is_available)
                  .sort((a, b) => a.sort_order - b.sort_order)
                  .map((item) => {
                    const quantity = quantities?.[item.id] ?? 0
                    const itemName = (lang === 'en' && item.name_en) || item.name
                    const itemDescription = (lang === 'en' && item.description_en) || item.description
                    return (
                      <li key={item.id} className="menu-item">
                        <div>
                          <span className="menu-item-name">{itemName}</span>
                          {itemDescription && (
                            <p className="menu-item-desc">{itemDescription}</p>
                          )}
                        </div>
                        <div className="menu-item-right">
                          <span className="menu-item-price">{item.price_czk} Kč</span>
                          {onQuantityChange && (
                            <div className="quantity-stepper">
                              <button
                                type="button"
                                onClick={() => onQuantityChange(item.id, Math.max(0, quantity - 1))}
                                disabled={quantity === 0}
                              >
                                −
                              </button>
                              <span>{quantity}</span>
                              <button type="button" onClick={() => onQuantityChange(item.id, quantity + 1)}>
                                +
                              </button>
                            </div>
                          )}
                        </div>
                      </li>
                    )
                  })}
              </ul>
            </section>
          )
        })}
    </div>
  )
}
