import { useState } from 'react'
import {
  EVENT_LABELS,
  resumableIds,
  type BabyEvent,
  type EventType,
} from '@shared/events'
import { EventSheet } from '@/components/EventSheet'
import { PageHeader } from '@/components/PageHeader'
import { Timeline } from '@/components/Timeline'
import { useEvents, useNow } from '@/lib/hooks'
import { useSession } from '@/lib/session'

/** The filters worth having in a bar you can flick through with a thumb. */
const FILTERS: EventType[] = [
  'breast',
  'bottle',
  'diaper',
  'sleep',
  'pump',
  'medication',
  'temperature',
  'weight',
  'height',
  'head',
  'note',
]

export function History() {
  const { activeBabyId, timezone } = useSession()
  const events = useEvents(activeBabyId)
  const now = useNow(60_000)
  const [filter, setFilter] = useState<EventType | null>(null)
  const [days, setDays] = useState(14)
  const [selected, setSelected] = useState<BabyEvent | null>(null)

  const shown = filter ? events.filter((event) => event.type === filter) : events

  return (
    <div className="page">
      <PageHeader
        title="Historial"
        subtitle={`${shown.length} ${shown.length === 1 ? 'evento registrado' : 'eventos registrados'}`}
      />

      <div className="chip-scroller">
        <button className="chip" aria-pressed={filter === null} onClick={() => setFilter(null)}>
          Todos
        </button>
        {FILTERS.map((type) => (
          <button
            key={type}
            className="chip"
            aria-pressed={filter === type}
            onClick={() => setFilter(filter === type ? null : type)}
          >
            {EVENT_LABELS[type]}
          </button>
        ))}
      </div>

      <Timeline
        events={events}
        timezone={timezone}
        now={now}
        filter={filter ? [filter] : []}
        limitDays={days}
        daySummary="counts"
        resumableEventIds={resumableIds(events)}
        onSelect={setSelected}
      />

      <button className="btn ghost block" onClick={() => setDays((value) => value + 14)}>
        Cargar más días
      </button>

      {selected && activeBabyId && (
        <EventSheet
          type={selected.type}
          babyId={activeBabyId}
          existing={selected}
          onClose={() => setSelected(null)}
        />
      )}
    </div>
  )
}
