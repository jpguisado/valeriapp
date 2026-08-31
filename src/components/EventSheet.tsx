import { useEffect, useMemo, useState } from 'react'
import {
  EVENT_LABELS,
  SIDE_LABELS,
  durationSeconds,
  isTimedType,
  withShiftedStart,
  type BabyEvent,
  type EventType,
  type Side,
} from '@shared/events'
import { deviceTimezone } from '@shared/time'
import { isoToLocalInput, localInputToIso } from '@/lib/datetime-input'
import { clock, duration } from '@/lib/format'
import { announceDeleted, announceEdited, announceFailure, announceRecorded } from '@/lib/feedback'
import { useEvents } from '@/lib/hooks'
import { deleteEvent, newEvent, saveEvent } from '@/lib/sync'
import { useSession } from '@/lib/session'
import { EVENT_ACCENTS } from './event-meta'
import { EventIcon, Trash2, X } from './icons'

interface Props {
  type: EventType
  babyId: string
  existing?: BabyEvent
  /** Momento con el que abrir el formulario, para lo que se apunta a posteriori. */
  initialAt?: string
  onClose: () => void
}

type Payload = Record<string, unknown>

/** Saltos hacia atrás desde ahora, los que se usan al apuntar algo olvidado. */
const AGO_SHORTCUTS = [
  { label: 'ahora', minutes: 0 },
  { label: '−30 min', minutes: 30 },
  { label: '−1 h', minutes: 60 },
  { label: '−2 h', minutes: 120 },
  { label: '−3 h', minutes: 180 },
]

/**
 * One sheet for every event type. Optional fields stay collapsed behind
 * "Más detalles": at 4am the only mandatory decision is the time.
 */
export function EventSheet({ type, babyId, existing, initialAt, onClose }: Props) {
  const { user, timezone } = useSession()
  const events = useEvents(babyId)
  const tz = deviceTimezone()
  const [occurredAt, setOccurredAt] = useState(() =>
    isoToLocalInput(existing?.occurredAt ?? initialAt ?? new Date().toISOString(), tz),
  )
  const [durationMin, setDurationMin] = useState(() => {
    const seconds = existing ? durationSeconds(existing) : null
    return seconds === null ? '' : String(Math.round(seconds / 60))
  })
  const [payload, setPayload] = useState<Payload>(() => ({ ...defaultPayload(type), ...(existing?.payload ?? {}) }))
  const [note, setNote] = useState(existing?.note ?? '')
  const [details, setDetails] = useState(false)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const set = (key: string, value: unknown): void => setPayload((prev) => ({ ...prev, [key]: value }))

  /**
   * De una toma se recuerda "duró veinte minutos", no "acabó a las 4:23". Se
   * pide la duración y el fin se calcula; la hora de inicio, en cambio, se pide
   * siempre y exacta, porque decide en qué día cae y qué viene después.
   */
  const minutes = useMemo(() => {
    if (type === 'breast' && payload.side === 'both') {
      const left = Number(payload.leftSeconds ?? 0) / 60
      const right = Number(payload.rightSeconds ?? 0) / 60
      const total = Math.round(left + right)
      return total > 0 ? total : null
    }
    const typed = Number(durationMin)
    return durationMin !== '' && Number.isFinite(typed) && typed > 0 ? typed : null
  }, [type, payload.side, payload.leftSeconds, payload.rightSeconds, durationMin])

  const endsAt = useMemo(
    () => (minutes === null ? null : Date.parse(localInputToIso(occurredAt)) + minutes * 60_000),
    [minutes, occurredAt],
  )

  async function submit(): Promise<void> {
    if (!user) return
    setSaving(true)

    const base = existing ?? newEvent({ babyId, type, createdBy: user.id })
    const stillRunning = minutes === null ? (existing?.running ?? false) : false
    let nextOccurredAt = localInputToIso(occurredAt)
    let nextPayload = cleanPayload(type, payload)

    // The form does not edit the live segment of a running feed, so carry it
    // over untouched instead of wiping it and freezing the timer.
    if (existing && stillRunning) {
      const live = existing.payload as Record<string, unknown>
      for (const key of ['activeSide', 'segmentStartedAt', 'pausedAt']) {
        if (live[key] !== undefined) nextPayload[key] = live[key]
      }
    }

    // Mover el inicio arrastra los minutos solo mientras el temporizador corre:
    // en una toma ya cerrada, con inicio y fin, cambiar la hora es moverla de
    // sitio, no alargarla. Sumar la diferencia a un pecho llegó a meter 11 horas
    // en un registro de 40 minutos.
    if (existing && stillRunning && nextOccurredAt !== existing.occurredAt) {
      const shifted = withShiftedStart(
        { ...existing, payload: nextPayload, running: stillRunning },
        Date.parse(nextOccurredAt),
      )
      nextOccurredAt = shifted.occurredAt
      nextPayload = shifted.payload as Payload
    }

    const saved: BabyEvent = {
      ...base,
      type,
      occurredAt: nextOccurredAt,
      endedAt: endsAt === null ? null : new Date(endsAt).toISOString(),
      running: stillRunning,
      estimated: minutes === null ? (existing?.estimated ?? false) : false,
      payload: nextPayload,
      note: note.trim() ? note.trim() : null,
      tz: existing?.tz ?? tz,
    }

    try {
      await saveEvent(saved)
    } catch {
      announceFailure()
      setSaving(false)
      return
    }

    if (existing) announceEdited()
    else announceRecorded(saved, { events, timezone })

    setSaving(false)
    onClose()
  }

  async function remove(): Promise<void> {
    if (!existing) return
    if (!window.confirm('¿Borrar este registro? Se puede recuperar desde el historial.')) return
    try {
      await deleteEvent(existing.id)
    } catch {
      announceFailure('No se pudo borrar')
      return
    }
    announceDeleted()
    onClose()
  }

  return (
    <div className="sheet-backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label={EVENT_LABELS[type]}>
        <div className="sheet-handle" />
        <div className="row between">
          <h2 className="row" style={{ gap: 10 }}>
            <span
              className="bullet"
              style={{
                ['--accent' as string]: EVENT_ACCENTS[type],
                width: 36,
                height: 36,
                borderRadius: 13,
                display: 'grid',
                placeItems: 'center',
                background: `color-mix(in srgb, ${EVENT_ACCENTS[type]} 15%, transparent)`,
                color: EVENT_ACCENTS[type],
              }}
            >
              <EventIcon type={type} size={19} />
            </span>
            {EVENT_LABELS[type]}
          </h2>
          <button className="btn ghost icon" onClick={onClose} aria-label="Cerrar">
            <X size={19} />
          </button>
        </div>

        {existing?.estimated && (
          <p className="banner warn">
            Duración estimada: el temporizador se cerró solo. Ajusta la hora de fin si no fue así.
          </p>
        )}

        <label className="field">
          Hora de inicio
          <input
            type="datetime-local"
            value={occurredAt}
            onChange={(e) => setOccurredAt(e.target.value)}
          />
        </label>

        {/* Atajos para llegar a la hora sin pelearse con el selector. */}
        <div className="row wrap" style={{ gap: 6 }}>
          {AGO_SHORTCUTS.map(({ label, minutes: back }) => (
            <button
              key={label}
              className="chip"
              onClick={() => setOccurredAt(isoToLocalInput(new Date(Date.now() - back * 60_000).toISOString(), tz))}
            >
              {label}
            </button>
          ))}
        </div>

        {isTimedType(type) && !(type === 'breast' && payload.side === 'both') && (
          <label className="field">
            Duración (min)
            <input
              type="number"
              inputMode="numeric"
              min={0}
              step={5}
              value={durationMin}
              onChange={(e) => setDurationMin(e.target.value)}
              placeholder="—"
            />
            {minutes === null ? (
              <span className="tiny faint">
                Sin duración quedará <strong>en curso</strong>, y podrás pararlo desde inicio.
              </span>
            ) : (
              <span className="tiny faint">
                Termina a las {clock(endsAt as number, tz)} · {duration(minutes * 60)}
              </span>
            )}
          </label>
        )}

        {type === 'breast' && payload.side === 'both' && minutes !== null && (
          <p className="tiny faint">
            Duración {duration(minutes * 60)} · termina a las {clock(endsAt as number, tz)}
          </p>
        )}

        <TypeFields type={type} payload={payload} set={set} details={details} />

        {hasOptionalFields(type) && (
          <button className="btn ghost block" onClick={() => setDetails((value) => !value)}>
            {details ? 'Menos detalles' : 'Más detalles'}
          </button>
        )}

        <label className="field">
          Nota
          <textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Opcional" />
        </label>

        <div className="row">
          {existing && (
            <button className="btn danger" onClick={remove}>
              <Trash2 size={17} /> Borrar
            </button>
          )}
          <button className="btn primary grow" onClick={submit} disabled={saving}>
            {existing ? 'Guardar' : 'Registrar'}
          </button>
        </div>

        {existing && (
          <p className="tiny dim center">
            Registrado {existing.createdAt === existing.updatedAt ? '' : '· editado '}
            {existing.tz !== tz ? `· zona ${existing.tz}` : ''}
          </p>
        )}
      </div>
    </div>
  )
}

function TypeFields({
  type,
  payload,
  set,
  details,
}: {
  type: EventType
  payload: Payload
  set: (key: string, value: unknown) => void
  details: boolean
}) {
  switch (type) {
    case 'breast': {
      const bothSides = payload.side === 'both'
      return (
        <>
          <SideChooser value={payload.side as Side} onChange={(side) => set('side', side)} />
          {bothSides && (
            <Chips
              label="Empezó por"
              value={(payload.firstSide as string) ?? 'left'}
              onChange={(value) => set('firstSide', value)}
              options={[
                ['left', 'Izquierdo'],
                ['right', 'Derecho'],
              ]}
            />
          )}
          <div className="row">
            <label className="field grow">
              Suplemento (ml)
              <input
                type="number"
                inputMode="numeric"
                min={0}
                step={5}
                value={(payload.supplementMl as number) ?? ''}
                onChange={(e) =>
                  set('supplementMl', e.target.value === '' ? undefined : Number(e.target.value))
                }
                placeholder="—"
              />
            </label>
            {Boolean(payload.supplementMl) && (
              <Chips
                label="Tipo"
                value={(payload.supplementKind as string) ?? 'formula'}
                onChange={(value) => set('supplementKind', value)}
                options={[
                  ['breastmilk', 'Materna'],
                  ['formula', 'Fórmula'],
                ]}
              />
            )}
          </div>
          {/* With both breasts used, the split is the point of the record, not
              an optional detail. */}
          {(bothSides || details) && (
            <div className="row">
              <label className="field grow">
                Minutos izquierdo
                <input
                  type="number"
                  inputMode="numeric"
                  min={0}
                  value={secondsToMinutes(payload.leftSeconds)}
                  onChange={(e) => set('leftSeconds', minutesToSeconds(e.target.value))}
                />
              </label>
              <label className="field grow">
                Minutos derecho
                <input
                  type="number"
                  inputMode="numeric"
                  min={0}
                  value={secondsToMinutes(payload.rightSeconds)}
                  onChange={(e) => set('rightSeconds', minutesToSeconds(e.target.value))}
                />
              </label>
            </div>
          )}
        </>
      )
    }
    case 'bottle':
      return (
        <>
          <label className="field">
            Cantidad (ml)
            <input
              type="number"
              inputMode="numeric"
              min={0}
              step={5}
              value={(payload.ml as number) ?? ''}
              onChange={(e) => set('ml', Number(e.target.value))}
            />
          </label>
          <Chips
            label="Tipo"
            value={payload.kind as string}
            onChange={(value) => set('kind', value)}
            options={[
              ['breastmilk', 'Leche materna'],
              ['formula', 'Fórmula'],
              ['mixed', 'Mixta'],
            ]}
          />
        </>
      )
    case 'pump':
      return (
        <>
          <SideChooser value={payload.side as Side} onChange={(side) => set('side', side)} />
          <label className="field">
            Cantidad (ml)
            <input
              type="number"
              inputMode="numeric"
              min={0}
              step={5}
              value={(payload.ml as number) ?? ''}
              onChange={(e) => set('ml', Number(e.target.value))}
            />
          </label>
        </>
      )
    case 'sleep':
      return details ? (
        <Chips
          label="Dónde"
          value={payload.place as string}
          onChange={(value) => set('place', value)}
          options={[
            ['crib', 'Cuna'],
            ['arms', 'Brazos'],
            ['stroller', 'Carro'],
            ['bed', 'Cama'],
            ['car', 'Coche'],
            ['other', 'Otro'],
          ]}
        />
      ) : null
    case 'diaper':
      return (
        <>
          <Chips
            label="Contenido"
            value={payload.kind as string}
            onChange={(value) => set('kind', value)}
            options={[
              ['pee', 'Pis'],
              ['poo', 'Caca'],
              ['mixed', 'Mixto'],
              ['dry', 'Seco'],
            ]}
          />
          {details && (
            <>
              <Chips
                label="Consistencia"
                value={payload.consistency as string}
                onChange={(value) => set('consistency', value)}
                options={[
                  ['liquid', 'Líquida'],
                  ['soft', 'Blanda'],
                  ['normal', 'Normal'],
                  ['hard', 'Dura'],
                ]}
              />
              <Chips
                label="Color"
                value={payload.color as string}
                onChange={(value) => set('color', value)}
                options={[
                  ['yellow', 'Amarillo'],
                  ['brown', 'Marrón'],
                  ['green', 'Verde'],
                  ['black', 'Negro'],
                  ['red', 'Rojo'],
                  ['white', 'Blanco'],
                ]}
              />
              <label className="switch">
                <span>Escape</span>
                <input
                  type="checkbox"
                  checked={Boolean(payload.leak)}
                  onChange={(e) => set('leak', e.target.checked)}
                />
              </label>
            </>
          )}
        </>
      )
    case 'temperature':
      return (
        <>
          <label className="field">
            Temperatura (ºC)
            <input
              type="number"
              inputMode="decimal"
              step={0.1}
              min={30}
              max={45}
              value={(payload.celsius as number) ?? ''}
              onChange={(e) => set('celsius', Number(e.target.value))}
            />
          </label>
          <Chips
            label="Método"
            value={payload.method as string}
            onChange={(value) => set('method', value)}
            options={[
              ['axillary', 'Axilar'],
              ['forehead', 'Frontal'],
              ['ear', 'Oído'],
              ['rectal', 'Rectal'],
            ]}
          />
        </>
      )
    case 'weight':
      return (
        <label className="field">
          Peso (gramos)
          <input
            type="number"
            inputMode="numeric"
            step={10}
            min={200}
            value={(payload.grams as number) ?? ''}
            onChange={(e) => set('grams', Number(e.target.value))}
          />
          <span className="tiny dim">Se muestra en kg; se escribe en gramos para teclear más rápido.</span>
        </label>
      )
    case 'height':
    case 'head':
      return (
        <label className="field">
          {type === 'height' ? 'Talla (cm)' : 'Perímetro cefálico (cm)'}
          <input
            type="number"
            inputMode="decimal"
            step={0.1}
            value={(payload.cm as number) ?? ''}
            onChange={(e) => set('cm', Number(e.target.value))}
          />
        </label>
      )
    case 'medication':
      return (
        <>
          <label className="field">
            Medicamento
            <input
              type="text"
              value={(payload.name as string) ?? ''}
              onChange={(e) => set('name', e.target.value)}
              placeholder="Apiretal"
              autoComplete="off"
            />
          </label>
          <label className="field">
            Dosis
            <input
              type="text"
              value={(payload.dose as string) ?? ''}
              onChange={(e) => set('dose', e.target.value)}
              placeholder="1,2 ml"
              autoComplete="off"
            />
          </label>
        </>
      )
    default:
      return null
  }
}

function SideChooser({ value, onChange }: { value?: Side; onChange: (side: Side) => void }) {
  return (
    <Chips
      label="Lado"
      value={value}
      onChange={(next) => onChange(next as Side)}
      options={(['left', 'right', 'both'] as Side[]).map((side) => [side, SIDE_LABELS[side]])}
    />
  )
}

function Chips({
  label,
  value,
  onChange,
  options,
}: {
  label: string
  value?: string
  onChange: (value: string) => void
  options: Array<[string, string]>
}) {
  return (
    <div className="col">
      <span className="tiny dim">{label}</span>
      <div className="row wrap">
        {options.map(([key, text]) => (
          <button
            key={key}
            className="chip"
            aria-pressed={value === key}
            onClick={() => onChange(key)}
            type="button"
          >
            {text}
          </button>
        ))}
      </div>
    </div>
  )
}

export function defaultPayload(type: EventType): Payload {
  switch (type) {
    case 'breast':
      return { side: 'left' }
    case 'bottle':
      return { ml: 60, kind: 'formula' }
    case 'pump':
      return { side: 'both', ml: 0 }
    case 'diaper':
      return { kind: 'pee' }
    case 'temperature':
      return { celsius: 36.8, method: 'axillary' }
    case 'medication':
      return { name: '', dose: '' }
    default:
      return {}
  }
}

function hasOptionalFields(type: EventType): boolean {
  return type === 'breast' || type === 'diaper' || type === 'sleep'
}

function cleanPayload(type: EventType, payload: Payload): Payload {
  const output: Payload = {}
  for (const [key, value] of Object.entries(payload)) {
    if (value === '' || value === undefined || value === null) continue
    output[key] = value
  }
  if (type === 'medication' && !output.name) output.name = 'Sin nombre'
  if (type === 'breast') {
    // Editing by hand always produces a finished feed: no live segment left.
    delete output.activeSide
    delete output.segmentStartedAt
    delete output.pausedAt
    if (output.side === 'both' && !output.firstSide) output.firstSide = 'left'
    if (output.side !== 'both') output.firstSide = output.side
  }
  return output
}

function secondsToMinutes(value: unknown): number | string {
  return typeof value === 'number' ? Math.round(value / 60) : ''
}

function minutesToSeconds(value: string): number | undefined {
  const minutes = Number(value)
  return Number.isFinite(minutes) && value !== '' ? minutes * 60 : undefined
}
