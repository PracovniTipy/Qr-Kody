import { supabase } from './supabaseClient'

// "Funguje bez wifi" (Etapa 5): když host odešle objednávku bez připojení
// (nebo appka narazí na síťovou chybu uprostřed odesílání), objednávka se
// neztratí ani nezobrazí jako chyba – uloží se do fronty v localStorage a
// automaticky se odešle, jakmile se připojení vrátí. Záměrně NEřešíme
// nejvzácnější hraniční případ (požadavek doletí na server, ale odpověď se
// ztratí) – na to by bylo potřeba idempotenční klíč až v submit_order RPC,
// což je nad rámec první fáze offline odolnosti.

const STORAGE_KEY = 'stulhraje_order_queue_v1'

export interface QueuedOrderItem {
  menu_item_id: string
  quantity: number
}

export interface QueuedOrder {
  localId: string
  tableToken: string
  items: QueuedOrderItem[]
  note: string | null
  createdAt: number
}

function readQueue(): QueuedOrder[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    // Poškozený/nedostupný localStorage (soukromé okno apod.) – fronta se
    // chová, jako by byla prázdná, appka kvůli tomu nespadne.
    return []
  }
}

function writeQueue(queue: QueuedOrder[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(queue))
    // 'storage' event se v jiných tabech spouští automaticky, ale ve
    // stejném tabu ne – vlastní event si pošleme ručně, ať si na frontu
    // může počkat i otevřená stránka stolu.
    window.dispatchEvent(new CustomEvent('stulhraje:order-queue-changed'))
  } catch {
    // localStorage nejde zapsat (plný / zakázaný) – ticho, objednávka
    // zůstane jen v paměti aktuální session, appka dál funguje.
  }
}

export function enqueueOrder(tableToken: string, items: QueuedOrderItem[], note: string | null): QueuedOrder {
  const order: QueuedOrder = {
    localId: typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : String(Date.now() + Math.random()),
    tableToken,
    items,
    note,
    createdAt: Date.now(),
  }
  const queue = readQueue()
  queue.push(order)
  writeQueue(queue)
  return order
}

export function getQueueForTable(tableToken: string): QueuedOrder[] {
  return readQueue().filter((o) => o.tableToken === tableToken)
}

function removeFromQueue(localId: string) {
  const queue = readQueue().filter((o) => o.localId !== localId)
  writeQueue(queue)
}

function isNetworkError(message: string | undefined) {
  if (!message) return false
  const m = message.toLowerCase()
  return (
    m.includes('failed to fetch') ||
    m.includes('network') ||
    m.includes('load failed') ||
    m.includes('internet')
  )
}

let flushing = false

/**
 * Projde frontu a zkusí odeslat vše, co čeká. Síťové chyby nechávají
 * záznam ve frontě na později; skutečné business chyby ze serveru (např.
 * "objednávání je u téhle hospody vypnuté") záznam zahodí – opakovat je
 * donekonečna nemá smysl.
 */
export async function flushOrderQueue(): Promise<{ sent: number; remaining: number }> {
  if (flushing || !navigator.onLine) {
    return { sent: 0, remaining: readQueue().length }
  }
  flushing = true
  let sent = 0

  try {
    const queue = readQueue()
    for (const order of queue) {
      try {
        const { error } = await supabase.rpc('submit_order', {
          p_qr_token: order.tableToken,
          p_items: order.items,
          p_note: order.note,
        })

        if (!error) {
          removeFromQueue(order.localId)
          sent += 1
        } else if (isNetworkError(error.message)) {
          // zůstává ve frontě, zkusíme znovu příště
          break
        } else {
          // skutečná business chyba (např. vypnuté objednávání) – zahodit
          removeFromQueue(order.localId)
        }
      } catch (err) {
        if (isNetworkError(err instanceof Error ? err.message : String(err))) {
          break
        }
        removeFromQueue(order.localId)
      }
    }
  } finally {
    flushing = false
  }

  return { sent, remaining: readQueue().length }
}
