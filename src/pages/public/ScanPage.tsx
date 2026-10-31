import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { LanguageSwitcher } from '../../components/LanguageSwitcher'
import { useLanguage } from '../../lib/language'
import { tablePathFromQr } from '../../lib/lastTable'

type ScanState = 'starting' | 'scanning' | 'denied' | 'no_camera' | 'unsupported' | 'error'

// Minimální typ pro nativní BarcodeDetector (Chrome/Android, a tím i
// aplikace pro Android postavená jako Trusted Web Activity). Kde chybí,
// použije se knihovna jsQR načtená až při potřebě.
interface DetectedBarcode {
  rawValue: string
}
interface BarcodeDetectorLike {
  detect(source: CanvasImageSource): Promise<DetectedBarcode[]>
}
type BarcodeDetectorCtor = new (options: { formats: string[] }) => BarcodeDetectorLike

const SCAN_INTERVAL_MS = 180

/**
 * Skener QR kódu stolu přímo v aplikaci. Host nemusí odcházet do fotoaparátu:
 * appka otevře zadní kameru, rozpozná QR kód a ověří, že jde o odkaz na stůl
 * StůlHraje (cizí QR kódy odmítne) – pak rovnou otevře stránku stolu.
 */
export function ScanPage() {
  const { lang } = useLanguage()
  const navigate = useNavigate()
  const t = (cs: string, en: string) => (lang === 'en' ? en : cs)

  const videoRef = useRef<HTMLVideoElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const timerRef = useRef<number | null>(null)
  const doneRef = useRef(false)

  const [state, setState] = useState<ScanState>('starting')
  const [foreignCode, setForeignCode] = useState(false)

  const stopCamera = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current)
      timerRef.current = null
    }
    streamRef.current?.getTracks().forEach((track) => track.stop())
    streamRef.current = null
  }, [])

  const handleResult = useCallback(
    (text: string) => {
      if (doneRef.current) return
      const path = tablePathFromQr(text)
      if (!path) {
        setForeignCode(true)
        return
      }
      doneRef.current = true
      if (navigator.vibrate) navigator.vibrate(60)
      stopCamera()
      navigate(path)
    },
    [navigate, stopCamera]
  )

  useEffect(() => {
    let cancelled = false
    doneRef.current = false

    async function start() {
      if (!navigator.mediaDevices?.getUserMedia) {
        setState('unsupported')
        return
      }

      let stream: MediaStream
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' } },
          audio: false,
        })
      } catch (err) {
        if (cancelled) return
        const name = err instanceof DOMException ? err.name : ''
        if (name === 'NotAllowedError' || name === 'SecurityError') setState('denied')
        else if (name === 'NotFoundError' || name === 'OverconstrainedError') setState('no_camera')
        else setState('error')
        return
      }

      if (cancelled) {
        stream.getTracks().forEach((track) => track.stop())
        return
      }
      streamRef.current = stream

      const video = videoRef.current
      if (!video) return
      video.srcObject = stream
      video.setAttribute('playsinline', 'true')
      try {
        await video.play()
      } catch {
        // autoplay může selhat, video se rozjede po interakci – skenujeme dál
      }
      if (cancelled) return
      setState('scanning')

      const Detector = (window as unknown as { BarcodeDetector?: BarcodeDetectorCtor }).BarcodeDetector
      let detector: BarcodeDetectorLike | null = null
      if (Detector) {
        try {
          detector = new Detector({ formats: ['qr_code'] })
        } catch {
          detector = null
        }
      }
      const jsQR = detector ? null : (await import('jsqr')).default

      const tick = async () => {
        if (cancelled || doneRef.current) return
        const v = videoRef.current
        const canvas = canvasRef.current
        if (v && canvas && v.readyState >= 2 && v.videoWidth > 0) {
          try {
            if (detector) {
              const codes = await detector.detect(v)
              if (codes.length > 0) handleResult(codes[0].rawValue)
            } else if (jsQR) {
              // Zmenšený snímek – rychlejší dekódování, na QR kód ze stojánku stačí
              const scale = Math.min(1, 640 / v.videoWidth)
              const w = Math.round(v.videoWidth * scale)
              const h = Math.round(v.videoHeight * scale)
              canvas.width = w
              canvas.height = h
              const ctx = canvas.getContext('2d', { willReadFrequently: true })
              if (ctx) {
                ctx.drawImage(v, 0, 0, w, h)
                const image = ctx.getImageData(0, 0, w, h)
                const code = jsQR(image.data, w, h, { inversionAttempts: 'dontInvert' })
                if (code?.data) handleResult(code.data)
              }
            }
          } catch {
            // jednotlivý snímek se nepovedl – zkusíme další
          }
        }
        if (!cancelled && !doneRef.current) {
          timerRef.current = window.setTimeout(tick, SCAN_INTERVAL_MS)
        }
      }
      tick()
    }

    start()

    return () => {
      cancelled = true
      stopCamera()
    }
  }, [handleResult, stopCamera])

  useEffect(() => {
    if (!foreignCode) return
    const timeout = window.setTimeout(() => setForeignCode(false), 2500)
    return () => window.clearTimeout(timeout)
  }, [foreignCode])

  return (
    <div className="scan-page">
      <header>
        <LanguageSwitcher />
        <Link to="/" className="back-link">
          {t('← Zpět', '← Back')}
        </Link>
        <h1>{t('📷 Naskenuj QR kód stolu', '📷 Scan the table QR code')}</h1>
      </header>

      <div className={`scan-viewport ${state === 'scanning' ? 'active' : ''}`}>
        <video ref={videoRef} muted playsInline className="scan-video" />
        <div className="scan-frame" aria-hidden="true" />
        {state === 'starting' && <p className="scan-overlay-text">{t('Spouštím kameru…', 'Starting camera…')}</p>}
      </div>
      <canvas ref={canvasRef} hidden />

      {state === 'scanning' && (
        <p className="scan-hint">
          {foreignCode
            ? t('Tohle není QR kód stolu StůlHraje.', "That's not a StůlHraje table QR code.")
            : t('Namiř kameru na QR kód na stojánku.', 'Point the camera at the QR code on the stand.')}
        </p>
      )}

      {state === 'denied' && (
        <div className="scan-message">
          <p>
            {t(
              'Appka nemá povolený přístup ke kameře. Povol ho v nastavení telefonu (Aplikace → StůlHraje → Oprávnění → Fotoaparát), nebo naskenuj QR kód běžným fotoaparátem.',
              "The app isn't allowed to use the camera. Allow it in your phone settings (Apps → StůlHraje → Permissions → Camera), or scan the QR code with your regular camera app."
            )}
          </p>
        </div>
      )}

      {(state === 'no_camera' || state === 'unsupported' || state === 'error') && (
        <div className="scan-message">
          <p>
            {t(
              'Kameru se nepodařilo spustit. Naskenuj QR kód stolu běžným fotoaparátem telefonu – otevře se rovnou tady.',
              "Couldn't start the camera. Scan the table QR code with your phone's regular camera – it will open right here."
            )}
          </p>
        </div>
      )}
    </div>
  )
}
