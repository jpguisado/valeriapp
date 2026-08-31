import { useState } from 'react'
import {
  EVENT_LABELS,
  isTimedType,
  resumableBreastId,
  type BabyEvent,
  type EventType,
  type SingleSide,
} from '@shared/events'
import { BreastSideSheet } from '@/components/BreastSideSheet'
import { DayRing } from '@/components/DayRing'
import { NightStrip } from '@/components/NightStrip'
import { EventSheet } from '@/components/EventSheet'
import { PageHeader } from '@/components/PageHeader'
import { RunningTimers } from '@/components/RunningTimers'
import { StatusHeader } from '@/components/StatusHeader'
import { SyncBadge } from '@/components/SyncBadge'
import { Timeline } from '@/components/Timeline'
import { TypePicker, type PickMode } from '@/components/TypePicker'
import { Plus } from '@/components/icons'
import { babyAge, longDate } from '@/lib/format'
import { useEvents, useNow } from '@/lib/hooks'
import { Link } from '@/lib/router'
import { useSession } from '@/lib/session'
import { activeNightId } from '@shared/night'
import { startNight } from '@/lib/night'
import { startTimer } from '@/lib/timers'
import { toast } from '@/lib/toast'

export function Home() {
  const { babies, activeBabyId, setActiveBabyId, timezone, user } = useSession()
  const now = useNow(15_000)
  const events = useEvents(activeBabyId)
  const [sheet, setSheet] = useState<{ type: EventType; existing?: BabyEvent } | null>(null)
  const [picking, setPicking] = useState(false)
  const [choosingSide, setChoosingSide] = useState(false)
  // Siempre abre en "Estado": encontrarte una pantalla distinta según lo que
  // tocaste ayer es peor que un toque de más.
  const [view, setView] = useState<'cards' | 'ring'>('cards')
  const baby = babies.find((candidate) => candidate.id === activeBabyId)

  /**
   * Picking a timed type starts it there and then: with the grid gone, the
   * "+" is the only door, and that door has to open in two taps.
   */
  async function pick(type: EventType, mode: PickMode): Promise<void> {
    setPicking(false)
    if (!activeBabyId || !user) return

    // Lo que ya ocurrió no arranca nada: se escribe con su hora y su duración.
    if (mode === 'past') {
      setSheet({ type })
      return
    }

    if (isTimedType(type)) {
      const already = events.find((event) => event.running && event.type === type)
      if (already) {
        toast(`Ya hay ${EVENT_LABELS[type].toLowerCase()} en curso`)
        return
      }
      // El pecho pregunta por qué lado; el resto arranca en el acto.
      if (type === 'breast') {
        setChoosingSide(true)
        return
      }
      await startTimer(activeBabyId, type, user.id)
      return
    }
    setSheet({ type })
  }

  async function startBreast(side: SingleSide): Promise<void> {
    setChoosingSide(false)
    if (!activeBabyId || !user) return
    await startTimer(activeBabyId, 'breast', user.id, side)
  }

  if (babies.length === 0) {
    return (
      <div className="page">
        <PageHeader title="Valeriapp" subtitle="Empecemos por lo primero." />
        <div className="card col">
          <h2>Aún no hay ningún bebé</h2>
          <p className="small dim">Añade uno para empezar a registrar.</p>
          <Link className="btn primary" to="/ajustes/bebes">
            Añadir bebé
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="page">
      <PageHeader
        eyebrow={longDate(now, timezone.fixed)}
        title={baby?.name ?? 'Hoy'}
        subtitle={baby ? babyAge(baby.birthDate, now) : undefined}
        action={<SyncBadge />}
      />

      {babies.length > 1 && (
        <div className="chip-scroller">
          {babies.map((candidate) => (
            <button
              key={candidate.id}
              className="chip"
              aria-pressed={candidate.id === activeBabyId}
              onClick={() => setActiveBabyId(candidate.id)}
            >
              {candidate.name}
            </button>
          ))}
        </div>
      )}

      {activeBabyId && (
        <NightStrip
          events={events}
          babyId={activeBabyId}
          timezone={timezone.fixed}
          now={now}
        />
      )}

      <div className="segmented" role="tablist" aria-label="Vista del día">
        <button
          role="tab"
          aria-selected={view === 'cards'}
          onClick={() => setView('cards')}
        >
          Estado
        </button>
        <button role="tab" aria-selected={view === 'ring'} onClick={() => setView('ring')}>
          El día
        </button>
      </div>

      {view === 'cards' ? (
        <StatusHeader events={events} timezone={timezone} now={now} />
      ) : (
        <DayRing events={events} timezone={timezone} now={now} />
      )}

      <RunningTimers events={events} timezone={timezone} now={now} />

      <Timeline
        events={events}
        timezone={timezone}
        now={now}
        limitDays={2}
        daySummary="events"
        resumableEventId={resumableBreastId(events)}
        onSelect={(event) => setSheet({ type: event.type, existing: event })}
      />

      <Link className="btn ghost block" to="/historial">
        Ver todo el historial
      </Link>

      <button className="fab" onClick={() => setPicking(true)} aria-label="Registrar algo">
        <Plus size={26} strokeWidth={2.4} />
      </button>

      {picking && (
        <TypePicker
          onClose={() => setPicking(false)}
          onPick={(type, mode) => void pick(type, mode)}
          nightActive={Boolean(activeNightId(events))}
          onStartNight={() => {
            setPicking(false)
            if (activeBabyId && user) void startNight(activeBabyId, user.id)
          }}
        />
      )}

      {choosingSide && (
        <BreastSideSheet
          events={events}
          onClose={() => setChoosingSide(false)}
          onPick={(side) => void startBreast(side)}
        />
      )}

      {sheet && activeBabyId && (
        <EventSheet
          type={sheet.type}
          babyId={activeBabyId}
          existing={sheet.existing}
          onClose={() => setSheet(null)}
        />
      )}
    </div>
  )
}
