import { useEffect, useRef, useState, type PointerEvent } from 'react'

interface Brick {
  id: string
  x: number
  y: number
  width: number
  height: number
  alive: boolean
  row: number
}

interface Props {
  onGameOver: (score: number) => void
}

const PADDLE_WIDTH = 70
const PADDLE_HEIGHT = 12
const PADDLE_BOTTOM_OFFSET = 18
const BALL_SIZE = 18
const BASE_BALL_SPEED = 0.26 // px/ms na začátku vlny
const SPEED_PER_WAVE = 0.02
const MAX_BALL_SPEED = 0.42
const BRICK_COLS = 6
const BASE_BRICK_ROWS = 4
const MAX_BRICK_ROWS = 6
const BRICK_HEIGHT = 16
const BRICK_GAP = 4
const BRICK_TOP = 36
const STARTING_LIVES = 3

function ballSpeedForWave(wave: number) {
  return Math.min(MAX_BALL_SPEED, BASE_BALL_SPEED + (wave - 1) * SPEED_PER_WAVE)
}

function generateBricks(wave: number, areaWidth: number): Brick[] {
  const rows = Math.min(MAX_BRICK_ROWS, BASE_BRICK_ROWS + Math.floor((wave - 1) / 2))
  const width = (areaWidth - (BRICK_COLS + 1) * BRICK_GAP) / BRICK_COLS
  const bricks: Brick[] = []
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < BRICK_COLS; col++) {
      bricks.push({
        id: `${wave}-${row}-${col}`,
        x: BRICK_GAP + col * (width + BRICK_GAP),
        y: BRICK_TOP + row * (BRICK_HEIGHT + BRICK_GAP),
        width,
        height: BRICK_HEIGHT,
        alive: true,
        row,
      })
    }
  }
  return bricks
}

/**
 * Etapa 4 (masterplán, kapitola 11): pátá a poslední arkádová hra se skóre
 * pro hosty u stolu – „Rozbíjení lahví" (arkanoid/breakout styl, hospodský
 * vizuál). Hráč táhne prstem pádlo (tácek) po spodním okraji a odráží
 * kuličku (kulečníkovou kouli) do řad lahví a sklenic naskládaných nahoře.
 * Hra je nekonečná – po rozbití celé vlny se objeví další, o něco rychlejší
 * a s víc řadami, dokud hráč nepřijde o všechny 3 životy (netrefené odražení
 * kuličky pádlem). Server (submit_game_score, migrace 0013) validuje
 * realističnost skóre podle uplynulého času, tahle komponenta jen odehraje
 * kolo a přes onGameOver nahlásí výsledek.
 */
export function BreakoutGame({ onGameOver }: Props) {
  const [paddleX, setPaddleX] = useState(0)
  const [ballX, setBallX] = useState(0)
  const [ballY, setBallY] = useState(0)
  const [bricks, setBricks] = useState<Brick[]>([])
  const [score, setScore] = useState(0)
  const [lives, setLives] = useState(STARTING_LIVES)
  const [started, setStarted] = useState(false)

  const areaRef = useRef<HTMLDivElement>(null)
  const paddleXRef = useRef(0)
  const ballXRef = useRef(0)
  const ballYRef = useRef(0)
  const velocityXRef = useRef(0)
  const velocityYRef = useRef(0)
  const bricksRef = useRef<Brick[]>([])
  const waveRef = useRef(1)
  const scoreRef = useRef(0)
  const livesRef = useRef(STARTING_LIVES)
  const startedRef = useRef(false)
  const finishedRef = useRef(false)

  useEffect(() => {
    let raf: number
    let lastTick = performance.now()

    const areaWidth = areaRef.current?.clientWidth ?? 300
    const areaHeight = areaRef.current?.clientHeight ?? 420
    const paddleTop0 = areaHeight - PADDLE_BOTTOM_OFFSET - PADDLE_HEIGHT

    paddleXRef.current = areaWidth / 2
    setPaddleX(paddleXRef.current)
    ballXRef.current = paddleXRef.current
    ballYRef.current = paddleTop0 - BALL_SIZE / 2
    setBallX(ballXRef.current)
    setBallY(ballYRef.current)

    bricksRef.current = generateBricks(waveRef.current, areaWidth)
    setBricks(bricksRef.current)

    function resetBallOnPaddle(areaH: number) {
      const paddleTop = areaH - PADDLE_BOTTOM_OFFSET - PADDLE_HEIGHT
      ballXRef.current = paddleXRef.current
      ballYRef.current = paddleTop - BALL_SIZE / 2
      velocityXRef.current = 0
      velocityYRef.current = 0
      startedRef.current = false
      setStarted(false)
    }

    function frame(now: number) {
      const dt = Math.min(now - lastTick, 48) // ochrana proti skokům po přepnutí tabu
      lastTick = now
      const areaEl = areaRef.current
      const areaW = areaEl?.clientWidth ?? 300
      const areaH = areaEl?.clientHeight ?? 420
      const paddleTop = areaH - PADDLE_BOTTOM_OFFSET - PADDLE_HEIGHT
      const paddleLeft = paddleXRef.current - PADDLE_WIDTH / 2
      const paddleRight = paddleXRef.current + PADDLE_WIDTH / 2

      if (!finishedRef.current) {
        if (startedRef.current) {
          ballXRef.current += velocityXRef.current * dt
          ballYRef.current += velocityYRef.current * dt

          if (ballXRef.current - BALL_SIZE / 2 <= 0) {
            ballXRef.current = BALL_SIZE / 2
            velocityXRef.current = Math.abs(velocityXRef.current)
          } else if (ballXRef.current + BALL_SIZE / 2 >= areaW) {
            ballXRef.current = areaW - BALL_SIZE / 2
            velocityXRef.current = -Math.abs(velocityXRef.current)
          }
          if (ballYRef.current - BALL_SIZE / 2 <= 0) {
            ballYRef.current = BALL_SIZE / 2
            velocityYRef.current = Math.abs(velocityYRef.current)
          }

          if (
            velocityYRef.current > 0 &&
            ballYRef.current + BALL_SIZE / 2 >= paddleTop &&
            ballYRef.current - BALL_SIZE / 2 <= paddleTop + PADDLE_HEIGHT &&
            ballXRef.current + BALL_SIZE / 2 >= paddleLeft &&
            ballXRef.current - BALL_SIZE / 2 <= paddleRight
          ) {
            velocityYRef.current = -Math.abs(velocityYRef.current)
            const hitOffset = (ballXRef.current - paddleXRef.current) / (PADDLE_WIDTH / 2)
            velocityXRef.current = hitOffset * ballSpeedForWave(waveRef.current) * 0.8
            ballYRef.current = paddleTop - BALL_SIZE / 2
          }

          let hitBrick: Brick | null = null
          for (const brick of bricksRef.current) {
            if (!brick.alive) continue
            if (
              ballXRef.current + BALL_SIZE / 2 > brick.x &&
              ballXRef.current - BALL_SIZE / 2 < brick.x + brick.width &&
              ballYRef.current + BALL_SIZE / 2 > brick.y &&
              ballYRef.current - BALL_SIZE / 2 < brick.y + brick.height
            ) {
              hitBrick = brick
              break
            }
          }

          if (hitBrick) {
            hitBrick.alive = false
            velocityYRef.current = -velocityYRef.current
            scoreRef.current += 1
            setScore(scoreRef.current)
            setBricks([...bricksRef.current])

            if (bricksRef.current.every((b) => !b.alive)) {
              waveRef.current += 1
              bricksRef.current = generateBricks(waveRef.current, areaW)
              setBricks(bricksRef.current)
              resetBallOnPaddle(areaH)
            }
          }

          if (!finishedRef.current && startedRef.current && ballYRef.current - BALL_SIZE / 2 > areaH) {
            livesRef.current -= 1
            setLives(livesRef.current)
            if (livesRef.current <= 0) {
              finishedRef.current = true
              onGameOver(scoreRef.current)
            } else {
              resetBallOnPaddle(areaH)
            }
          }

          setBallX(ballXRef.current)
          setBallY(ballYRef.current)
        } else {
          ballXRef.current = paddleXRef.current
          ballYRef.current = paddleTop - BALL_SIZE / 2
          setBallX(ballXRef.current)
          setBallY(ballYRef.current)
        }
      }

      if (!finishedRef.current) {
        raf = requestAnimationFrame(frame)
      }
    }

    raf = requestAnimationFrame(frame)
    return () => cancelAnimationFrame(raf)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function updatePaddleFromEvent(e: PointerEvent<HTMLDivElement>) {
    const areaEl = areaRef.current
    if (!areaEl) return
    const rect = areaEl.getBoundingClientRect()
    const areaWidth = rect.width
    const relativeX = e.clientX - rect.left
    const clamped = Math.max(PADDLE_WIDTH / 2, Math.min(areaWidth - PADDLE_WIDTH / 2, relativeX))
    paddleXRef.current = clamped
    setPaddleX(clamped)
  }

  function handlePointerDown(e: PointerEvent<HTMLDivElement>) {
    e.preventDefault()
    if (finishedRef.current) return
    updatePaddleFromEvent(e)
    if (!startedRef.current) {
      startedRef.current = true
      setStarted(true)
      velocityYRef.current = -ballSpeedForWave(waveRef.current)
      velocityXRef.current = (Math.random() - 0.5) * 0.2
    }
  }

  function handlePointerMove(e: PointerEvent<HTMLDivElement>) {
    if (finishedRef.current) return
    if (e.buttons === 0 && e.pointerType === 'mouse') return
    updatePaddleFromEvent(e)
  }

  return (
    <div className="breakout-game">
      <div className="breakout-hud">
        <span>🎱 Skóre: {score}</span>
        <span>🍺 Životy: {lives}</span>
      </div>

      <div
        className="breakout-area"
        ref={areaRef}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
      >
        <div className="pub-dust" />
        {!started && <p className="breakout-start-hint">Ťukni pro odpal</p>}

        <span className="breakout-decor" style={{ left: '6%', top: '8%', animationDelay: '0s' }}>
          🍷
        </span>
        <span className="breakout-decor" style={{ left: '88%', top: '6%', animationDelay: '0.7s' }}>
          🌭
        </span>
        <span className="breakout-decor" style={{ left: '10%', top: '80%', animationDelay: '1.5s' }}>
          🎵
        </span>
        <span className="breakout-decor" style={{ left: '90%', top: '82%', animationDelay: '2.3s' }}>
          🏮
        </span>

        {bricks
          .filter((b) => b.alive)
          .map((b) => (
            <div
              key={b.id}
              className={`breakout-brick breakout-brick-row${b.row % 4}`}
              style={{ left: `${b.x}px`, top: `${b.y}px`, width: `${b.width}px`, height: `${b.height}px` }}
            />
          ))}

        <div
          className="breakout-paddle"
          style={{ left: `${paddleX}px`, bottom: `${PADDLE_BOTTOM_OFFSET}px` }}
        />

        <span
          className="breakout-ball"
          style={{ left: `${ballX}px`, top: `${ballY}px`, fontSize: `${BALL_SIZE}px` }}
        >
          🎱
        </span>
      </div>

      <p className="breakout-hint">Táhni prstem pádlo a odrážej kuličku do lahví – hraješ o 3 životy!</p>
    </div>
  )
}
