import { useEffect, useRef, useState, type PointerEvent } from 'react'

interface Pipe {
  id: number
  x: number
  gapTop: number
  gapHeight: number
  passed: boolean
}

interface Props {
  onGameOver: (score: number) => void
}

const BIRD_X_PERCENT = 25
const BIRD_SIZE = 34
const GRAVITY = 0.0016
const FLAP_VELOCITY = -0.52
const MAX_FALL_VELOCITY = 0.75
const PIPE_WIDTH = 56
const BASE_PIPE_SPEED = 0.14 // px/ms na začátku
const MAX_PIPE_SPEED = 0.34 // px/ms strop (dosažen cca po 40 s)
const PIPE_SPEED_RAMP_PER_SEC = 0.005
const BASE_SPAWN_INTERVAL_MS = 1700
const MIN_SPAWN_INTERVAL_MS = 1100
const SPAWN_RAMP_MS_PER_SEC = 12
const BASE_GAP_HEIGHT = 210
const MIN_GAP_HEIGHT = 140
const GAP_SHRINK_PER_SEC = 1.4

/**
 * Etapa 4 (masterplán, kapitola 11): druhá arkádová hra pro hosty u stolu –
 * „Let mezi sudy“ (flappy-bird styl). Pták ťuknutím „plácá křídly“ a musí
 * proletět mezerami mezi sudy. Hra je nekonečná a čím dál těžší (rychlejší
 * sudy, kratší interval mezi nimi, užší mezera) – končí hned při prvním
 * nárazu, stejně jako klasický flappy bird. Server (submit_game_score,
 * migrace 0010) validuje reálnost skóre podle uplynulého času, tahle
 * komponenta jen odehraje kolo a přes onGameOver nahlásí výsledek.
 */
export function FlappyGame({ onGameOver }: Props) {
  const [birdY, setBirdY] = useState(150)
  const [pipes, setPipes] = useState<Pipe[]>([])
  const [score, setScore] = useState(0)
  const [rotation, setRotation] = useState(0)
  const [started, setStarted] = useState(false)

  const nextId = useRef(0)
  const areaRef = useRef<HTMLDivElement>(null)
  const birdYRef = useRef(150)
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
    const initialY = areaRef.current ? areaRef.current.clientHeight / 2 : 150
    birdYRef.current = initialY
    setBirdY(initialY)

    function frame(now: number) {
      const dt = Math.min(now - lastTick, 48) // ochrana proti skokům po přepnutí tabu
      lastTick = now
      const elapsedSec = (now - startedAtRef.current) / 1000
      const areaEl = areaRef.current
      const areaHeight = areaEl?.clientHeight ?? 400
      const areaWidth = areaEl?.clientWidth ?? 300

      const pipeSpeed = Math.min(MAX_PIPE_SPEED, BASE_PIPE_SPEED + PIPE_SPEED_RAMP_PER_SEC * elapsedSec)
      const spawnInterval = Math.max(
        MIN_SPAWN_INTERVAL_MS,
        BASE_SPAWN_INTERVAL_MS - SPAWN_RAMP_MS_PER_SEC * elapsedSec,
      )
      const gapHeight = Math.max(MIN_GAP_HEIGHT, BASE_GAP_HEIGHT - GAP_SHRINK_PER_SEC * elapsedSec)

      if (!finishedRef.current && startedRef.current) {
        velocityRef.current = Math.min(MAX_FALL_VELOCITY, velocityRef.current + GRAVITY * dt)
        birdYRef.current += velocityRef.current * dt
        setRotation(Math.max(-30, Math.min(75, velocityRef.current * 60)))

        if (now - lastSpawn > spawnInterval) {
          lastSpawn = now
          nextId.current += 1
          const margin = 30
          const gapTop = margin + Math.random() * Math.max(20, areaHeight - gapHeight - margin * 2)
          setPipes((prev) => [...prev, { id: nextId.current, x: areaWidth, gapTop, gapHeight, passed: false }])
        }

        const birdXPx = (BIRD_X_PERCENT / 100) * areaWidth

        setPipes((prev) => {
          const next: Pipe[] = []
          for (const pipe of prev) {
            const newX = pipe.x - pipeSpeed * dt
            if (newX + PIPE_WIDTH < 0) continue

            const overlapsX = birdXPx + BIRD_SIZE / 2 > newX && birdXPx - BIRD_SIZE / 2 < newX + PIPE_WIDTH
            if (overlapsX) {
              const birdTop = birdYRef.current - BIRD_SIZE / 2
              const birdBottom = birdYRef.current + BIRD_SIZE / 2
              if (birdTop < pipe.gapTop || birdBottom > pipe.gapTop + pipe.gapHeight) {
                if (!finishedRef.current) {
                  finishedRef.current = true
                  onGameOver(scoreRef.current)
                }
              }
            }

            let passed = pipe.passed
            if (!passed && newX + PIPE_WIDTH < birdXPx - BIRD_SIZE / 2) {
              passed = true
              scoreRef.current += 1
              setScore(scoreRef.current)
            }

            next.push({ ...pipe, x: newX, passed })
          }
          return next
        })

        if (birdYRef.current - BIRD_SIZE / 2 <= 0) {
          birdYRef.current = BIRD_SIZE / 2
          if (!finishedRef.current) {
            finishedRef.current = true
            onGameOver(scoreRef.current)
          }
        }
        if (birdYRef.current + BIRD_SIZE / 2 >= areaHeight) {
          birdYRef.current = areaHeight - BIRD_SIZE / 2
          if (!finishedRef.current) {
            finishedRef.current = true
            onGameOver(scoreRef.current)
          }
        }

        setBirdY(birdYRef.current)
      }

      if (!finishedRef.current) {
        raf = requestAnimationFrame(frame)
      }
    }

    raf = requestAnimationFrame(frame)
    return () => cancelAnimationFrame(raf)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function handleFlap(e: PointerEvent<HTMLDivElement>) {
    e.preventDefault()
    if (finishedRef.current) return
    if (!startedRef.current) {
      startedRef.current = true
      setStarted(true)
    }
    velocityRef.current = FLAP_VELOCITY
  }

  return (
    <div className="flappy-game">
      <div className="flappy-hud">
        <span>Skóre: {score}</span>
      </div>

      <div className="flappy-area" ref={areaRef} onPointerDown={handleFlap}>
        {!started && <p className="flappy-start-hint">Ťukni pro vzlet</p>}

        {pipes.map((pipe) => (
          <div key={pipe.id}>
            <div
              className="flappy-pipe flappy-pipe-top"
              style={{ left: `${pipe.x}px`, width: `${PIPE_WIDTH}px`, height: `${pipe.gapTop}px` }}
            />
            <div
              className="flappy-pipe flappy-pipe-bottom"
              style={{ left: `${pipe.x}px`, width: `${PIPE_WIDTH}px`, top: `${pipe.gapTop + pipe.gapHeight}px` }}
            />
          </div>
        ))}

        <span
          className="flappy-bird"
          style={{
            left: `${BIRD_X_PERCENT}%`,
            top: `${birdY}px`,
            transform: `translate(-50%, -50%) rotate(${rotation}deg)`,
          }}
        >
          🐦
        </span>
      </div>

      <p className="flappy-hint">Ťukej do plochy a proletávej mezerami mezi sudy – hra je čím dál rychlejší.</p>
    </div>
  )
}
