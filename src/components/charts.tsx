import { useMemo, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import { ArrowDownRight, ArrowUpRight, Minus } from 'lucide-react'
import type { DailyStats, MeasurementPoint } from '@shared/stats'
import { dayKeyOf, parseDayKey } from '@shared/time'
import { dayLabel, duration } from '@/lib/format'

/**
 * Hand-drawn SVG charts. A charting library would weigh more than the whole
 * app and still not draw the sleep-band view, which is the one that matters.
 *
 * The language: no axes, no gridlines. A rounded bar, its value above it and
 * the day below. Empty days keep a thin stub so the week still reads as seven.
 */

interface BarProps {
  days: DailyStats[]
  pick: (day: DailyStats) => number
  color: string
  format: (value: number) => string
  tz: string
  now: number
  label: string
  /** El día en curso: su barra va punteada porque aún no ha terminado. */
  partialDay?: string | null
  /** Segunda serie apilada encima de la primera. */
  stack?: { pick: (day: DailyStats) => number; color: string; label: string }
  /** Rótulo de la serie de abajo, cuando hay apilado. */
  baseLabel?: string
}

export function BarChart({
  days,
  pick,
  color,
  format,
  tz,
  now,
  label,
  partialDay,
  stack,
  baseLabel,
}: BarProps) {
  const base = days.map(pick)
  const extra = days.map((day) => (stack ? stack.pick(day) : 0))
  const values = base.map((value, index) => value + (extra[index] ?? 0))
  const max = Math.max(...values, 0)
  const total = values.reduce((sum, value) => sum + value, 0)
  const average = values.length ? total / values.length : 0
  const today = dayKeyOf(now, tz)

  const W = 320
  const H = 154
  const TOP = 26
  const BASE = H - 24
  const slot = W / Math.max(1, days.length)
  const barWidth = Math.max(3, Math.min(26, slot * 0.66))
  /** Los días sin nada dejan una marca mínima: el día existió. */
  const FLOOR = 2

  const scale = (value: number): number =>
    max > 0 ? Math.max(value > 0 ? 3 : FLOOR, ((BASE - TOP) * value) / max) : FLOOR
  const showValues = days.length <= 10
  const averageY = BASE - scale(average)

  /**
   * En el móvil no hay ratón que pueda posarse sobre una barra, y con treinta
   * días las cifras no caben encima. Así que la barra se toca y el detalle se
   * lee arriba, donde el dedo no tapa nada.
   */
  const svgRef = useRef<SVGSVGElement>(null)
  const [active, setActive] = useState<number | null>(null)

  const indexAt = (clientX: number): number | null => {
    const box = svgRef.current?.getBoundingClientRect()
    if (!box || box.width === 0) return null
    const index = Math.floor((((clientX - box.left) / box.width) * W) / slot)
    return index >= 0 && index < days.length ? index : null
  }

  const handleDown = (event: ReactPointerEvent<SVGSVGElement>): void => {
    const index = indexAt(event.clientX)
    setActive((current) => (current === index ? null : index))
  }

  const handleMove = (event: ReactPointerEvent<SVGSVGElement>): void => {
    if (event.pointerType !== 'mouse') return
    setActive(indexAt(event.clientX))
  }

  const activeDay = active === null ? null : days[active]

  return (
    <figure className="chart" style={{ margin: 0 }}>
      <div className="chart-readout" aria-live="polite">
        {activeDay ? (
          <>
            <span className="strong">{dayLabel(activeDay.dayKey, tz, now)}</span>
            <span className="mono">{format(values[active as number] ?? 0)}</span>
            {stack && (extra[active as number] ?? 0) > 0 && (
              <span className="mono tiny">
                <span style={{ color }}>{format(base[active as number] ?? 0)}</span>
                <span className="faint"> + </span>
                <span style={{ color: stack.color }}>{format(extra[active as number] ?? 0)}</span>
              </span>
            )}
          </>
        ) : (
          <span className="faint tiny">Toca una barra para ver el día</span>
        )}
      </div>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={label}
        style={{ touchAction: 'pan-y' }}
        onPointerDown={handleDown}
        onPointerMove={handleMove}
        onPointerLeave={(event) => {
          if (event.pointerType === 'mouse') setActive(null)
        }}
      >
        {/* La media, para leer cada día contra la costumbre y no contra el vacío. */}
        {average > 0 && days.length > 2 && (
          <>
            <line
              x1="0"
              y1={averageY}
              x2={W}
              y2={averageY}
              stroke="var(--border)"
              strokeWidth="1"
              strokeDasharray="3 3"
            />
            <text
              x={W}
              y={averageY - 5}
              textAnchor="end"
              fontSize="9.5"
              fill="var(--text-faint)"
            >
              media {format(average)}
            </text>
          </>
        )}

        {days.map((day, index) => {
          const value = values[index] ?? 0
          const supplement = extra[index] ?? 0
          const isToday = day.dayKey === today
          const partial = day.dayKey === partialDay
          const height = scale(value)
          const x = index * slot + (slot - barWidth) / 2
          const y = BASE - height
          /* El apilado reparte la altura ya escalada: así la suma cuadra. */
          const extraHeight = value > 0 && supplement > 0 ? (height * supplement) / value : 0
          const baseHeight = height - extraHeight

          const isActive = active === index
          const resting = partial ? 0.28 : value === 0 ? 0.22 : isToday ? 0.95 : 0.5
          const opacity = isActive ? 1 : active !== null ? resting * 0.4 : resting

          return (
            <g key={day.dayKey}>
              <title>
                {`${dayLabel(day.dayKey, tz, now)}: ${format(value)}${partial ? ' · el día sigue' : ''}`}
              </title>
              {baseHeight > 0 && (
                <rect
                  x={x}
                  y={BASE - baseHeight}
                  width={barWidth}
                  height={baseHeight}
                  fill={color}
                  fillOpacity={opacity}
                  stroke={partial ? color : undefined}
                  strokeWidth={partial ? 1.2 : undefined}
                  strokeDasharray={partial ? '3 2' : undefined}
                />
              )}
              {stack && extraHeight > 0 && (
                <rect
                  x={x}
                  y={y}
                  width={barWidth}
                  height={extraHeight}
                  fill={stack.color}
                  fillOpacity={isActive ? 1 : active !== null ? 0.36 : 0.9}
                  stroke={partial ? stack.color : undefined}
                  strokeWidth={partial ? 1.2 : undefined}
                  strokeDasharray={partial ? '3 2' : undefined}
                />
              )}
              {(isActive || (showValues && value > 0 && active === null)) && (
                <text
                  x={x + barWidth / 2}
                  y={y - 7}
                  textAnchor="middle"
                  fontSize="11"
                  fontWeight={isActive || isToday ? 600 : 500}
                  fill={isActive ? 'var(--text)' : isToday ? 'var(--text-dim)' : 'var(--text-faint)'}
                >
                  {format(value)}
                </text>
              )}
              <text
                x={x + barWidth / 2}
                y={BASE + 15}
                textAnchor="middle"
                fontSize="10"
                fontWeight={isActive || isToday ? 700 : 400}
                fill={isActive ? 'var(--text)' : isToday ? 'var(--text)' : 'var(--text-faint)'}
              >
                {tickLabel(day.dayKey, days.length, index)}
              </text>
            </g>
          )
        })}

        {/* El suelo, para que las barras se apoyen en algo. */}
        <line x1="0" y1={BASE} x2={W} y2={BASE} stroke="var(--border-soft)" strokeWidth="1" />
      </svg>
      {stack && (
        <div className="chart-legend">
          <span style={{ ['--swatch' as string]: color }}>{baseLabel ?? 'Base'}</span>
          <span style={{ ['--swatch' as string]: stack.color }}>{stack.label}</span>
        </div>
      )}
    </figure>
  )
}

/**
 * El número del día. En una ventana móvil las iniciales rotarían, y el número
 * dice sin ambigüedad de qué día se habla; con treinta barras se espacian.
 */
function tickLabel(dayKey: string, total: number, index: number): string {
  const { day } = parseDayKey(dayKey)
  if (total <= 10) return String(day)
  return day === 1 || day % 5 === 0 || index === total - 1 ? String(day) : ''
}

/**
 * One row per day, 24 columns wide, sleep drawn as bands. This is the chart
 * that shows, at a glance, whether the nights are consolidating.
 */
export function SleepBandChart({ days, tz, now }: { days: DailyStats[]; tz: string; now: number }) {
  const rowHeight = 18
  const labelWidth = 40
  const width = 320
  const barHeight = rowHeight - 5
  const height = days.length * rowHeight + 20

  /**
   * Las barras son rectangulares a propósito. Redondearlas hasta la cápsula
   * convertía un sueño corto en un óvalo y le comía los extremos a los
   * largos, que es justo donde se lee a qué hora empezó y acabó.
   */
  const svgRef = useRef<SVGSVGElement>(null)
  const [active, setActive] = useState<{ row: number; band: number } | null>(null)

  const bandAt = (clientX: number, clientY: number): { row: number; band: number } | null => {
    const box = svgRef.current?.getBoundingClientRect()
    if (!box || box.width === 0) return null
    const x = ((clientX - box.left) / box.width) * width
    const y = ((clientY - box.top) / box.height) * height
    const row = Math.floor((y - 16) / rowHeight)
    const day = days[row]
    if (!day || row < 0) return null
    const minute = ((x - labelWidth) / (width - labelWidth)) * 1440
    const band = day.sleepBands.findIndex(
      (b) => minute >= b.startMinute && minute <= b.endMinute,
    )
    return band === -1 ? null : { row, band }
  }

  const activeDay = active ? days[active.row] : undefined
  const activeBand = activeDay?.sleepBands[active?.band ?? -1]

  return (
    <figure className="chart" style={{ margin: 0 }}>
      <div className="chart-readout" aria-live="polite">
        {activeDay && activeBand ? (
          <>
            <span className="strong">{dayLabel(activeDay.dayKey, tz, now)}</span>
            <span className="mono">
              {hhmm(activeBand.startMinute)} – {hhmm(activeBand.endMinute)}
            </span>
            <span className="faint tiny">
              {duration((activeBand.endMinute - activeBand.startMinute) * 60)}
            </span>
          </>
        ) : (
          <span className="faint tiny">Toca un tramo para ver a qué hora fue</span>
        )}
      </div>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label="Sueño por franjas horarias"
        style={{ touchAction: 'pan-y' }}
        onPointerDown={(event) => {
          const hit = bandAt(event.clientX, event.clientY)
          setActive((current) =>
            current && hit && current.row === hit.row && current.band === hit.band ? null : hit,
          )
        }}
        onPointerMove={(event) => {
          if (event.pointerType !== 'mouse') return
          setActive(bandAt(event.clientX, event.clientY))
        }}
        onPointerLeave={(event) => {
          if (event.pointerType === 'mouse') setActive(null)
        }}
      >
        {[0, 6, 12, 18, 24].map((hour) => (
          <text
            key={hour}
            x={labelWidth + ((width - labelWidth) * hour) / 24}
            y="9"
            fontSize="9"
            textAnchor="middle"
            fill="var(--text-faint)"
          >
            {hour}h
          </text>
        ))}
        {days.map((day, index) => {
          const y = 16 + index * rowHeight
          return (
            <g key={day.dayKey}>
              <text x="0" y={y + 11} fontSize="10" fill="var(--text-faint)">
                {dayLabel(day.dayKey, tz, now).slice(0, 6)}
              </text>
              <rect
                x={labelWidth}
                y={y}
                width={width - labelWidth}
                height={barHeight}
                fill="var(--surface-2)"
              />
              {day.sleepBands.map((band, bandIndex) => {
                const x = labelWidth + ((width - labelWidth) * band.startMinute) / 1440
                const w = Math.max(
                  1.5,
                  ((width - labelWidth) * (band.endMinute - band.startMinute)) / 1440,
                )
                const esActiva = active?.row === index && active?.band === bandIndex
                const base = band.estimated ? 0.45 : 0.9
                return (
                  <rect
                    key={bandIndex}
                    x={x}
                    y={y}
                    width={w}
                    height={barHeight}
                    fill="var(--sleep)"
                    opacity={esActiva ? 1 : active ? base * 0.4 : base}
                  />
                )
              })}
            </g>
          )
        })}
      </svg>
    </figure>
  )
}

/** Minutos desde medianoche como hora de reloj: 325 → "05:25". */
function hhmm(minute: number): string {
  const m = Math.round(minute)
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
}

export function LineChart({
  points,
  color,
  format,
  label,
}: {
  points: MeasurementPoint[]
  color: string
  format: (value: number) => string
  label: string
}) {
  const geometry = useMemo(() => {
    if (points.length === 0) return null
    const width = 320
    const height = 140
    const padding = { top: 16, right: 10, bottom: 16, left: 44 }
    const xs = points.map((point) => point.at)
    const ys = points.map((point) => point.value)
    const minX = Math.min(...xs)
    const maxX = Math.max(...xs)
    const minY = Math.min(...ys)
    const maxY = Math.max(...ys)
    const spanX = maxX - minX || 1
    const spanY = maxY - minY || 1

    const toX = (value: number): number =>
      padding.left + ((width - padding.left - padding.right) * (value - minX)) / spanX
    const toY = (value: number): number =>
      height - padding.bottom - ((height - padding.top - padding.bottom) * (value - minY)) / spanY

    const path = points
      .map(
        (point, index) =>
          `${index === 0 ? 'M' : 'L'}${toX(point.at).toFixed(1)},${toY(point.value).toFixed(1)}`,
      )
      .join(' ')

    return { width, height, path, toX, toY, minY, maxY }
  }, [points])

  if (!geometry) return <p className="small faint">Sin medidas registradas.</p>

  return (
    <figure className="chart" style={{ margin: 0 }}>
      <svg viewBox={`0 0 ${geometry.width} ${geometry.height}`} role="img" aria-label={label}>
        <text x="0" y="18" fontSize="10" fill="var(--text-faint)">
          {format(geometry.maxY)}
        </text>
        <text x="0" y={geometry.height - 12} fontSize="10" fill="var(--text-faint)">
          {format(geometry.minY)}
        </text>
        <path
          d={geometry.path}
          fill="none"
          stroke={color}
          strokeWidth="2.5"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        {points.map((point) => (
          <circle
            key={point.at}
            cx={geometry.toX(point.at)}
            cy={geometry.toY(point.value)}
            r="3.5"
            fill="var(--surface)"
            stroke={color}
            strokeWidth="2.5"
          >
            <title>{`${point.dayKey}: ${format(point.value)}`}</title>
          </circle>
        ))}
      </svg>
    </figure>
  )
}

export function ComparisonRow({
  label,
  value,
  previous,
  format,
  invert = false,
}: {
  label: string
  value: number
  previous: number
  format: (value: number) => string
  /** When true, a decrease is the good news (e.g. night wakings). */
  invert?: boolean
}) {
  const delta = previous === 0 ? null : (value - previous) / previous
  const flat = delta === null || Math.abs(delta) <= 0.02
  const Arrow = flat ? Minus : (delta as number) > 0 ? ArrowUpRight : ArrowDownRight
  const good = delta === null ? false : invert ? delta < 0 : delta > 0
  const className = flat ? 'faint' : good ? 'trend-up' : 'trend-down'

  return (
    <div className="row between">
      <span className="small dim">{label}</span>
      <span className="row" style={{ gap: 8 }}>
        <span className="mono strong">{format(value)}</span>
        <span className={`tiny row ${className}`} style={{ gap: 2 }}>
          <Arrow size={13} strokeWidth={2.4} aria-hidden="true" />
          {delta === null ? '—' : `${Math.abs(delta * 100).toFixed(0)}%`}
        </span>
      </span>
    </div>
  )
}

/** Card wrapper for a chart: title on the left, the period's headline right. */
export function ChartCard({
  title,
  meta,
  children,
}: {
  title: string
  meta?: string
  children: React.ReactNode
}) {
  return (
    <section className="card col">
      <div className="chart-card-head">
        <h2>{title}</h2>
        {meta && <span className="meta">{meta}</span>}
      </div>
      {children}
    </section>
  )
}
