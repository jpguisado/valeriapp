import { useMemo, useState } from 'react'
import type { BabyEvent, EventType } from '@shared/events'
import { addMonths, dayKeyOf, dayKeysBetween, endOfMonth, startOfMonth, startOfWeek, zoneFor } from '@shared/time'
import { EventSheet } from '@/components/EventSheet'
import { PageHeader } from '@/components/PageHeader'
import { Timeline } from '@/components/Timeline'
import { ChevronLeft, ChevronRight } from '@/components/icons'
import { EVENT_ACCENTS } from '@/components/event-meta'
import { useEvents, useNow } from '@/lib/hooks'
import { useSession } from '@/lib/session'
import { dayLabel, monthLabel } from '@/lib/format'

const WEEKDAY_HEADERS = ['L', 'M', 'X', 'J', 'V', 'S', 'D']
/** At most four dots per day: beyond that the row stops being readable. */
const MAX_DOTS = 4

export function Calendar() {
  const { activeBabyId, timezone } = useSession()
  const events = useEvents(activeBabyId)
  const now = useNow(60_000)
  const tz = timezone.fixed
  const [offset, setOffset] = useState(0)
  const [selectedDay, setSelectedDay] = useState<string | null>(null)
  const [selectedEvent, setSelectedEvent] = useState<BabyEvent | null>(null)

  const monthStart = startOfMonth(addMonths(dayKeyOf(now, tz), offset))
  const monthEnd = endOfMonth(monthStart)
  const today = dayKeyOf(now, tz)
  const day = selectedDay ?? today

  /** Which kinds of event happened on each day, for the coloured dots. */
  const typesByDay = useMemo(() => {
    const map = new Map<string, EventType[]>()
    for (const event of events) {
      const key = dayKeyOf(event.occurredAt, zoneFor(event.tz, timezone))
      const list = map.get(key) ?? []
      if (!list.includes(event.type)) list.push(event.type)
      map.set(key, list)
    }
    return map
  }, [events, timezone])

  const days = dayKeysBetween(monthStart, monthEnd)
  const leadingBlanks = dayKeysBetween(startOfWeek(monthStart), monthStart).length - 1

  const dayEvents = useMemo(
    () => events.filter((event) => dayKeyOf(event.occurredAt, zoneFor(event.tz, timezone)) === day),
    [events, day, timezone],
  )

  return (
    <div className="page">
      <PageHeader
        title={monthLabel(monthStart)}
        action={
          <div className="row" style={{ gap: 8 }}>
            <button
              className="btn ghost icon"
              onClick={() => setOffset((value) => value - 1)}
              aria-label="Mes anterior"
            >
              <ChevronLeft size={20} />
            </button>
            <button
              className="btn ghost icon"
              onClick={() => setOffset((value) => Math.min(0, value + 1))}
              disabled={offset >= 0}
              aria-label="Mes siguiente"
            >
              <ChevronRight size={20} />
            </button>
          </div>
        }
      />

      <div className="card">
        <div className="month-grid">
          {WEEKDAY_HEADERS.map((label, index) => (
            <span key={index} className="month-head">
              {label}
            </span>
          ))}
          {Array.from({ length: leadingBlanks }, (_, index) => (
            <span key={`blank-${index}`} className="month-day empty" />
          ))}
          {days.map((dayKey) => {
            const types = typesByDay.get(dayKey) ?? []
            const selected = dayKey === day
            return (
              <button
                key={dayKey}
                className={`month-day${dayKey === today ? ' today' : ''}`}
                aria-pressed={selected}
                onClick={() => setSelectedDay(dayKey)}
              >
                <span>{Number(dayKey.slice(8))}</span>
                <span className="month-dots">
                  {types.slice(0, MAX_DOTS).map((type) => (
                    <i
                      key={type}
                      style={{ color: selected ? 'var(--primary-text)' : EVENT_ACCENTS[type] }}
                    />
                  ))}
                </span>
              </button>
            )
          })}
        </div>
      </div>

      <div className="day-header">
        <span>{dayLabel(day, tz, now)}</span>
        <span className="summary">
          {dayEvents.length} {dayEvents.length === 1 ? 'evento' : 'eventos'}
        </span>
      </div>

      <Timeline
        events={dayEvents}
        timezone={timezone}
        now={now}
        hideDays
        onSelect={setSelectedEvent}
      />

      {selectedEvent && activeBabyId && (
        <EventSheet
          type={selectedEvent.type}
          babyId={activeBabyId}
          existing={selectedEvent}
          onClose={() => setSelectedEvent(null)}
        />
      )}
    </div>
  )
}
