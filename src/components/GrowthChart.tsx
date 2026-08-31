import { useMemo, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import type { MeasurementPoint } from '@shared/stats'
import { REFERENCE_PERCENTILES, percentileOfWeight, weightAtPercentile, type Sex } from '@shared/growth'
import { ageInDays, type DayKey } from '@shared/time'
import { birthLabel, grams, number } from '@/lib/format'

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
}: {
  points: MeasurementPoint[]
  birthDate: DayKey
  sex: Sex | null
}) {
  const W = 320
  const H = 190
  const PAD = { top: 12, right: 10, bottom: 22, left: 42 }

  const geometry = useMemo(() => {
    if (points.length === 0) return null

    const ages = points.map((point) => ageInDays(birthDate, point.at))
    const maxAge = Math.max(...ages, 14)
    // Un poco de futuro a la derecha: la banda se lee mejor con hacia dónde va.
    const spanDays = Math.max(28, Math.ceil(maxAge * 1.15))
    const ticks = Array.from({ length: 40 }, (_, i) => (spanDays * i) / 39)

    const bands = sex
      ? REFERENCE_PERCENTILES.map((percentile) => ({
          percentile,
          values: ticks.map((day) => weightAtPercentile(sex, day, percentile)),
        }))
      : []

    const referenceValues = bands.flatMap((band) => band.values.filter((v): v is number => v !== null))
    const babyKg = points.map((point) => point.value / 1000)
    const minY = Math.min(...babyKg, ...referenceValues) * 0.94
    const maxY = Math.max(...babyKg, ...referenceValues) * 1.04

    const x = (day: number): number =>
      PAD.left + ((W - PAD.left - PAD.right) * day) / (spanDays || 1)
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

    const babyPath = points
      .map((point, i) => `${i === 0 ? 'M' : 'L'}${x(ages[i] as number)},${y(point.value / 1000)}`)
      .join(' ')

    return { bands, path, area, babyPath, x, y, ages, spanDays, minY, maxY }
  }, [points, birthDate, sex])

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

  if (!geometry) return <p className="small faint">Sin pesos registrados.</p>

  const at = (p: number) => geometry.bands.find((band) => band.percentile === p)?.values ?? []

  const activePoint = active === null ? null : points[active]
  const activeAge = active === null ? null : (geometry.ages[active] as number)
  const activePercentile =
    activePoint && sex && activeAge !== null
      ? percentileOfWeight(sex, activeAge, activePoint.value / 1000)
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

        <path
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
        {points.map((point, i) => (
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
