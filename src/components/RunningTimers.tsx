import { useMemo, useState } from 'react'
import {
  EVENT_LABELS,
  breastFeedingSeconds,
  breastSplit,
  isBreastPaused,
  payloadOf,
  type BabyEvent,
} from '@shared/events'
import { computeDailyStats, type DailyStats } from '@shared/stats'
import { dayKeyOf, type TimezoneSetting } from '@shared/time'
import { clock, duration, hours, liveDuration, ml } from '@/lib/format'
import { useNow } from '@/lib/hooks'
import { pauseFeed, resumeFeed, stopTimer, switchSide } from '@/lib/timers'
import { EVENT_ACCENTS } from './event-meta'
import { CircleStop, EventIcon, Pause, Pencil, Play, Repeat } from './icons'
import { StartTimeSheet } from './StartTimeSheet'

interface Props {
  events: BabyEvent[]
  timezone: TimezoneSetting
  now: number
}

/**
 * Live controls for whatever is running right now. Shown on every device of
 * the household, so either parent can switch sides, pause or stop.
 */
export function RunningTimers({ events, timezone, now }: Props) {
  const running = events.filter((event) => event.running)

  // Only tick every second while something short is running; a three-hour nap
  // shows minutes, and redrawing it 3600 times would buy nothing.
  const needsSeconds = running.some(
    (event) => now - Date.parse(event.occurredAt) < 3_600_000,
  )
  const tick = useNow(needsSeconds ? 1000 : 30_000)

  const today = dayKeyOf(tick, timezone.fixed)
  const [stats] = useMemo(
    () => computeDailyStats(events, today, today, { timezone }, tick),
    // The running totals only need refreshing about once a minute.
    [events, today, timezone, Math.floor(tick / 30_000)],
  )

  if (running.length === 0) return null

  return (
    <div className="col">
      {running.map((event) => (
        <RunningCard
          key={event.id}
          event={event}
          events={events}
          stats={stats}
          timezone={timezone}
          now={tick}
        />
      ))}
    </div>
  )
}

function RunningCard({
  event,
  events,
  stats,
  timezone,
  now,
}: {
  event: BabyEvent
  events: BabyEvent[]
  stats: DailyStats | undefined
  timezone: TimezoneSetting
  now: number
}) {
  const [editingStart, setEditingStart] = useState(false)
  const tz = timezone.fixed
  const accent = EVENT_ACCENTS[event.type]
  const isBreast = event.type === 'breast'
  const paused = isBreast && isBreastPaused(event)
  const split = isBreast ? breastSplit(event, now) : null
  const active = split?.activeSide
  const other = active === 'left' ? 'right' : 'left'

  // A feed measures time at the breast; everything else measures wall clock.
  const seconds = isBreast
    ? breastFeedingSeconds(event, now)
    : Math.max(0, (now - Date.parse(event.occurredAt)) / 1000)

  const pausedSince = paused ? payloadOf(event, 'breast')?.pausedAt : undefined

  /** What has added up today, this session included. */
  const todayTotal = !stats
    ? null
    : event.type === 'sleep'
      ? hours(stats.sleepSeconds)
      : event.type === 'breast'
        ? duration(stats.breastSeconds)
        : stats.pumpMl > 0
          ? ml(stats.pumpMl)
          : null

  return (
    <section
      className="card col running-card"
      style={{
        ['--accent' as string]: accent,
        borderColor: paused ? 'var(--border)' : accent,
      }}
      aria-label={`${EVENT_LABELS[event.type]} en curso`}
    >
      <div className="row between" style={{ alignItems: 'flex-start' }}>
        <div className="row" style={{ gap: 12 }}>
          <span className="bullet">
            <EventIcon type={event.type} size={20} />
          </span>
          <div className="col" style={{ gap: 1 }}>
            <h2>{EVENT_LABELS[event.type]}</h2>
            {/* Tapping the start time is how you fix a timer you began late. */}
            <button className="start-edit" onClick={() => setEditingStart(true)}>
              desde las {clock(event.occurredAt, tz)}
              {pausedSince ? ` · pausa a las ${clock(pausedSince, tz)}` : ''}
              <Pencil size={12} aria-hidden="true" />
            </button>
          </div>
        </div>
        <div className="col" style={{ gap: 4, alignItems: 'flex-end' }}>
          <span className={paused ? 'badge' : 'badge live'}>
            {!paused && <span className="pulse" />}
            {paused ? 'en pausa' : 'en curso'}
          </span>
          <span className="running-time">{liveDuration(seconds)}</span>
          {todayTotal && <span className="tiny faint">{todayTotal} hoy</span>}
        </div>
      </div>

      {split && (
        <div className="col" style={{ gap: 6 }}>
          <SideRow
            label="Izquierdo"
            seconds={split.leftSeconds}
            active={active === 'left' && !paused}
            accent={accent}
          />
          <SideRow
            label="Derecho"
            seconds={split.rightSeconds}
            active={active === 'right' && !paused}
            accent={accent}
          />
        </div>
      )}

      {isBreast && (
        <div className="row">
          <button
            className="btn grow"
            onClick={() => void (paused ? resumeFeed(event) : pauseFeed(event))}
          >
            {paused ? <Play size={17} /> : <Pause size={17} />}
            {paused ? 'Reanudar' : 'Pausa'}
          </button>
          <button className="btn grow" onClick={() => void switchSide(event)}>
            <Repeat size={17} />
            {other === 'left' ? 'Izquierdo' : 'Derecho'}
          </button>
        </div>
      )}

      <button className="btn primary block" onClick={() => void stopTimer(event, { events, timezone, now })}>
        <CircleStop size={18} /> Parar
      </button>

      {editingStart && (
        <StartTimeSheet
          event={event}
          timezone={tz}
          now={now}
          onClose={() => setEditingStart(false)}
        />
      )}
    </section>
  )
}

function SideRow({
  label,
  seconds,
  active,
  accent,
}: {
  label: string
  seconds: number
  active: boolean
  accent: string
}) {
  return (
    <div className={`side-row${active ? ' active' : ''}`}>
      <span className="row" style={{ gap: 8 }}>
        <i style={{ background: active ? accent : 'var(--text-faint)' }} />
        {label}
      </span>
      <span className="mono strong" style={{ color: active ? accent : 'var(--text-dim)' }}>
        {duration(seconds)}
      </span>
    </div>
  )
}
