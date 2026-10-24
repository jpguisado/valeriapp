import { useMemo, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import type { MeasurementPoint } from '@shared/stats'
import { REFERENCE_PERCENTILES, percentileOfWeight, weightAtPercentile, type Sex } from '@shared/growth'
import { addDays, addMonths, ageInDays, diffDays, parseDayKey, type DayKey } from '@shared/time'
import { birthLabel, grams, number } from '@/lib/format'
import { ChevronLeft, ChevronRight } from './icons'

type View = 'birth' | 'month' | 'week'

/** Un tramo de la vida, en días desde el nacimiento: [from, to). */
interface AgeWindow {
  from: number
  to: number
}

/** El mes de vida `index` (0 = el primero), de calendario: del 12 al 12. */
function monthWindow(birthDate: DayKey, index: number): AgeWindow {
  return {
    from: diffDays(birthDate, addMonths(birthDate, index)),
    to: diffDays(birthDate, addMonths(birthDate, index + 1)),
  }
}

function weekWindow(index: number): AgeWindow {
  return { from: index * 7, to: index * 7 + 7 }
}

/** El mes de vida en el que cae un día de edad. */
function monthIndexOf(birthDate: DayKey, age: number): number {
  let index = Math.floor(age / 31)
  while (monthWindow(birthDate, index + 1).from <= age) index += 1
  return index
}

/**
 * La curva del peso con tres encuadres: toda la vida, un mes o una semana.
 *
 * Desde el nacimiento se ve si la curva va en paralelo a la banda; ampliada,
 * se lee cuánto ganó en ese mes o esa semana concretos, que es de lo que se
 * habla en la consulta.
 */
export function WeightChart({
  points,
  birthDate,
  sex,
  now,
}: {
  points: MeasurementPoint[]
  birthDate: DayKey
  sex: Sex | null
  now: number
}) {
  const [view, setView] = useState<View>('birth')
  const today = ageInDays(birthDate, now)
  const current = view === 'week' ? Math.floor(today / 7) : monthIndexOf(birthDate, today)
  const [offset, setOffset] = useState(0)
  const index = Math.max(0, current + offset)

  const window =
    view === 'birth' ? undefined : view === 'week' ? weekWindow(index) : monthWindow(birthDate, index)

  const choose = (next: View): void => {
    setView(next)
    setOffset(0)
  }

  return (
    <div className="col" style={{ gap: 10 }}>
      <div className="segmented" role="tablist" aria-label="Encuadre del peso">
        {(
          [
            ['birth', 'Desde nacer'],
            ['month', 'Por meses'],
            ['week', 'Por semanas'],
          ] as const
        ).map(([key, text]) => (
          <button key={key} role="tab" aria-selected={view === key} onClick={() => choose(key)}>
            {text}
          </button>
        ))}
      </div>

      {window && (
        <div className="row between">
          <button
            className="btn ghost icon"
            onClick={() => setOffset((value) => value - 1)}
            disabled={index <= 0}
            aria-label={view === 'week' ? 'Semana anterior' : 'Mes anterior'}
          >
            <ChevronLeft size={20} />
          </button>
          <span className="col center" style={{ gap: 0 }}>
            <strong className="period-label">
              {view === 'week' ? `Semana ${index + 1}` : `Mes ${index + 1}`} de vida
            </strong>
            <WindowGain points={points} birthDate={birthDate} window={window} />
          </span>
          <button
            className="btn ghost icon"
            onClick={() => setOffset((value) => Math.min(0, value + 1))}
            disabled={offset >= 0}
            aria-label={view === 'week' ? 'Semana siguiente' : 'Mes siguiente'}
          >
            <ChevronRight size={20} />
          </button>
        </div>
      )}

      <GrowthChart
        points={points}
        birthDate={birthDate}
        sex={sex}
        window={window}
        scale={view}
      />
    </div>
  )
}

/**
 * Lo ganado en el tramo: del último pesaje anterior (o el primero dentro, si
 * no lo hay) al último dentro. Sin dos pesajes no hay nada que restar.
 */
function WindowGain({
  points,
  birthDate,
  window,
}: {
  points: MeasurementPoint[]
  birthDate: DayKey
  window: AgeWindow
}) {
  const aged = points.map((point) => ({ point, age: ageInDays(birthDate, point.at) }))
  const inside = aged.filter(({ age }) => age >= window.from && age < window.to)
  const before = aged.filter(({ age }) => age < window.from).at(-1)
  const last = inside.at(-1)
  const start = before ?? inside[0]
  if (!last || !start || start === last) {
    return (
      <span className="tiny faint">
        {inside.length === 0 ? 'sin pesajes' : '1 pesaje'}
      </span>
    )
  }
  const delta = last.point.value - start.point.value
  return (
    <span className={delta >= 0 ? 'trend-up tiny' : 'trend-down tiny'}>
      {delta >= 0 ? '+' : '−'}
      {grams(Math.abs(delta))}
      <span className="faint"> en {last.age - start.age} días</span>
    </span>
  )
}

/**
 * El peso contra la referencia de la OMS.
 *
 * La banda no dice si el peso es bueno o malo —un bebé sano vive igual de bien
 * en el percentil 15 que en el 90— sino dónde cae respecto a la población y,
 * sobre todo, si la curva sube en paralelo a ella.
 */
export function GrowthChart({
  points,
  birthDate,
  sex,
  window,
  scale = 'birth',
}: {
  points: MeasurementPoint[]
  birthDate: DayKey
  sex: Sex | null
  /** Sin tramo, toda la vida hasta hoy y un poco más. */
  window?: AgeWindow
  /** Qué marcas lleva el eje: meses, semanas o días de vida. */
  scale?: View
}) {
  const W = 320
  const H = 190
  const PAD = { top: 12, right: 10, bottom: 22, left: 42 }

  const geometry = useMemo(() => {
    if (points.length === 0) return null

    const ages = points.map((point) => ageInDays(birthDate, point.at))
    const maxAge = Math.max(...ages, 14)
    // Un poco de futuro a la derecha: la banda se lee mejor con hacia dónde va.
    const fromDay = window?.from ?? 0
    const toDay = window?.to ?? Math.max(28, Math.ceil(maxAge * 1.15))
    const spanDays = toDay - fromDay
    const ticks = Array.from({ length: 40 }, (_, i) => fromDay + (spanDays * i) / 39)

    /**
     * Los pesajes del tramo, más el inmediatamente anterior y el posterior:
     * la línea entra y sale por los bordes en vez de quedarse en un punto
     * suelto cuando en la semana solo hubo un pesaje.
     */
    const inside = ages.map((age) => age >= fromDay && age < toDay)
    const firstIn = inside.indexOf(true)
    const lastIn = inside.lastIndexOf(true)
    const beforeIndex = firstIn === -1 ? ages.findLastIndex((age) => age < fromDay) : firstIn - 1
    const afterIndex = lastIn === -1 ? ages.findIndex((age) => age >= toDay) : lastIn + 1
    const drawn = points
      .map((point, i) => ({ point, i }))
      .filter(({ i }) => inside[i] || i === beforeIndex || i === afterIndex)

    const bands = sex
      ? REFERENCE_PERCENTILES.map((percentile) => ({
          percentile,
          values: ticks.map((day) => weightAtPercentile(sex, day, percentile)),
        }))
      : []

    const referenceValues = bands.flatMap((band) => band.values.filter((v): v is number => v !== null))
    // La escala la deciden los pesajes que se ven, no los de fuera del tramo.
    const visible = points.filter((_, i) => inside[i])
    const scaled = visible.length > 0 || referenceValues.length > 0 ? visible : drawn.map((d) => d.point)
    const babyKg = scaled.map((point) => point.value / 1000)
    if (babyKg.length === 0 && referenceValues.length === 0) return null
    const minY = Math.min(...babyKg, ...referenceValues) * 0.94
    const maxY = Math.max(...babyKg, ...referenceValues) * 1.04

    const x = (day: number): number =>
      PAD.left + ((W - PAD.left - PAD.right) * (day - fromDay)) / (spanDays || 1)
    const y = (kg: number): number =>
      H - PAD.bottom - ((H - PAD.top - PAD.bottom) * (kg - minY)) / (maxY - minY || 1)

    const path = (values: Array<number | null>): string =>
      ticks
        .map((day, i) => {
          const value = values[i]
          return value === null || value === undefined ? null : `${x(day)},${y(value)}`
        })
        .filter((piece): piece is string => piece !== null)
        .map((piece, i) => `${i === 0 ? 'M' : 'L'}${piece}`)
        .join(' ')

    const area = (upper: Array<number | null>, lower: Array<number | null>): string => {
      const top = ticks
        .map((day, i) => (upper[i] == null ? null : `${x(day)},${y(upper[i] as number)}`))
        .filter((p): p is string => p !== null)
      const bottom = ticks
        .map((day, i) => (lower[i] == null ? null : `${x(day)},${y(lower[i] as number)}`))
        .filter((p): p is string => p !== null)
        .reverse()
      if (top.length === 0 || bottom.length === 0) return ''
      return `M${top.join(' L')} L${bottom.join(' L')} Z`
    }

    const babyPath = drawn
      .map(({ point, i }, n) => `${n === 0 ? 'M' : 'L'}${x(ages[i] as number)},${y(point.value / 1000)}`)
      .join(' ')

    const axis = axisTicks(birthDate, scale, fromDay, toDay)

    return { bands, path, area, babyPath, x, y, ages, inside, axis, minY, maxY }
  }, [points, birthDate, sex, window?.from, window?.to, scale])

  /**
   * En el móvil no hay ratón: el pesaje se toca y arriba se lee cuál es y en
   * qué percentil cayó ese día, que es el dato que la curva sola no cuenta.
   */
  const svgRef = useRef<SVGSVGElement>(null)
  const [active, setActive] = useState<number | null>(null)

  const nearest = (clientX: number): number | null => {
    const box = svgRef.current?.getBoundingClientRect()
    if (!box || box.width === 0 || !geometry) return null
    const target = ((clientX - box.left) / box.width) * W
    let best: number | null = null
    let bestGap = Infinity
    geometry.ages.forEach((age, index) => {
      if (!geometry.inside[index]) return
      const gap = Math.abs(geometry.x(age) - target)
      if (gap < bestGap) {
        bestGap = gap
        best = index
      }
    })
    return bestGap <= 26 ? best : null
  }

  const handleDown = (event: ReactPointerEvent<SVGSVGElement>): void => {
    const index = nearest(event.clientX)
    setActive((current) => (current === index ? null : index))
  }

  const handleMove = (event: ReactPointerEvent<SVGSVGElement>): void => {
    if (event.pointerType !== 'mouse') return
    setActive(nearest(event.clientX))
  }

  if (!geometry) {
    return (
      <p className="small faint">
        {points.length === 0 ? 'Sin pesos registrados.' : 'Sin pesajes en este periodo.'}
      </p>
    )
  }

  const at = (p: number) => geometry.bands.find((band) => band.percentile === p)?.values ?? []

  const activePoint = active === null || !geometry.inside[active] ? null : points[active]
  const activeAge = active === null ? null : (geometry.ages[active] as number)
  const activePercentile =
    activePoint && sex && activeAge !== null
      ? percentileOfWeight(sex, activeAge, activePoint.value)
      : null

  return (
    <figure className="chart" style={{ margin: 0 }}>
      <div className="chart-readout" aria-live="polite">
        {activePoint ? (
          <>
            <span className="strong">{birthLabel(activePoint.dayKey)}</span>
            <span className="mono">{grams(activePoint.value)}</span>
            {activePercentile !== null && (
              <span className="faint tiny">percentil {Math.round(activePercentile)}</span>
            )}
          </>
        ) : (
          <span className="faint tiny">Toca un pesaje para ver su percentil</span>
        )}
      </div>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label="Peso frente a la referencia de la OMS"
        style={{ touchAction: 'pan-y' }}
        onPointerDown={handleDown}
        onPointerMove={handleMove}
        onPointerLeave={(event) => {
          if (event.pointerType === 'mouse') setActive(null)
        }}
      >
        {geometry.bands.length > 0 && (
          <>
            <path d={geometry.area(at(97), at(3))} fill="var(--measure)" opacity="0.09" />
            <path d={geometry.area(at(85), at(15))} fill="var(--measure)" opacity="0.13" />
            <path
              d={geometry.path(at(50))}
              fill="none"
              stroke="var(--measure)"
              strokeWidth="1"
              strokeDasharray="4 3"
              opacity="0.8"
            />
            {[3, 97].map((p) => (
              <text
                key={p}
                x={W - PAD.right}
                y={(geometry.y((at(p).at(-1) as number) ?? 0) ?? 0) + (p === 97 ? -3 : 9)}
                textAnchor="end"
                fontSize="8.5"
                fill="var(--text-faint)"
              >
                P{p}
              </text>
            ))}
          </>
        )}

        <text x="0" y={geometry.y(geometry.maxY) + 8} fontSize="9" fill="var(--text-faint)">
          {number(geometry.maxY, 1)} kg
        </text>
        <text x="0" y={geometry.y(geometry.minY)} fontSize="9" fill="var(--text-faint)">
          {number(geometry.minY, 1)} kg
        </text>

        <defs>
          <clipPath id="growth-plot">
            <rect x={PAD.left} y={0} width={W - PAD.left - PAD.right} height={H - PAD.bottom} />
          </clipPath>
        </defs>

        {geometry.axis.map((tick) => (
          <g key={tick.day}>
            <line
              x1={geometry.x(tick.day)}
              y1={H - PAD.bottom}
              x2={geometry.x(tick.day)}
              y2={H - PAD.bottom + 3}
              stroke="var(--border)"
              strokeWidth="1"
            />
            <text
              x={geometry.x(tick.day)}
              y={H - PAD.bottom + 13}
              textAnchor="middle"
              fontSize="9"
              fill="var(--text-faint)"
            >
              {tick.label}
            </text>
          </g>
        ))}

        <path
          clipPath="url(#growth-plot)"
          d={geometry.babyPath}
          fill="none"
          stroke="var(--primary)"
          strokeWidth="2.5"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        {activePoint && activeAge !== null && (
          <line
            x1={geometry.x(activeAge)}
            y1={PAD.top}
            x2={geometry.x(activeAge)}
            y2={H - PAD.bottom}
            stroke="var(--primary)"
            strokeWidth="1"
            strokeDasharray="3 3"
            opacity="0.5"
          />
        )}
        {points.map((point, i) => geometry.inside[i] && (
          <circle
            key={point.at}
            cx={geometry.x(geometry.ages[i] as number)}
            cy={geometry.y(point.value / 1000)}
            r={active === i ? 5.5 : 3.5}
            fill={active === i ? 'var(--primary)' : 'var(--surface)'}
            stroke="var(--primary)"
            strokeWidth="2.5"
            opacity={active === null || active === i ? 1 : 0.45}
          >
            <title>{`${point.dayKey}: ${grams(point.value)}`}</title>
          </circle>
        ))}
      </svg>
    </figure>
  )
}

/**
 * Las marcas del eje, en días de vida. Desde el nacimiento, cada mes cumplido;
 * en un mes, cada semana; en una semana, cada día con su fecha.
 */
function axisTicks(
  birthDate: DayKey,
  scale: View,
  fromDay: number,
  toDay: number,
): Array<{ day: number; label: string }> {
  const ticks: Array<{ day: number; label: string }> = []
  if (scale === 'week') {
    for (let day = fromDay; day < toDay; day += 1) {
      ticks.push({ day, label: String(parseDayKey(addDays(birthDate, day)).day) })
    }
    return ticks
  }
  if (scale === 'month') {
    for (let day = Math.ceil(fromDay / 7) * 7; day <= toDay; day += 7) {
      ticks.push({ day, label: `S${day / 7 + 1}` })
    }
    return ticks
  }
  const months = toDay > 365 ? 3 : toDay > 180 ? 2 : 1
  for (let month = 0; ; month += months) {
    const day = diffDays(birthDate, addMonths(birthDate, month))
    if (day > toDay) break
    ticks.push({ day, label: month === 0 ? 'nac.' : `${month} m` })
  }
  return ticks
}

/** El percentil del último peso, para enseñarlo junto a la gráfica. */
export function currentPercentile(
  points: MeasurementPoint[],
  birthDate: DayKey,
  sex: Sex | null,
): number | null {
  const last = points.at(-1)
  if (!last || !sex) return null
  return percentileOfWeight(sex, ageInDays(birthDate, last.at), last.value)
}
