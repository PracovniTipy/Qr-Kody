import { useLanguage } from '../lib/language'

interface Props {
  isOnline: boolean
  pendingCount: number
}

/**
 * Viditelný stav připojení pro hosta u stolu (Etapa 5 – "funguje bez
 * wifi"): appka při výpadku nepadá ani neblokuje, jen dá najevo, že je
 * offline a že čekající objednávky odešle automaticky, jakmile se
 * připojení vrátí.
 */
export function OfflineBanner({ isOnline, pendingCount }: Props) {
  const { lang } = useLanguage()
  if (isOnline && pendingCount === 0) return null

  return (
    <div className="offline-banner" role="status">
      {!isOnline && (
        <span>
          {lang === 'en'
            ? "📶 You're offline – the app keeps working, just without fresh data."
            : '📶 Jsi offline – appka funguje dál, jen bez čerstvých dat.'}
        </span>
      )}
      {pendingCount > 0 && (
        <span>
          {isOnline ? ' ' : ' · '}
          {lang === 'en' ? (
            <>
              ⏳ {pendingCount} {pendingCount === 1 ? 'order' : 'orders'} waiting to be sent
              {isOnline ? ', sending…' : ', will send once connected.'}
            </>
          ) : (
            <>
              ⏳ {pendingCount} {pendingCount === 1 ? 'objednávka čeká' : 'objednávky čekají'} na odeslání
              {isOnline ? ', odesílám…' : ', odešle se po připojení.'}
            </>
          )}
        </span>
      )}
    </div>
  )
}
