import { useState } from 'react'
import { EVENT_LABELS, type BabyEvent } from '@shared/events'
import { isoToLocalInput, localInputToIso } from '@/lib/datetime-input'
import { ago, clock, duration } from '@/lib/format'
import { adjustStart } from '@/lib/timers'
import { X } from './icons'

/** Minutes you can knock off the start with one tap, in the usual sizes. */
const QUICK_OFFSETS = [5, 10, 15, 30, 45, 60]

/**
 * "Se durmió a las 14:30 y me acordé de darle a Sueño a las 15:10."
 * One tap per five or ten minutes, and an exact picker underneath for when the
 * offsets are not enough.
 */
export function StartTimeSheet({
  event,
  timezone,
  now,
  onClose,
}: {
  event: BabyEvent
  timezone: string
  now: number
  onClose: () => void
}) {
  const [startMs, setStartMs] = useState(() => Date.parse(event.occurredAt))
  const [saving, setSaving] = useState(false)

  const ceiling = event.endedAt ? Date.parse(event.endedAt) : now
  const elapsed = Math.max(0, (ceiling - startMs) / 1000)

  function back(minutes: number): void {
    setStartMs((current) => current - minutes * 60_000)
  }

  async function save(): Promise<void> {
    setSaving(true)
    await adjustStart(event, startMs, timezone)
    setSaving(false)
    onClose()
  }

  return (
    <div className="sheet-backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label="Ajustar la hora de inicio">
        <div className="sheet-handle" />
        <div className="row between">
          <h2>¿Cuándo empezó?</h2>
          <button className="btn ghost icon" onClick={onClose} aria-label="Cerrar">
            <X size={19} />
          </button>
        </div>

        <p className="small dim">
          {EVENT_LABELS[event.type]} · ahora marcado a las {clock(event.occurredAt, timezone)}
        </p>

        <div className="card col" style={{ gap: 4, alignItems: 'center', padding: 18 }}>
          <span className="running-time">{clock(startMs, timezone)}</span>
          <span className="tiny faint">
            {ago(startMs, ceiling)} · {duration(elapsed)}
            {event.running ? ' en curso' : ''}
          </span>
        </div>

        <div className="col" style={{ gap: 6 }}>
          <span className="tiny faint">Empezó antes</span>
          <div className="row wrap">
            {QUICK_OFFSETS.map((minutes) => (
              <button key={minutes} className="chip" onClick={() => back(minutes)}>
                −{minutes} min
              </button>
            ))}
          </div>
        </div>

        <label className="field">
          Hora exacta
          <input
            type="datetime-local"
            value={isoToLocalInput(new Date(startMs).toISOString(), timezone)}
            onChange={(e) => setStartMs(Date.parse(localInputToIso(e.target.value)))}
          />
        </label>

        {startMs > ceiling && (
          <p className="error-text">
            Esa hora es posterior {event.running ? 'a ahora' : 'al final'}; se ajustará al límite.
          </p>
        )}

        <div className="row">
          <button className="btn ghost grow" onClick={() => setStartMs(Date.parse(event.occurredAt))}>
            Deshacer
          </button>
          <button className="btn primary grow" onClick={() => void save()} disabled={saving}>
            Guardar
          </button>
        </div>
      </div>
    </div>
  )
}
