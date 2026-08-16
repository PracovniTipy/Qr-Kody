import { useEffect, useRef, useState, type PointerEvent } from 'react'

interface Obstacle {
  id: number
  x: number
  width: number
  height: number
  emoji: string
  rotate: number
  passed: boolean
}

interface Props {
  onGameOver: (score: number) => void
}

const PLAYER_X_PERCENT = 18
const PLAYER_SIZE = 34
const GROUND_HEIGHT = 22
const GRAVITY = 0.0016
const JUMP_VELOCITY = -0.68
const MAX_FALL_VELOCITY = 0.9
const BASE_SPEED = 0.13 // px/ms na začátku
const MAX_SPEED = 0.42 // px/ms strop (dosažen cca po 45 s)
const SPEED_RAMP_PER_SEC = 0.006
const BASE_SPAWN_INTERVAL_MS = 1500
const MIN_SPAWN_INTERVAL_MS = 850
const SPAWN_RAMP_MS_PER_SEC = 11

const OBSTACLE_TYPES = [
  { width: 30, height: 34, emoji: '🪑', rotate: 0 },
  { width: 42, height: 44, emoji: '🛢️', rotate: 0 },
  { width: 34, height: 22, emoji: '🍺', rotate: 100 },
]

/**
 * Etapa 4 (masterplán, kapitola 11): třetí arkádová hra pro hosty u stolu –
 * „Hospodský běh“ (endless runner, hospodský vizuál). Hráč je pořádně
 * podroušený štamgast – běží zrcadlově obráceně a nejistě se kymácí ze
 * strany na stranu (nad hlavou se mu motají hvězdičky), ale reálně pořád
 * postupuje dopředu. Ťuknutím přeskakuje překážky (židle, sudy, rozlité
 * pivo), které se ženou zprava. Hra je nekonečná a čím dál těžší (rychlejší
 * překážky, kratší interval mezi nimi) – končí hned při prvním nárazu.
 * Server (submit_game_score, migrace 0011) validuje reálnost skóre podle
 * uplynulého času, tahle komponenta jen odehraje kolo a přes onGameOver
 * nahlásí výsledek.
 */
export function RunnerGame({ onGameOver }: Props) {
  const [playerTop, setPlayerTop] = useState(0)
  const [obstacles, setObstacles] = useState<Obstacle[]>([])
  const [score, setScore] = useState(0)
  const [tilt, setTilt] = useState(0)
  const [started, setStarted] = useState(false)

  const nextId = useRef(0)
  const areaRef = useRef<HTMLDivElement>(null)
  const playerTopRef = useRef(0)
  const velocityRef = useRef(0)
  const scoreRef = useRef(0)
  const finishedRef = useRef(false)
  const startedAtRef = useRef(0)
  const startedRef = useRef(false)

  useEffect(() => {
    let raf: number
    let lastSpawn = 0
    let lastTick = performance.now()
    startedAtRef.current = lastTick

    function groundTopFor(areaHeight: number) {
      return areaHeight - GROUND_HEIGHT - PLAYER_SIZE
    }

    const initialGround = areaRef.current ? groundTopFor(areaRef.current.clientHeight) : 0
    playerTopRef.current = initialGround
    setPlayerTop(initialGround)

    function frame(now: number) {
      const dt = Math.min(now - lastTick, 48) // ochrana proti skokům po přepnutí tabu
      lastTick = now
      const elapsedSec = (now - startedAtRef.current) / 1000
      const areaEl = areaRef.current
      const areaHeight = areaEl?.clientHeight ?? 320
      const areaWidth = areaEl?.clientWidth ?? 300
      const groundTop = groundTopFor(areaHeight)

      const speed = Math.min(MAX_SPEED, BASE_SPEED + SPEED_RAMP_PER_SEC * elapsedSec)
      const spawnInterval = Math.max(
        MIN_SPAWN_INTERVAL_MS,
        BASE_SPAWN_INTERVAL_MS - SPAWN_RAMP_MS_PER_SEC * elapsedSec,
      )

      if (!finishedRef.current && startedRef.current) {
        velocityRef.current = Math.min(MAX_FALL_VELOCITY, velocityRef.current + GRAVITY * dt)
        playerTopRef.current += velocityRef.current * dt
        if (playerTopRef.current >= groundTop) {
          playerTopRef.current = groundTop
          velocityRef.current = 0
        }
        setTilt(Math.max(-25, Math.min(10, velocityRef.current * 40)) + Math.sin(elapsedSec * 5) * 10)

        if (now - lastSpawn > spawnInterval) {
          lastSpawn = now
          nextId.current += 1
          const type = OBSTACLE_TYPES[Math.floor(Math.random() * OBSTACLE_TYPES.length)]
          setObstacles((prev) => [
            ...prev,
            {
              id: nextId.current,
              x: areaWidth,
              width: type.width,
              height: type.height,
              emoji: type.emoji,
              rotate: type.rotate,
              passed: false,
            },
          ])
        }

        const playerXPx = (PLAYER_X_PERCENT / 100) * areaWidth
        const playerLeft = playerXPx - PLAYER_SIZE / 2
        const playerRight = playerXPx + PLAYER_SIZE / 2
        const playerTopPx = playerTopRef.current
        const playerBottomPx = playerTopPx + PLAYER_SIZE

        setObstacles((prev) => {
          const next: Obstacle[] = []
          for (const obstacle of prev) {
            const newX = obstacle.x - speed * dt
            if (newX + obstacle.width < 0) continue

            const obstacleTop = areaHeight - GROUND_HEIGHT - obstacle.height
            const obstacleBottom = areaHeight - GROUND_HEIGHT
            const overlapsX = playerRight > newX && playerLeft < newX + obstacle.width
            const overlapsY = playerBottomPx > obstacleTop && playerTopPx < obstacleBottom
            if (overlapsX && overlapsY) {
              if (!finishedRef.current) {
                finishedRef.current = true
                onGameOver(scoreRef.current)
              }
            }

            let passed = obstacle.passed
            if (!passed && newX + obstacle.width < playerLeft) {
              passed = true
              scoreRef.current += 1
              setScore(scoreRef.current)
            }

            next.push({ ...obstacle, x: newX, passed })
          }
          return next
        })

        setPlayerTop(playerTopRef.current)
      }

      if (!finishedRef.current) {
        raf = requestAnimationFrame(frame)
      }
    }

    raf = requestAnimationFrame(frame)
    return () => cancelAnimationFrame(raf)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function handleJump(e: PointerEvent<HTMLDivElement>) {
    e.preventDefault()
    if (finishedRef.current) return
    if (!startedRef.current) {
      startedRef.current = true
      setStarted(true)
    }
    const areaHeight = areaRef.current ? areaRef.current.clientHeight : 0
    const groundTop = areaHeight - GROUND_HEIGHT - PLAYER_SIZE
    if (playerTopRef.current >= groundTop - 0.5) {
      velocityRef.current = JUMP_VELOCITY
    }
  }

  return (
    <div className="runner-game">
      <div className="runner-hud">
        <span>🏃 Skóre: {score}</span>
      </div>

      <div className="runner-area" ref={areaRef} onPointerDown={handleJump}>
        <div className="pub-dust" />
        {!started && <p className="runner-start-hint">Ťukni pro skok</p>}

        <span className="runner-decor" style={{ left: '6%', top: '10%' }}>
          🍷
        </span>
        <span className="runner-decor" style={{ left: '88%', top: '8%' }}>
          🌭
        </span>

        <div className="runner-ground" />

        {obstacles.map((obstacle) => (
          <span
            key={obstacle.id}
            className="runner-obstacle"
            style={{
              left: `${obstacle.x}px`,
              bottom: `${GROUND_HEIGHT}px`,
              fontSize: `${obstacle.height}px`,
              transform: `rotate(${obstacle.rotate}deg)`,
            }}
          >
            {obstacle.emoji}
          </span>
        ))}

        <span
          className="runner-player-dizzy"
          style={{
            left: `${PLAYER_X_PERCENT}%`,
            top: `${playerTop - 30}px`,
          }}
        >
          💫
        </span>
        <span
          className="runner-player"
          style={{
            left: `${PLAYER_X_PERCENT}%`,
            top: `${playerTop}px`,
            transform: `translateX(-50%) scaleX(-1) rotate(${tilt}deg)`,
          }}
        >
          🏃
        </span>
      </div>

      <p className="runner-hint">Ťukej do plochy a přeskakuj překážky v hospodě – čím dál rychlejší!</p>
    </div>
  )
}
