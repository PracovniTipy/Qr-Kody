import { useEffect, useState } from 'react'
import * as QRCode from 'qrcode'
import { useLanguage } from '../lib/language'

interface Props {
  amount: number
  bankAccount: string | null
  venueName: string
  tableLabel: string
}

function stripDiacritics(text: string) {
  return text.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
}

// Český standard "QR Platba" (SPD) – naskenovatelný většinou bankovních appek.
// Viz https://qr-platba.cz. Zpráva pro příjemce nesmí obsahovat hvězdičku,
// diakritiku pro jistotu odstraňujeme kvůli kompatibilitě starších čteček.
function buildSpdPayload(iban: string, amountCzk: number, message: string) {
  const cleanIban = iban.replace(/\s+/g, '').toUpperCase()
  const amount = amountCzk.toFixed(2)
  const plainMessage = stripDiacritics(message).replace(/\*/g, '').slice(0, 60)
  return `SPD*1.0*ACC:${cleanIban}*AM:${amount}*CC:CZK*MSG:${plainMessage}`
}

/**
 * Etapa 2 (část): QR platba. Skutečná platba jde mimo naši appku – host
 * naskenuje QR kód svou bankovní appkou a pošle peníze rovnou na účet
 * hospody zadaný ve VenueSettingsForm. Bez zadaného účtu zobrazíme jen
 * částku a odkážeme hosta na obsluhu.
 */
export function PaymentPanel({ amount, bankAccount, venueName, tableLabel }: Props) {
  const { lang } = useLanguage()
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null)

  useEffect(() => {
    if (!bankAccount || amount <= 0) {
      setQrDataUrl(null)
      return
    }

    let active = true
    const payload = buildSpdPayload(bankAccount, amount, `${venueName} stul ${tableLabel}`)

    QRCode.toDataURL(payload, { width: 220, margin: 1 }).then((url) => {
      if (active) setQrDataUrl(url)
    })

    return () => {
      active = false
    }
  }, [bankAccount, amount, venueName, tableLabel])

  if (amount <= 0) return null

  return (
    <section className="payment-panel">
      <h2>{lang === 'en' ? 'To pay' : 'K zaplacení'}</h2>
      <p className="payment-amount">{amount} Kč</p>
      {qrDataUrl ? (
        <>
          <img src={qrDataUrl} alt={lang === 'en' ? 'QR payment' : 'QR platba'} className="payment-qr" />
          <p className="payment-hint">
            {lang === 'en' ? 'Scan with your banking app and pay.' : 'Naskenuj bankovní appkou a zaplať.'}
          </p>
        </>
      ) : (
        <p className="payment-hint">
          {lang === 'en' ? 'Please pay with staff directly.' : 'Platbu prosím vyřiď u obsluhy.'}
        </p>
      )}
    </section>
  )
}
