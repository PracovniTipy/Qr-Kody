import { MenuCategory } from '../types/tableContext'

export function MenuList({ categories }: { categories: MenuCategory[] }) {
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
                .map((item) => (
                  <li key={item.id} className="menu-item">
                    <div>
                      <span className="menu-item-name">{item.name}</span>
                      {item.description && (
                        <p className="menu-item-desc">{item.description}</p>
                      )}
                    </div>
                    <span className="menu-item-price">{item.price_czk} Kč</span>
                  </li>
                ))}
            </ul>
          </section>
        ))}
    </div>
  )
}
