import { useEffect, useRef, useState, type PointerEvent } from 'react'

interface FallingItem {
  id: number
  x: number
  y: number
  emoji: string
}

interface Props {
  onGameOver: (score: number) => void
}

const EMOJIS = ['🍺', '🍔', '🍟', '🥨', '🍕']
const GAME_DURATION_MS = 30000
const BASKET_WIDTH_PERCENT = 18
const SPAWN_INTERVAL_MS = 900
const FALL_SPEED = 0.18 // px/ms

/**
 * Etapa 4 (masterplán, kapitola 11): samotná hra "Chytání padajících
 * surovin" – čistě klientská mechanika (30 s, táhni košík doleva/doprava).
 * Výsledné skóre validuje a ukládá server (viz GamePage a migrace 0008),
 * tahle komponenta jen odehraje kolo a přes onGameOver nahlásí výsledek.
 */
export function KosikGame({ onGameOver }: Props) {
  const [basketX, setBasketX] = useState(50)
  const [items, setItems] = useState<FallingItem[]>([])
  const [score, setScore] = useState(0)
  const [timeLeft, setTimeLeft] = useState(GAME_DURATION_MS)

  const nextId = useRef(0)
  const areaRef = useRef<HTMLDivElement>(null)
  const basketXRef = useRef(50)
  const scoreRef = useRef(0)
  const finishedRef = useRef(false)

  useEffect(() => {
    basketXRef.current = basketX
  }, [basketX])

  useEffect(() => {
    let raf: number
    let lastSpawn = 0
    let lastTick = performance.now()

    function frame(now: number) {
      const dt = now - lastTick
      lastTick = now

      setTimeLeft((t) => {
        const next = t - dt
        if (next <= 0 && !finishedRef.current) {
          finishedRef.current = true
          onGameOver(scoreRef.current)
        }
        return Math.max(0, next)
      })

      if (!finishedRef.current) {
        if (now - lastSpawn > SPAWN_INTERVAL_MS) {
          lastSpawn = now
          nextId.current += 1
          setItems((prev) => [
            ...prev,
            {
              id: nextId.current,
              x: 10 + Math.random() * 80,
              y: -10,
              emoji: EMOJIS[Math.floor(Math.random() * EMOJIS.length)],
            },
          ])
        }

        setItems((prev) => {
          const areaHeight = areaRef.current?.clientHeight ?? 400
          const next: FallingItem[] = []
          for (const item of prev) {
            const newY = item.y + dt * FALL_SPEED
            if (newY >= areaHeight - 60) {
              const dx = Math.abs(item.x - basketXRef.current)
              if (dx < BASKET_WIDTH_PERCENT / 2 + 6) {
                scoreRef.current += 1
                setScore(scoreRef.current)
                continue
              }
              if (newY >= areaHeight) continue
            }
            next.push({ ...item, y: newY })
          }
          return next
        })
      }

      if (!finishedRef.current) {
        raf = requestAnimationFrame(frame)
      }
    }

    raf = requestAnimationFrame(frame)
    return () => cancelAnimationFrame(raf)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function handleAreaPointer(e: PointerEvent<HTMLDivElement>) {
    if (!areaRef.current) return
    const rect = areaRef.current.getBoundingClientRect()
    const pct = ((e.clientX - rect.left) / rect.width) * 100
    setBasketX(Math.max(BASKET_WIDTH_PERCENT / 2, Math.min(100 - BASKET_WIDTH_PERCENT / 2, pct)))
  }

  return (
    <div className="kosik-game">
      <div className="kosik-hud">
        <span>Skóre: {score}</span>
        <span>{Math.ceil(timeLeft / 1000)} s</span>
      </div>

      <div
        className="kosik-area"
        ref={areaRef}
        onPointerDown={handleAreaPointer}
        onPointerMove={(e) => e.buttons === 1 && handleAreaPointer(e)}
      >
        {items.map((item) => (
          <span key={item.id} className="kosik-item" style={{ left: `${item.x}%`, top: `${item.y}px` }}>
            {item.emoji}
          </span>
        ))}
        <div className="kosik-basket" style={{ left: `${basketX}%`, width: `${BASKET_WIDTH_PERCENT}%` }}>
          🧺
        </div>
      </div>

      <p className="kosik-hint">Táhni prstem doleva/doprava a chytej suroviny do košíku.</p>
    </div>
  )
}
