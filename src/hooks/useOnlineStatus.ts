import { useEffect, useState } from 'react'

/**
 * "Funguje bez wifi" (Etapa 5): sleduje stav připojení přes standardní
 * online/offline eventy prohlížeče. navigator.onLine je jen hrubý odhad
 * (ví jen o síťovém rozhraní, ne o tom, jestli Supabase skutečně
 * odpovídá), ale pro zobrazení "jsi offline" banneru a spouštění
 * synchronizace fronty objednávek stačí.
 */
export function useOnlineStatus(): boolean {
  const [isOnline, setIsOnline] = useState(() =>
    typeof navigator === 'undefined' ? true : navigator.onLine
  )

  useEffect(() => {
    function goOnline() {
      setIsOnline(true)
    }
    function goOffline() {
      setIsOnline(false)
    }

    window.addEventListener('online', goOnline)
    window.addEventListener('offline', goOffline)

    return () => {
      window.removeEventListener('online', goOnline)
      window.removeEventListener('offline', goOffline)
    }
  }, [])

  return isOnline
}
