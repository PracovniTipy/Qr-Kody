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
const BOUNCE_VELOCITY = -0.72
const MAX_FALL_VELOCITY = 0.9
const LANDING_ZONE = 50 // tolerance pro dopad na plošinu (px)
const CAMERA_THRESHOLD_RATIO = 0.42 // nad touto linkou (odshora) se misto hrace posouva svet dolu
const BASE_PLATFORM_GAP = 60 // rovnomerny "schod" mezi plosinami (bez nahodneho rozhozeni)
const MAX_PLATFORM_GAP = 95 // strop pod max. vyskou skoku, aby dalsi plosina byla vzdy dosazitelna
const PLATFORM_GAP_RAMP_PER_SEC = 0.6
const BASE_PLATFORM_WIDTH = 78
const MIN_PLATFORM_WIDTH = 50
const PLATFORM_WIDTH_SHRINK_PER_SEC = 0.3
const SCORE_UNIT_PX = 20
const SPAWN_AHEAD_MARGIN = 40 // kolik px nad hornim okrajem hriste musi mit zebrik plosin naskok
const MAX_X_STEP = 46 // max. vodorovny rozdil mezi sousednimi plosinami, at na ne hrac vzdy dosahne

function spawnPlatform(id: number, topY: number, gap: number, width: number, areaW: number, prevX: number): Platform {
  const type: Platform['type'] = Math.random() < 0.4 ? 'sud' : 'stul'
  const platformWidth = type === 'sud' ? Math.max(36, width - 20) : width
  const maxX = Math.max(0, areaW - platformWidth)
  const step = (Math.random() - 0.5) * 2 * MAX_X_STEP
  const x = Math.min(maxX, Math.max(0, prevX + step))
  return { id, x, y: topY - gap, width: platformWidth, type }
}

/**
 * Etapa 4 (masterplán, kapitola 11): čtvrtá arkádová hra pro hosty u stolu –
 * „Skákání nahoru“ (doodle-jump styl, kovbojský vizuál). Host automaticky
 * poskakuje mezi prkny a sudy, které se řadí čím dál výš – ťuknutím se
 * otočí vodorovný směr, aby dopadl na další plošinu. Kamera je opravdová:
 * dokud hráč skáče pod prahovou linkou (skáče „na místě“), obraz stojí, a
 * teprve jakmile by vyskočil nad ni, místo toho se posune celý svět
 * (plošiny) o stejný kus dolů – takže se obraz hýbe jen nahoru, přesně
 * podle toho, jak vysoko hráč doskočí. Plošiny se předgenerují do zásoby
 * a průběžně doplňují nad hřištěm, aby vždycky bylo na co skákat. Hra
 * končí, jakmile hráč propadne pod spodní okraj hřiště. Server
 * (submit_game_score, migrace 0012) validuje reálnost skóre podle
 * uplynulého času, tahle komponenta jen odehraje kolo a přes onGameOver
 * nahlásí výsledek. Vizuál (přeladěno na kovbojské téma): soumrak nad
 * kaňonem – fialovorůžové nebe přecházející do oranžova, siluety hor a
 * kaktusů na obzoru, poletující prach na pozadí a kovboj, kterému pod
 * nohama září teplá záře a jemně se natáčí do rytmu skoků.
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
  const platformsRef = useRef<Platform[]>([])
  const climbedRef = useRef(0)
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

    // Pregenerovany zebrik plosin - od prvni plosiny hned pod hracem az
    // notny kus nad horni okraj hriste, at je vzdy hned na co skakat (ne
    // jen na tu prvni, jak tomu bylo predtim).
    nextId.current += 1
    const initialPlatforms: Platform[] = [
      {
        id: nextId.current,
        x: Math.max(0, initialX - 10),
        y: initialY + PLAYER_SIZE + 4,
        width: BASE_PLATFORM_WIDTH,
        type: 'stul',
      },
    ]
    let topY = initialPlatforms[0].y
    let prevX = initialPlatforms[0].x
    while (topY > -areaHeight * 1.5) {
      nextId.current += 1
      const p = spawnPlatform(nextId.current, topY, BASE_PLATFORM_GAP, BASE_PLATFORM_WIDTH, areaWidth, prevX)
      initialPlatforms.push(p)
      topY = p.y
      prevX = p.x
    }
    platformsRef.current = initialPlatforms
    setPlatforms(initialPlatforms)

    function frame(now: number) {
      const dt = Math.min(now - lastTick, 48) // ochrana proti skokům po přepnutí tabu
      lastTick = now
      const elapsedSec = (now - startedAtRef.current) / 1000
      const areaEl = areaRef.current
      const areaH = areaEl?.clientHeight ?? 420
      const areaW = areaEl?.clientWidth ?? 300
      const cameraThreshold = areaH * CAMERA_THRESHOLD_RATIO

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

        // Kamera: hrac smi skakat volne, dokud je pod hranici. Jakmile by
        // vyskocil vys, misto toho ho na hranici "podrzime" a o stejny kus
        // posuneme cely svet (plosiny) dolu - tim vznika iluze stoupani.
        let scrollDelta = 0
        if (playerYRef.current < cameraThreshold) {
          scrollDelta = cameraThreshold - playerYRef.current
          playerYRef.current = cameraThreshold
        }

        if (scrollDelta > 0) {
          climbedRef.current += scrollDelta
          const newScore = Math.floor(climbedRef.current / SCORE_UNIT_PX)
          if (newScore !== scoreRef.current) {
            scoreRef.current = newScore
            setScore(newScore)
          }
        }

        const playerLeft = playerXRef.current
        const playerRight = playerXRef.current + PLAYER_SIZE
        const playerBottom = playerYRef.current + PLAYER_SIZE
        const falling = velocityRef.current > 0

        const shifted: Platform[] = []
        for (const platform of platformsRef.current) {
          const newY = platform.y + scrollDelta
          if (newY > areaH) continue // scrollnula se pod spodni okraj - zahodit

          if (falling) {
            const overlapsX = playerRight > platform.x && playerLeft < platform.x + platform.width
            const inLandingZone = playerBottom >= newY - 2 && playerBottom <= newY + LANDING_ZONE
            if (overlapsX && inLandingZone) {
              velocityRef.current = BOUNCE_VELOCITY
            }
          }

          shifted.push({ ...platform, y: newY })
        }

        // Doplnit zebrik nahore, at tam vzdy je dost naskoku nad hristem
        // (ne jen "casem", ale podle skutecne naskakane vysky).
        const topmost = shifted.length
          ? shifted.reduce((a, b) => (a.y < b.y ? a : b))
          : { y: areaH - 90, x: areaW / 2 }
        let topY = topmost.y
        let prevX = topmost.x
        let guard = 0
        while (topY > -SPAWN_AHEAD_MARGIN - platformGap && guard < 12) {
          nextId.current += 1
          const p = spawnPlatform(nextId.current, topY, platformGap, platformWidth, areaW, prevX)
          shifted.push(p)
          topY = p.y
          prevX = p.x
          guard += 1
        }

        platformsRef.current = shifted
        setPlatforms(shifted)

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
        <span>🤠 Skóre: {score}</span>
      </div>

      <div className="climb-area" ref={areaRef} onPointerDown={handleTap}>
        <div className="pub-dust" />

        {!started && <p className="climb-start-hint">Ťukni pro start</p>}

        <span className="climb-decor" style={{ left: '6%', top: '10%', animationDelay: '0s' }}>
          🌵
        </span>
        <span className="climb-decor" style={{ left: '88%', top: '8%', animationDelay: '0.6s' }}>
          🐎
        </span>
        <span className="climb-decor" style={{ left: '18%', top: '32%', animationDelay: '1.2s' }}>
          ⭐
        </span>
        <span className="climb-decor" style={{ left: '75%', top: '46%', animationDelay: '2s' }}>
          🔥
        </span>
        <span className="climb-decor" style={{ left: '10%', top: '64%', animationDelay: '0.9s' }}>
          🪶
        </span>
        <span className="climb-decor" style={{ left: '82%', top: '72%', animationDelay: '2.6s' }}>
          🌵
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

        <span
          className="climb-player-glow"
          style={{ left: `${playerX + PLAYER_SIZE / 2}px`, top: `${playerY + PLAYER_SIZE}px` }}
        />
        <span className="climb-player" style={{ left: `${playerX}px`, top: `${playerY}px` }}>
          <svg viewBox="0 0 32 32" width="32" height="32" xmlns="http://www.w3.org/2000/svg">
            <ellipse cx="16" cy="13.6" rx="13" ry="3" fill="#2e1c10" />
            <rect x="9" y="4" width="14" height="9" rx="4" fill="#5a3a1c" />
            <rect x="9" y="10.6" width="14" height="2.2" fill="#d9a441" />
            <rect x="9.5" y="23.4" width="13" height="7.2" rx="3" fill="#8a5a2c" />
            <path d="M11.5 23.4 L20.5 23.4 L16 29.2 Z" fill="#c1442f" />
            <circle cx="16" cy="18.6" r="6" fill="#e8b382" />
            <circle cx="13.7" cy="18" r="0.9" fill="#3a2414" />
            <circle cx="18.3" cy="18" r="0.9" fill="#3a2414" />
            <path d="M13.2 21 Q16 22.6 18.8 21" stroke="#7a4a24" strokeWidth="1.1" fill="none" strokeLinecap="round" />
          </svg>
        </span>
      </div>

      <p className="climb-hint">
        Ťukni pro start, pak ťukáním otáčej směr a skákej po prknech i sudech, kovboji – čím dál výš!
      </p>
    </div>
  )
}
