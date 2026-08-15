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
const LIVES_START = 3
const BASKET_WIDTH_PERCENT = 18
const BASE_SPAWN_INTERVAL_MS = 900
const MIN_SPAWN_INTERVAL_MS = 350
const SPAWN_RAMP_MS_PER_SEC = 15 // o kolik ms se zkracuje interval spawnu za každou vteřinu hry
const BASE_FALL_SPEED = 0.15 // px/ms na začátku
const MAX_FALL_SPEED = 0.5 // px/ms strop (dosažen cca po 35 s)
const FALL_SPEED_RAMP_PER_SEC = 0.01 // o kolik px/ms se rychlost pádu zvýší za vteřinu

/**
 * Etapa 4 (masterplán, kapitola 11): samotná hra "Chytání padajících
 * surovin" – čistě klientská mechanika. Hra je nekonečná a postupně čím
 * dál těžší (rychlejší pád, kratší interval mezi surovinami) – končí, až
 * hráč přijde o všechny 3 životy (nechytnutá surovina, co spadne na zem,
 * stojí jeden život). Výsledné skóre validuje a ukládá server (viz
 * GamePage a migrace 0008/0009) podle uplynulého času, tahle komponenta
 * jen odehraje kolo a přes onGameOver nahlásí výsledek.
 */
export function KosikGame({ onGameOver }: Props) {
  const [basketX, setBasketX] = useState(50)
  const [items, setItems] = useState<FallingItem[]>([])
  const [score, setScore] = useState(0)
  const [lives, setLives] = useState(LIVES_START)
  const [throwerX, setThrowerX] = useState(50)

  const nextId = useRef(0)
  const areaRef = useRef<HTMLDivElement>(null)
  const basketXRef = useRef(50)
  const scoreRef = useRef(0)
  const livesRef = useRef(LIVES_START)
  const finishedRef = useRef(false)
  const startedAtRef = useRef(0)

  useEffect(() => {
    basketXRef.current = basketX
  }, [basketX])

  useEffect(() => {
    let raf: number
    let lastSpawn = 0
    let lastTick = performance.now()
    startedAtRef.current = lastTick

    function frame(now: number) {
      const dt = now - lastTick
      lastTick = now
      const elapsedSec = (now - startedAtRef.current) / 1000

      const fallSpeed = Math.min(MAX_FALL_SPEED, BASE_FALL_SPEED + FALL_SPEED_RAMP_PER_SEC * elapsedSec)
      const spawnInterval = Math.max(
        MIN_SPAWN_INTERVAL_MS,
        BASE_SPAWN_INTERVAL_MS - SPAWN_RAMP_MS_PER_SEC * elapsedSec,
      )

      if (!finishedRef.current) {
        if (now - lastSpawn > spawnInterval) {
          lastSpawn = now
          nextId.current += 1
          const spawnX = 10 + Math.random() * 80
          setThrowerX(spawnX)
          setItems((prev) => [
            ...prev,
            {
              id: nextId.current,
              x: spawnX,
              y: -10,
              emoji: EMOJIS[Math.floor(Math.random() * EMOJIS.length)],
            },
          ])
        }

        setItems((prev) => {
          const areaHeight = areaRef.current?.clientHeight ?? 400
          const next: FallingItem[] = []
          for (const item of prev) {
            const newY = item.y + dt * fallSpeed
            if (newY >= areaHeight - 60) {
              const dx = Math.abs(item.x - basketXRef.current)
              if (dx < BASKET_WIDTH_PERCENT / 2 + 6) {
                scoreRef.current += 1
                setScore(scoreRef.current)
                continue
              }
              if (newY >= areaHeight) {
                livesRef.current -= 1
                setLives(livesRef.current)
                if (livesRef.current <= 0 && !finishedRef.current) {
                  finishedRef.current = true
                  onGameOver(scoreRef.current)
                }
                continue
              }
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
        <span className="kosik-lives">
          {'❤️'.repeat(lives)}
          {'🖤'.repeat(LIVES_START - lives)}
        </span>
      </div>

      <div
        className="kosik-area"
        ref={areaRef}
        onPointerDown={handleAreaPointer}
        onPointerMove={(e) => e.buttons === 1 && handleAreaPointer(e)}
      >
        <div className="kosik-floor" />
        <div className="kosik-thrower" style={{ left: `${throwerX}%` }} aria-hidden="true">
          🧑‍🍳
        </div>
        {items.map((item) => (
          <span key={item.id} className="kosik-item" style={{ left: `${item.x}%`, top: `${item.y}px` }}>
            {item.emoji}
          </span>
        ))}
        <div className="kosik-basket" style={{ left: `${basketX}%`, width: `${BASKET_WIDTH_PERCENT}%` }}>
          🧺
        </div>
      </div>

      <p className="kosik-hint">
        Táhni prstem doleva/doprava a chytej suroviny do košíku – hra je čím dál rychlejší. Nechytnutá surovina tě
        stojí život.
      </p>
    </div>
  )
}
