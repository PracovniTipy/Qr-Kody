import { useEffect, useRef, useState, type PointerEvent } from 'react'

interface Platform {
  id: number
  x: number
  y: number
  width: number
  type: 'stul' | 'sud'
}

interface Props {
  onGameOver: (score: number) => void
}

const PLAYER_SIZE = 32
const PLAYER_X_SPEED = 0.09 // px/ms vodorovný posun
const GRAVITY = 0.0022
const BOUNCE_VELOCITY = -0.62
const MAX_FALL_VELOCITY = 0.9
const LANDING_ZONE = 50 // tolerance pro dopad na plošinu (px)
const BASE_SCROLL_SPEED = 0.05 // px/ms na začátku
const MAX_SCROLL_SPEED = 0.16 // px/ms strop (dosažen cca po 50 s)
const SCROLL_SPEED_RAMP_PER_SEC = 0.0022
const BASE_PLATFORM_GAP = 90
const MAX_PLATFORM_GAP = 150
const PLATFORM_GAP_RAMP_PER_SEC = 1.2
const BASE_PLATFORM_WIDTH = 72
const MIN_PLATFORM_WIDTH = 46
const PLATFORM_WIDTH_SHRINK_PER_SEC = 0.5
const SCORE_UNIT_PX = 160

/**
 * Etapa 4 (masterplán, kapitola 11): čtvrtá arkádová hra pro hosty u stolu –
 * „Skákání nahoru“ (doodle-jump styl, hospodský vizuál). Host automaticky
 * poskakuje mezi stoly a sudy, které se řadí čím dál výš – ťuknutím se
 * otočí vodorovný směr, aby dopadl na další plošinu. Kamera (plošiny) se
 * posouvá dolů čím dál rychleji a plošiny jsou čím dál řidší a užší. Hra
 * končí, jakmile hráč propadne pod spodní okraj hřiště. Server
 * (submit_game_score, migrace 0012) validuje reálnost skóre podle
 * uplynulého času, tahle komponenta jen odehraje kolo a přes onGameOver
 * nahlásí výsledek.
 */
export function ClimbGame({ onGameOver }: Props) {
  const [playerX, setPlayerX] = useState(0)
  const [playerY, setPlayerY] = useState(0)
  const [platforms, setPlatforms] = useState<Platform[]>([])
  const [score, setScore] = useState(0)
  const [started, setStarted] = useState(false)

  const nextId = useRef(0)
  const areaRef = useRef<HTMLDivElement>(null)
  const playerXRef = useRef(0)
  const playerYRef = useRef(0)
  const velocityRef = useRef(0)
  const directionRef = useRef<1 | -1>(1)
  const climbedRef = useRef(0)
  const nextSpawnAtRef = useRef(0)
  const scoreRef = useRef(0)
  const finishedRef = useRef(false)
  const startedAtRef = useRef(0)
  const startedRef = useRef(false)

  useEffect(() => {
    let raf: number
    let lastTick = performance.now()
    startedAtRef.current = lastTick

    const areaWidth = areaRef.current?.clientWidth ?? 300
    const areaHeight = areaRef.current?.clientHeight ?? 420

    const initialX = areaWidth / 2 - PLAYER_SIZE / 2
    const initialY = areaHeight - 90
    playerXRef.current = initialX
    playerYRef.current = initialY
    setPlayerX(initialX)
    setPlayerY(initialY)

    nextId.current += 1
    const firstPlatform: Platform = {
      id: nextId.current,
      x: Math.max(0, initialX - 10),
      y: initialY + PLAYER_SIZE + 4,
      width: BASE_PLATFORM_WIDTH,
      type: 'stul',
    }
    setPlatforms([firstPlatform])
    nextSpawnAtRef.current = BASE_PLATFORM_GAP

    function frame(now: number) {
      const dt = Math.min(now - lastTick, 48) // ochrana proti skokům po přepnutí tabu
      lastTick = now
      const elapsedSec = (now - startedAtRef.current) / 1000
      const areaEl = areaRef.current
      const areaH = areaEl?.clientHeight ?? 420
      const areaW = areaEl?.clientWidth ?? 300

      const scrollSpeed = Math.min(MAX_SCROLL_SPEED, BASE_SCROLL_SPEED + SCROLL_SPEED_RAMP_PER_SEC * elapsedSec)
      const platformGap = Math.min(MAX_PLATFORM_GAP, BASE_PLATFORM_GAP + PLATFORM_GAP_RAMP_PER_SEC * elapsedSec)
      const platformWidth = Math.max(MIN_PLATFORM_WIDTH, BASE_PLATFORM_WIDTH - PLATFORM_WIDTH_SHRINK_PER_SEC * elapsedSec)

      if (!finishedRef.current && startedRef.current) {
        velocityRef.current = Math.min(MAX_FALL_VELOCITY, velocityRef.current + GRAVITY * dt)
        playerYRef.current += velocityRef.current * dt

        playerXRef.current += directionRef.current * PLAYER_X_SPEED * dt
        if (playerXRef.current <= 0) {
          playerXRef.current = 0
          directionRef.current = 1
        } else if (playerXRef.current >= areaW - PLAYER_SIZE) {
          playerXRef.current = areaW - PLAYER_SIZE
          directionRef.current = -1
        }

        climbedRef.current += scrollSpeed * dt
        const newScore = Math.floor(climbedRef.current / SCORE_UNIT_PX)
        if (newScore !== scoreRef.current) {
          scoreRef.current = newScore
          setScore(newScore)
        }

        if (climbedRef.current >= nextSpawnAtRef.current) {
          nextSpawnAtRef.current += platformGap
          nextId.current += 1
          const type: Platform['type'] = Math.random() < 0.5 ? 'sud' : 'stul'
          const width = type === 'sud' ? Math.max(36, platformWidth - 20) : platformWidth
          const x = Math.random() * Math.max(0, areaW - width)
          setPlatforms((prev) => [...prev, { id: nextId.current, x, y: -20, width, type }])
        }

        const playerLeft = playerXRef.current
        const playerRight = playerXRef.current + PLAYER_SIZE
        const playerBottom = playerYRef.current + PLAYER_SIZE
        const falling = velocityRef.current > 0

        setPlatforms((prev) => {
          const next: Platform[] = []
          for (const platform of prev) {
            const newY = platform.y + scrollSpeed * dt
            if (newY > areaH) continue

            if (falling) {
              const overlapsX = playerRight > platform.x && playerLeft < platform.x + platform.width
              const inLandingZone = playerBottom >= newY - 2 && playerBottom <= newY + LANDING_ZONE
              if (overlapsX && inLandingZone) {
                velocityRef.current = BOUNCE_VELOCITY
              }
            }

            next.push({ ...platform, y: newY })
          }
          return next
        })

        if (playerYRef.current > areaH) {
          if (!finishedRef.current) {
            finishedRef.current = true
            onGameOver(scoreRef.current)
          }
        }

        setPlayerX(playerXRef.current)
        setPlayerY(playerYRef.current)
      }

      if (!finishedRef.current) {
        raf = requestAnimationFrame(frame)
      }
    }

    raf = requestAnimationFrame(frame)
    return () => cancelAnimationFrame(raf)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function handleTap(e: PointerEvent<HTMLDivElement>) {
    e.preventDefault()
    if (finishedRef.current) return
    if (!startedRef.current) {
      startedRef.current = true
      setStarted(true)
      return
    }
    directionRef.current = directionRef.current === 1 ? -1 : 1
  }

  return (
    <div className="climb-game">
      <div className="climb-hud">
        <span>🕺 Skóre: {score}</span>
      </div>

      <div className="climb-area" ref={areaRef} onPointerDown={handleTap}>
        {!started && <p className="climb-start-hint">Ťukni pro start</p>}

        <span className="climb-decor" style={{ left: '6%', top: '10%' }}>
          🍷
        </span>
        <span className="climb-decor" style={{ left: '88%', top: '8%' }}>
          🌭
        </span>

        {platforms.map((platform) =>
          platform.type === 'sud' ? (
            <span
              key={platform.id}
              className="climb-platform climb-platform-sud"
              style={{
                left: `${platform.x}px`,
                top: `${platform.y}px`,
                width: `${platform.width}px`,
                fontSize: `${platform.width * 0.6}px`,
              }}
            >
              🛢️
            </span>
          ) : (
            <div
              key={platform.id}
              className="climb-platform climb-platform-stul"
              style={{ left: `${platform.x}px`, top: `${platform.y}px`, width: `${platform.width}px` }}
            />
          ),
        )}

        <span className="climb-player" style={{ left: `${playerX}px`, top: `${playerY}px` }}>
          🕺
        </span>
      </div>

      <p className="climb-hint">Ťukni pro start, pak ťukáním otáčej směr a chytej stoly i sudy – čím dál výš!</p>
    </div>
  )
}
