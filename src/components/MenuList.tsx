import { MenuCategory } from '../types/tableContext'

interface MenuListProps {
  categories: MenuCategory[]
  quantities?: Record<string, number>
  onQuantityChange?: (itemId: string, quantity: number) => void
}

export function MenuList({ categories, quantities, onQuantityChange }: MenuListProps) {
  if (categories.length === 0) {
    return <p>Menu zatím není naplněné.</p>
  }

  return (
    <div className="menu-list">
      {categories
        .slice()
        .sort((a, b) => a.sort_order - b.sort_order)
        .map((category) => (
          <section key={category.id} className="menu-category">
            <h2>{category.name}</h2>
            <ul>
              {category.items
                .filter((item) => item.is_available)
                .sort((a, b) => a.sort_order - b.sort_order)
                .map((item) => {
                  const quantity = quantities?.[item.id] ?? 0
                  return (
                    <li key={item.id} className="menu-item">
                      <div>
                        <span className="menu-item-name">{item.name}</span>
                        {item.description && (
                          <p className="menu-item-desc">{item.description}</p>
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
        ))}
    </div>
  )
}
