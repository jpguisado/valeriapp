import { useMemo } from 'react'
import { HAS_DURATION_TYPES, payloadOf, type BabyEvent } from '@shared/events'
import {
  dayFraction,
  dayKeyOf,
  endOfDay,
  parseDayKey,
  startOfDay,
  toInstant,
  zonedTimeToInstant,
  type TimezoneSetting,
} from '@shared/time'
import { EVENT_ACCENTS } from './event-meta'
import { EventIcon } from './icons'

interface Props {
  events: BabyEvent[]
  timezone: TimezoneSetting
  now: number
  /** Which day to draw; defaults to today in the household zone. */
  dayKey?: string
}

const SIZE = 300
const C = SIZE / 2
const R1 = 130
const R0 = 106
const RM = (R0 + R1) / 2
const RCAP = (R1 - R0) / 2
const ICON = 13
const CIRCUMFERENCE = 2 * Math.PI * RM
/** Minimum arc between two icon centres, in pixels. */
const MIN_ICON_GAP = 18
/** The night, as wall-clock hours. */
const NIGHT_FROM = 20
const NIGHT_TO = 8

interface Slice {
  event: BabyEvent
  from: number
  to: number
  mid: number
  instant: boolean
}

/**
 * The day as a ring: one lap is 24 hours, midnight at the top, clockwise.
 *
 * Positions are fractions of the *actual* day, not of 1440 minutes: the days
 * the clocks change last 23 or 25 hours, and dividing by a fixed 1440 would
 * shift every event by almost an hour.
 */
export function DayRing({ events, timezone, now, dayKey }: Props) {
  const tz = timezone.fixed
  const day = dayKey ?? dayKeyOf(now, tz)

  const { slices, nightFrom, nightTo, nowAt, hours } = useMemo(() => {
    const dayStart = startOfDay(day, tz)
    const dayEnd = endOfDay(day, tz)
    const at = (instant: number): number => dayFraction(instant, day, tz)
    const { year, month, day: dom } = parseDayKey(day)
    const wall = (hour: number): number => at(zonedTimeToInstant(tz, year, month, dom, hour, 0))

    const drawn: Slice[] = []
    for (const event of events) {
      if (event.deletedAt) continue
      const start = toInstant(event.occurredAt)
      const timed = HAS_DURATION_TYPES.has(event.type) && (event.endedAt || event.running)
      const end = timed ? (event.running ? now : toInstant(event.endedAt as string)) : start
      // Clip to the day, so a nap across midnight shows on both days.
      if (end < dayStart || start > dayEnd) continue
      const from = at(Math.max(start, dayStart))
      const to = at(Math.min(end, dayEnd))
      drawn.push({ event, from, to, mid: (from + to) / 2, instant: !timed })
    }

    // Nudge icon centres apart only where they would hide each other.
    const gap = MIN_ICON_GAP / CIRCUMFERENCE
    const byMid = [...drawn].sort((a, b) => a.mid - b.mid)
    for (let i = 1; i < byMid.length; i++) {
      const previous = byMid[i - 1] as Slice
      const current = byMid[i] as Slice
      const distance = current.mid - previous.mid
      if (distance >= gap) continue
      const push = (gap - distance) / 2
      previous.mid -= push
      current.mid += push
    }

    // Longest first, instants last: the small stays on top of the big.
    const painted = [...drawn].sort((a, b) =>
      a.instant !== b.instant ? (a.instant ? 1 : -1) : b.to - b.from - (a.to - a.from),
    )

    return {
      slices: painted,
      nightFrom: wall(NIGHT_FROM),
      nightTo: wall(NIGHT_TO),
      nowAt: at(Math.min(Math.max(now, dayStart), dayEnd)),
      hours: [0, 3, 6, 9, 12, 15, 18, 21].map((hour) => ({ hour, at: wall(hour) })),
    }
  }, [events, timezone, now, day, tz])

  return (
    <svg className="day-ring" viewBox="-6 -6 312 312" role="img" aria-label={summarise(slices)}>
      {/* la noche, en dos tramos porque cruza la medianoche */}
      <path d={sector(R0 - 8, R1 + 8, nightFrom, 1)} fill="var(--sleep)" opacity="0.07" />
      <path d={sector(R0 - 8, R1 + 8, 0, nightTo)} fill="var(--sleep)" opacity="0.07" />

      <path d={sector(R0, R1, 0, 0.9999)} fill="var(--surface-2)" />
      {/* lo que ya ha pasado del día pesa más que lo que queda */}
      {nowAt > 0 && (
        <path
          d={sector(R0, R1, 0, Math.min(nowAt, 0.9999))}
          fill="color-mix(in srgb, var(--border) 42%, var(--surface-2))"
          stroke="var(--border)"
          strokeWidth="1"
        />
      )}

      {slices.map((slice) => (
        <path
          key={slice.event.id}
          d={capsule(R0, R1, slice.from, slice.to)}
          fill={EVENT_ACCENTS[slice.event.type]}
          fillOpacity={0.18}
          stroke={EVENT_ACCENTS[slice.event.type]}
          strokeWidth="1.5"
          strokeDasharray={slice.event.running ? '4 3' : undefined}
        />
      ))}

      <line
        x1={point(R0 - 5, nowAt)[0]}
        y1={point(R0 - 5, nowAt)[1]}
        x2={point(R1 + 5, nowAt)[0]}
        y2={point(R1 + 5, nowAt)[1]}
        stroke="var(--primary)"
        strokeWidth="1.6"
        strokeLinecap="round"
      />

      {slices.map((slice) => {
        const [x, y] = point(RM, slice.mid)
        const supplement =
          slice.event.type === 'breast'
            ? (payloadOf(slice.event, 'breast')?.supplementMl ?? 0)
            : 0
        return (
          <g key={`${slice.event.id}-icon`} style={{ color: EVENT_ACCENTS[slice.event.type] }}>
            <circle cx={x} cy={y} r={ICON / 2 + 2.5} fill="var(--bg)" />
            <g transform={`translate(${x - ICON / 2} ${y - ICON / 2})`}>
              <EventIcon type={slice.event.type} size={ICON} strokeWidth={2.2} />
            </g>
            {/* Lactancia mixta: se distingue sin abrir la toma. */}
            {supplement > 0 && (
              <circle
                cx={x + ICON / 2 + 1}
                cy={y - ICON / 2 - 1}
                r="2.6"
                fill={EVENT_ACCENTS.bottle}
                stroke="var(--bg)"
                strokeWidth="1"
              />
            )}
          </g>
        )
      })}

      {hours.map(({ hour, at }) => {
        const [x, y] = point(R1 + 16, at)
        const major = hour % 6 === 0
        return (
          <text
            key={hour}
            x={x}
            y={y + 3.5}
            textAnchor="middle"
            fontSize={major ? 10.5 : 9}
            fontWeight={major ? 600 : 400}
            fill={major ? 'var(--text-dim)' : 'var(--text-faint)'}
          >
            {String(hour).padStart(2, '0')}
          </text>
        )
      })}
    </svg>
  )
}

function point(radius: number, fraction: number): [number, number] {
  const angle = fraction * Math.PI * 2 - Math.PI / 2
  return [C + radius * Math.cos(angle), C + radius * Math.sin(angle)]
}

/** Plain annulus sector, for the background tracks. */
function sector(r0: number, r1: number, from: number, to: number): string {
  if (to <= from) return ''
  const large = to - from > 0.5 ? 1 : 0
  const [ax, ay] = point(r1, from)
  const [bx, by] = point(r1, to)
  const [cx, cy] = point(r0, to)
  const [dx, dy] = point(r0, from)
  return `M${ax} ${ay} A${r1} ${r1} 0 ${large} 1 ${bx} ${by} L${cx} ${cy} A${r0} ${r0} 0 ${large} 0 ${dx} ${dy} Z`
}

/**
 * The same sector with semicircular ends. The cap guarantees a footprint equal
 * to the ring thickness, so short events keep their real length instead of
 * being inflated to an artificial minimum; a zero-length one is a circle.
 */
function capsule(r0: number, r1: number, from: number, to: number): string {
  const [ex, ey] = point((r0 + r1) / 2, from)
  if (to - from < 0.0004) {
    return `M${ex - RCAP} ${ey} a${RCAP} ${RCAP} 0 1 0 ${RCAP * 2} 0 a${RCAP} ${RCAP} 0 1 0 ${-RCAP * 2} 0 Z`
  }
  const large = to - from > 0.5 ? 1 : 0
  const [ax, ay] = point(r1, from)
  const [bx, by] = point(r1, to)
  const [cx, cy] = point(r0, to)
  const [dx, dy] = point(r0, from)
  return (
    `M${ax} ${ay} A${r1} ${r1} 0 ${large} 1 ${bx} ${by} ` +
    `A${RCAP} ${RCAP} 0 0 1 ${cx} ${cy} ` +
    `A${r0} ${r0} 0 ${large} 0 ${dx} ${dy} ` +
    `A${RCAP} ${RCAP} 0 0 1 ${ax} ${ay} Z`
  )
}

/** Text for screen readers; the drawing itself says nothing to them. */
function summarise(slices: Slice[]): string {
  if (slices.length === 0) return 'Aún no hay nada registrado hoy'
  const count = slices.length
  return `El día en un anillo de 24 horas, con ${count} ${count === 1 ? 'evento' : 'eventos'}`
}
