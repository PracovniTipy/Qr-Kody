// Tvar dat, které vrací DB funkce public.submit_order / public.get_table_orders.
// Viz supabase/migrations/0005_orders.sql a 0007_payments.sql

export type OrderStatus = 'nova' | 'pripravuje_se' | 'hotovo' | 'zrusena'

export interface OrderItemSummary {
  name: string
  price_czk: number
  quantity: number
  note: string | null
}

export interface OrderSummary {
  id: string
  status: OrderStatus
  paid: boolean
  note: string | null
  created_at: string
  items: OrderItemSummary[]
}
