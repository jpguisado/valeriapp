import { useMemo } from 'react'
import {
  EVENT_LABELS,
  breastSplit,
  durationSeconds,
  firstSideOf,
  payloadOf,
  type BabyEvent,
  type EventType,
} from '@shared/events'
import { computeDailyStats } from '@shared/stats'
import { dayKeyOf, zoneFor, type TimezoneSetting } from '@shared/time'
import { celsius, clock, dayLabel, duration, grams, ml } from '@/lib/format'
import { resumeSession } from '@/lib/timers'
import { EVENT_ACCENTS } from './event-meta'
import { EventIcon, Play } from './icons'

interface Props {
  events: BabyEvent[]
  timezone: TimezoneSetting
  now: number
  onSelect: (event: BabyEvent) => void
  /** Only these types are shown; empty means everything. */
  filter?: EventType[]
  limitDays?: number
  /** What the right-hand side of each day header reports. */
  daySummary?: 'counts' | 'events'
  /** La última toma de pecho, la única que puede reanudarse. */
  resumableEventId?: string | null
  /** Hide the day headers entirely, for a single-day list. */
  hideDays?: boolean
}

/** Chronological log, grouped by whole days. */
export function Timeline({
  events,
  timezone,
  now,
  onSelect,
  filter = [],
  limitDays,
  daySummary = 'counts',
  hideDays = false,
  resumableEventId = null,
}: Props) {
  const groups = useMemo(() => {
    const filtered = filter.length ? events.filter((event) => filter.includes(event.type)) : events
    const byDay = new Map<string, BabyEvent[]>()
    for (const event of filtered) {
      const key = dayKeyOf(event.occurredAt, zoneFor(event.tz, timezone))
      const list = byDay.get(key)
      if (list) list.push(event)
      else byDay.set(key, [event])
    }
    const keys = [...byDay.keys()].sort((a, b) => (a < b ? 1 : -1))
    return (limitDays ? keys.slice(0, limitDays) : keys).map((key) => ({
      dayKey: key,
      events: byDay.get(key) ?? [],
    }))
  }, [events, filter, timezone, limitDays])

  if (groups.length === 0) {
    return <p className="faint center small" style={{ padding: '24px 0' }}>Todavía no hay nada registrado.</p>
  }

  return (
    <div className="col" style={{ gap: 2 }}>
      {groups.map((group) => (
        <section key={group.dayKey} className="col" style={{ gap: 8 }}>
          {!hideDays && (
            <header className="day-header">
              <span>{dayLabel(group.dayKey, timezone.fixed, now)}</span>
              <span className="summary">
                {daySummary === 'events'
                  ? `${group.events.length} ${group.events.length === 1 ? 'evento' : 'eventos'}`
                  : dayCounts(group.events, group.dayKey, timezone, now)}
              </span>
            </header>
          )}
          <div className="timeline">
            {group.events.map((event) => (
              <EventRow
                key={event.id}
                event={event}
                timezone={timezone}
                now={now}
                resumable={event.id === resumableEventId}
                onSelect={onSelect}
              />
            ))}
          </div>
        </section>
      ))}
    </div>
  )
}

function dayCounts(
  events: BabyEvent[],
  dayKey: string,
  timezone: TimezoneSetting,
  now: number,
): string {
  const [stats] = computeDailyStats(events, dayKey, dayKey, { timezone }, now)
  if (!stats) return ''
  const feeds = `${stats.feeds} ${stats.feeds === 1 ? 'toma' : 'tomas'}`
  const diapers = `${stats.diapers.total} ${stats.diapers.total === 1 ? 'pañal' : 'pañales'}`
  return `${feeds} · ${diapers}`
}

function EventRow({
  event,
  timezone,
  now,
  resumable,
  onSelect,
}: {
  event: BabyEvent
  timezone: TimezoneSetting
  now: number
  resumable: boolean
  onSelect: (event: BabyEvent) => void
}) {
  const tz = zoneFor(event.tz, timezone)
  const seconds = event.running ? (now - Date.parse(event.occurredAt)) / 1000 : durationSeconds(event)

  return (
    <button
      className="event-row"
      style={{ ['--accent' as string]: EVENT_ACCENTS[event.type] }}
      onClick={() => onSelect(event)}
    >
      <span className="bullet">
        <EventIcon type={event.type} size={20} />
      </span>
      <span className="event-card">
        <span className="grow col" style={{ gap: 2 }}>
          <span className="row between" style={{ gap: 10 }}>
            <span className="title">{EVENT_LABELS[event.type]}</span>
            <span className="time">{clock(event.occurredAt, tz)}</span>
          </span>
          <span className="row between" style={{ gap: 10 }}>
            <span className="small dim">{describe(event, seconds, now)}</span>
            {event.running && <span className="badge live"><span className="pulse" />en curso</span>}
            {event.estimated && <span className="badge warn">estimado</span>}
          </span>
          {event.note && <span className="tiny faint">“{event.note}”</span>}
          {/* Parar sin querer es el error más fácil de cometer; deshacerlo
              debería costar un toque, y solo la última toma puede reabrirse. */}
          {resumable && (
            <span
              className="resume"
              role="button"
              tabIndex={0}
              onClick={(e) => {
                e.stopPropagation()
                void resumeSession(event)
              }}
              onKeyDown={(e) => {
                if (e.key !== 'Enter' && e.key !== ' ') return
                e.preventDefault()
                e.stopPropagation()
                void resumeSession(event)
              }}
            >
              <Play size={13} /> Reanudar
            </span>
          )}
        </span>
      </span>
    </button>
  )
}

function describe(event: BabyEvent, seconds: number | null, now: number): string {
  const parts: string[] = []
  switch (event.type) {
    case 'breast': {
      // A feed reports time at the breast, never the wall clock: it may have
      // been paused halfway through to wake the baby up.
      const split = breastSplit(event, now)
      const fed = split.leftSeconds + split.rightSeconds
      const paused = (seconds ?? 0) - fed > 60 ? ' · con pausas' : ''

      const payload = payloadOf(event, 'breast')
      const supplement = payload?.supplementMl
        ? ` · +${ml(payload.supplementMl)}${
            payload.supplementKind === 'formula'
              ? ' fórmula'
              : payload.supplementKind === 'breastmilk'
                ? ' materna'
                : ''
          }`
        : ''

      if (split.leftSeconds > 0 && split.rightSeconds > 0) {
        const first = firstSideOf(event)
        const left = `Izq ${duration(split.leftSeconds)}`
        const right = `Der ${duration(split.rightSeconds)}`
        return `${first === 'right' ? `${right} · ${left}` : `${left} · ${right}`}${paused}${supplement}`
      }
      const side = split.rightSeconds > 0 ? 'Derecho' : 'Izquierdo'
      return `${side} · ${duration(fed)}${paused}${supplement}`
    }
    case 'bottle': {
      const payload = payloadOf(event, 'bottle')
      if (payload) {
        parts.push(ml(payload.ml))
        parts.push(
          payload.kind === 'breastmilk' ? 'leche materna' : payload.kind === 'formula' ? 'fórmula' : 'mixta',
        )
      }
      break
    }
    case 'pump': {
      const payload = payloadOf(event, 'pump')
      if (payload) {
        parts.push(ml(payload.ml))
        parts.push(payload.side === 'left' ? 'izquierdo' : payload.side === 'right' ? 'derecho' : 'ambos')
      }
      break
    }
    case 'diaper': {
      const payload = payloadOf(event, 'diaper')
      if (payload) {
        parts.push({ pee: 'Pis', poo: 'Caca', mixed: 'Pis y caca', dry: 'Seco' }[payload.kind])
        if (payload.leak) parts.push('escape')
      }
      break
    }
    case 'temperature': {
      const payload = payloadOf(event, 'temperature')
      if (payload) parts.push(celsius(payload.celsius))
      break
    }
    case 'weight': {
      const payload = payloadOf(event, 'weight')
      if (payload) parts.push(grams(payload.grams))
      break
    }
    case 'height':
    case 'head': {
      const payload = payloadOf(event, event.type === 'height' ? 'height' : 'head')
      if (payload) parts.push(`${payload.cm.toFixed(1).replace('.', ',')} cm`)
      break
    }
    case 'medication': {
      const payload = payloadOf(event, 'medication')
      if (payload) parts.push([payload.name, payload.dose].filter(Boolean).join(' · '))
      break
    }
    case 'note': {
      if (event.note) return ''
      break
    }
    default:
      break
  }
  if (seconds !== null && seconds > 0 && event.type !== 'note') parts.push(duration(seconds))
  return parts.join(' · ')
}
