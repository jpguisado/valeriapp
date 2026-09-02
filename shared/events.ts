import { z } from 'zod'

/** Every kind of thing we can record about a baby. */
export const EVENT_TYPES = [
  'breast',
  'bottle',
  'pump',
  'sleep',
  'wakeup',
  'diaper',
  'temperature',
  'weight',
  'height',
  'head',
  'medication',
  'note',
] as const

export type EventType = (typeof EVENT_TYPES)[number]

/** Types recorded as an interval, i.e. the ones a live timer can drive. */
export const TIMED_TYPES = ['breast', 'sleep', 'pump', 'wakeup'] as const
export type TimedType = (typeof TIMED_TYPES)[number]

export function isTimedType(type: EventType): type is TimedType {
  return (TIMED_TYPES as readonly string[]).includes(type)
}

/** Same set, as a Set, for the drawing code that asks this per event. */
export const HAS_DURATION_TYPES: ReadonlySet<string> = new Set(TIMED_TYPES)

/**
 * How long a running timer may go before it is auto-closed, in seconds.
 * An auto-closed event is flagged `estimated` and excluded from averages
 * until somebody confirms the duration.
 */
export const AUTO_CLOSE_SECONDS: Record<TimedType, number> = {
  breast: 60 * 60,
  sleep: 14 * 60 * 60,
  pump: 45 * 60,
  wakeup: 3 * 60 * 60,
}

export const sideSchema = z.enum(['left', 'right', 'both'])
export type Side = z.infer<typeof sideSchema>

/** The side a feed is on right now; 'both' is a summary, never an active side. */
export const singleSideSchema = z.enum(['left', 'right'])
export type SingleSide = z.infer<typeof singleSideSchema>

export const payloadSchemas = {
  breast: z.object({
    /** Summary of the whole feed: one side, or 'both' when the baby switched. */
    side: sideSchema,
    /** The side the feed started on — what alternation actually tracks. */
    firstSide: singleSideSchema.optional(),
    /** While the timer runs, the side currently being fed from. */
    activeSide: singleSideSchema.optional(),
    /** Start of the segment on `activeSide`; earlier segments are accumulated. */
    segmentStartedAt: z.string().optional(),
    /** Set while the feed is paused: the clock stops, the feed stays open. */
    pausedAt: z.string().optional(),
    leftSeconds: z.number().min(0).max(86400).optional(),
    rightSeconds: z.number().min(0).max(86400).optional(),
    /** Lactancia mixta: el biberón que acompañó a esta toma, no otra toma. */
    supplementMl: z.number().min(0).max(2000).optional(),
    supplementKind: z.enum(['breastmilk', 'formula']).optional(),
  }),
  bottle: z.object({
    ml: z.number().min(0).max(2000),
    kind: z.enum(['breastmilk', 'formula', 'mixed']),
  }),
  pump: z.object({
    side: sideSchema,
    ml: z.number().min(0).max(2000),
  }),
  sleep: z.object({
    place: z.enum(['crib', 'arms', 'stroller', 'bed', 'car', 'other']).optional(),
    /**
     * Agrupa los tramos de una misma sesión de sueño partida por pausas. No
     * es "la noche": una siesta de la mañana se interrumpe igual.
     */
    sessionId: z.string().optional(),
    /**
     * Este tramo se cerró con una pausa, no con un final: la sesión sigue
     * abierta y se puede reanudar. Un sueño terminado no lo lleva.
     */
    paused: z.boolean().optional(),
  }),
  /** Un corte del sueño con principio y fin: se desveló y volvió a dormirse. */
  wakeup: z.object({}),
  diaper: z.object({
    kind: z.enum(['pee', 'poo', 'mixed', 'dry']),
    consistency: z.enum(['liquid', 'soft', 'normal', 'hard']).optional(),
    color: z.enum(['yellow', 'brown', 'green', 'black', 'red', 'white']).optional(),
    leak: z.boolean().optional(),
  }),
  temperature: z.object({
    celsius: z.number().min(25).max(45),
    method: z.enum(['axillary', 'forehead', 'rectal', 'ear']),
  }),
  weight: z.object({ grams: z.number().int().min(200).max(40000) }),
  height: z.object({ cm: z.number().min(20).max(150) }),
  head: z.object({ cm: z.number().min(20).max(70) }),
  medication: z.object({
    name: z.string().min(1).max(120),
    dose: z.string().max(60).optional(),
  }),
  note: z.object({}),
} satisfies Record<EventType, z.ZodType>

export type PayloadOf<T extends EventType> = z.infer<(typeof payloadSchemas)[T]>
export type AnyPayload = { [T in EventType]: PayloadOf<T> }[EventType]

/** ISO-8601 instant with offset, e.g. 2026-08-30T03:12:00.000Z */
const isoInstant = z.string().datetime({ offset: true })
/** IANA zone captured from the device that recorded the event. */
const ianaZone = z.string().min(1).max(64)

export const babyEventSchema = z
  .object({
    id: z.uuid(),
    babyId: z.uuid(),
    type: z.enum(EVENT_TYPES),
    occurredAt: isoInstant,
    endedAt: isoInstant.nullable().default(null),
    tz: ianaZone,
    running: z.boolean().default(false),
    estimated: z.boolean().default(false),
    payload: z.record(z.string(), z.unknown()).default({}),
    note: z.string().max(2000).nullable().default(null),
    createdBy: z.uuid(),
    createdAt: isoInstant,
    updatedAt: isoInstant,
    deletedAt: isoInstant.nullable().default(null),
  })
  .superRefine((event, ctx) => {
    const schema = payloadSchemas[event.type]
    const parsed = schema.safeParse(event.payload)
    if (!parsed.success) {
      ctx.addIssue({
        code: 'custom',
        path: ['payload'],
        message: `payload inválido para "${event.type}": ${parsed.error.issues.map((i) => i.message).join(', ')}`,
      })
    }
    if (event.endedAt && event.endedAt < event.occurredAt) {
      ctx.addIssue({ code: 'custom', path: ['endedAt'], message: 'endedAt anterior a occurredAt' })
    }
    if (event.running && event.endedAt) {
      ctx.addIssue({ code: 'custom', path: ['running'], message: 'un evento en curso no puede tener endedAt' })
    }
    if (event.running && !isTimedType(event.type)) {
      ctx.addIssue({ code: 'custom', path: ['running'], message: `"${event.type}" no admite temporizador` })
    }
  })

export type BabyEvent = z.infer<typeof babyEventSchema>

/** Duration in seconds, or null for instantaneous / still-running events. */
export function durationSeconds(event: Pick<BabyEvent, 'occurredAt' | 'endedAt'>): number | null {
  if (!event.endedAt) return null
  return Math.max(0, (Date.parse(event.endedAt) - Date.parse(event.occurredAt)) / 1000)
}

export function payloadOf<T extends EventType>(event: BabyEvent, type: T): PayloadOf<T> | null {
  if (event.type !== type) return null
  const parsed = payloadSchemas[type].safeParse(event.payload)
  return parsed.success ? (parsed.data as PayloadOf<T>) : null
}

export interface BreastSplit {
  leftSeconds: number
  rightSeconds: number
  activeSide?: SingleSide
}

/**
 * Time spent on each breast, including the segment still in progress.
 *
 * A feed is one event even when the baby switches sides: each side keeps its
 * own accumulated seconds, and the running segment is added on the fly. Events
 * recorded before side-switching existed only carry `side`, so their total
 * duration is attributed the old way.
 */
export function breastSplit(
  event: Pick<BabyEvent, 'type' | 'payload' | 'occurredAt' | 'endedAt' | 'running'>,
  now: number = Date.now(),
): BreastSplit {
  const parsed = payloadSchemas.breast.safeParse(event.payload)
  if (!parsed.success) return { leftSeconds: 0, rightSeconds: 0 }
  const payload = parsed.data

  const tracksSegments =
    payload.activeSide !== undefined ||
    payload.leftSeconds !== undefined ||
    payload.rightSeconds !== undefined

  if (!tracksSegments) {
    const total =
      durationSeconds(event) ??
      (event.running ? Math.max(0, (now - Date.parse(event.occurredAt)) / 1000) : 0)
    if (payload.side === 'left') return { leftSeconds: total, rightSeconds: 0 }
    if (payload.side === 'right') return { leftSeconds: 0, rightSeconds: total }
    return { leftSeconds: total / 2, rightSeconds: total / 2 }
  }

  let leftSeconds = payload.leftSeconds ?? 0
  let rightSeconds = payload.rightSeconds ?? 0

  // While paused there is no open segment, so nothing accrues.
  if (event.running && !payload.pausedAt && payload.activeSide && payload.segmentStartedAt) {
    const elapsed = Math.max(0, (now - Date.parse(payload.segmentStartedAt)) / 1000)
    if (payload.activeSide === 'left') leftSeconds += elapsed
    else rightSeconds += elapsed
  }

  return { leftSeconds, rightSeconds, activeSide: payload.activeSide }
}

/** The breast a feed started on, for the alternation reminder and the status header. */
export function firstSideOf(event: Pick<BabyEvent, 'type' | 'payload'>): SingleSide | null {
  const parsed = payloadSchemas.breast.safeParse(event.payload)
  if (!parsed.success) return null
  if (parsed.data.firstSide) return parsed.data.firstSide
  return parsed.data.side === 'both' ? null : parsed.data.side
}

/**
 * The breast the feed ended on — the last one with a record.
 *
 * Feeds stopped from now on carry `activeSide`, so this is exact. For the ones
 * already stored it is deduced: if only one side has time it is that one, and
 * if both were used, the last segment is the opposite of the one it started on.
 */
export function endingSideOf(event: Pick<BabyEvent, 'type' | 'payload'>): SingleSide | null {
  const parsed = payloadSchemas.breast.safeParse(event.payload)
  if (!parsed.success) return null
  const payload = parsed.data
  if (payload.activeSide) return payload.activeSide

  const left = payload.leftSeconds ?? 0
  const right = payload.rightSeconds ?? 0
  if (left > 0 && right === 0) return 'left'
  if (right > 0 && left === 0) return 'right'
  if (left > 0 && right > 0) {
    const first = payload.firstSide
    if (first) return first === 'left' ? 'right' : 'left'
    return left >= right ? 'left' : 'right'
  }
  return payload.firstSide ?? (payload.side === 'both' ? null : (payload.side as SingleSide))
}

/**
 * The breast with the most recent record, to show as a hint before starting.
 *
 * Deliberately not "the opposite of the last one": the previous version fed on
 * its own suggestions — it stored the side it had proposed, not the one the
 * baby actually took — and locked itself onto the same breast for ever.
 */
export function lastBreastSide(events: BabyEvent[]): SingleSide | null {
  let latest: BabyEvent | null = null
  for (const event of events) {
    if (event.deletedAt || event.type !== 'breast') continue
    if (!latest || Date.parse(event.occurredAt) > Date.parse(latest.occurredAt)) latest = event
  }
  return latest ? endingSideOf(latest) : null
}

/** The most recent finished breastfeed, the only one that can be reopened. */
export function resumableBreastId(events: BabyEvent[]): string | null {
  let latest: BabyEvent | null = null
  for (const event of events) {
    if (event.deletedAt || event.type !== 'breast') continue
    if (!latest || Date.parse(event.occurredAt) > Date.parse(latest.occurredAt)) latest = event
  }
  if (!latest || latest.running) return null
  return latest.id
}

/**
 * Reopens a feed stopped by mistake: a new segment on the side that was active,
 * with everything already counted intact.
 */
export function reopenBreastPayload(
  event: Pick<BabyEvent, 'type' | 'payload' | 'occurredAt' | 'endedAt' | 'running'>,
  at: number = Date.now(),
): PayloadOf<'breast'> {
  const parsed = payloadSchemas.breast.safeParse(event.payload)
  const payload = parsed.success ? parsed.data : { side: 'left' as Side }
  const side = endingSideOf(event) ?? 'left'
  return {
    ...payload,
    activeSide: side,
    segmentStartedAt: new Date(at).toISOString(),
    pausedAt: undefined,
  }
}

export function isBreastPaused(event: Pick<BabyEvent, 'type' | 'payload' | 'running'>): boolean {
  if (!event.running) return false
  const parsed = payloadSchemas.breast.safeParse(event.payload)
  return parsed.success && Boolean(parsed.data.pausedAt)
}

/** Seconds actually spent at the breast, pauses excluded. */
export function breastFeedingSeconds(
  event: Pick<BabyEvent, 'type' | 'payload' | 'occurredAt' | 'endedAt' | 'running'>,
  now: number = Date.now(),
): number {
  const split = breastSplit(event, now)
  return split.leftSeconds + split.rightSeconds
}

export function startBreastPayload(side: SingleSide, at: string): PayloadOf<'breast'> {
  return {
    side,
    firstSide: side,
    activeSide: side,
    segmentStartedAt: at,
    leftSeconds: 0,
    rightSeconds: 0,
  }
}

/**
 * Closes the running segment and opens one on the other breast.
 * Switching sides implies feeding again, so it also lifts a pause.
 */
export function switchBreastPayload(
  event: Pick<BabyEvent, 'type' | 'payload' | 'occurredAt' | 'endedAt' | 'running'>,
  at: number = Date.now(),
): PayloadOf<'breast'> {
  const split = breastSplit(event, at)
  const current = split.activeSide ?? firstSideOf(event) ?? 'left'
  const next: SingleSide = current === 'left' ? 'right' : 'left'
  return {
    side: 'both',
    firstSide: firstSideOf(event) ?? current,
    activeSide: next,
    segmentStartedAt: new Date(at).toISOString(),
    leftSeconds: round(split.leftSeconds),
    rightSeconds: round(split.rightSeconds),
  }
}

/**
 * Stops the clock without ending the feed — the baby fell asleep and has to be
 * woken up. The accumulated time per side is kept; nothing accrues until
 * somebody resumes.
 */
export function pauseBreastPayload(
  event: Pick<BabyEvent, 'type' | 'payload' | 'occurredAt' | 'endedAt' | 'running'>,
  at: number = Date.now(),
): PayloadOf<'breast'> {
  const split = breastSplit(event, at)
  return {
    side: (event.payload as { side?: Side }).side ?? firstSideOf(event) ?? 'left',
    ...(firstSideOf(event) ? { firstSide: firstSideOf(event) as SingleSide } : {}),
    activeSide: split.activeSide ?? firstSideOf(event) ?? 'left',
    pausedAt: new Date(at).toISOString(),
    leftSeconds: round(split.leftSeconds),
    rightSeconds: round(split.rightSeconds),
  }
}

export function resumeBreastPayload(
  event: Pick<BabyEvent, 'type' | 'payload' | 'occurredAt' | 'endedAt' | 'running'>,
  at: number = Date.now(),
): PayloadOf<'breast'> {
  const split = breastSplit(event, at)
  return {
    side: (event.payload as { side?: Side }).side ?? firstSideOf(event) ?? 'left',
    ...(firstSideOf(event) ? { firstSide: firstSideOf(event) as SingleSide } : {}),
    activeSide: split.activeSide ?? firstSideOf(event) ?? 'left',
    segmentStartedAt: new Date(at).toISOString(),
    leftSeconds: round(split.leftSeconds),
    rightSeconds: round(split.rightSeconds),
  }
}

/** Closes the last segment; the summary side becomes 'both' if both were used. */
export function finishBreastPayload(
  event: Pick<BabyEvent, 'type' | 'payload' | 'occurredAt' | 'endedAt' | 'running'>,
  at: number = Date.now(),
): PayloadOf<'breast'> {
  const parsed = payloadSchemas.breast.safeParse(event.payload)
  const previous = parsed.success ? parsed.data : null
  const split = breastSplit(event, at)
  const first = firstSideOf(event)
  const leftSeconds = round(split.leftSeconds)
  const rightSeconds = round(split.rightSeconds)
  const side: Side =
    leftSeconds > 0 && rightSeconds > 0 ? 'both' : rightSeconds > 0 ? 'right' : 'left'

  return {
    ...previous,
    side,
    ...(first ? { firstSide: first } : {}),
    // Se conserva el lado en el que terminó: es lo que permite reanudar por ese
    // mismo pecho sin tener que deducirlo del reparto de tiempos.
    ...(split.activeSide ? { activeSide: split.activeSide } : {}),
    segmentStartedAt: undefined,
    pausedAt: undefined,
    leftSeconds,
    rightSeconds,
  }
}

/* ---------------------------------------------------------------- sueño --- */

/**
 * Pausar un sueño cierra el tramo en curso; reanudarlo abre otro con el mismo
 * identificador de sesión. Se guardan tramos, y no un evento con agujeros,
 * porque así el anillo de 24 h y la gráfica por horas siguen leyendo intervalos
 * continuos: lo que se dibuja como sueño es sueño.
 *
 * Vale igual para la noche que para una siesta partida de media mañana.
 */
export function isSleepPaused(event: Pick<BabyEvent, 'type' | 'payload' | 'running'>): boolean {
  if (event.type !== 'sleep' || event.running) return false
  return (event.payload as { paused?: unknown }).paused === true
}

/** El tramo pausado que sigue esperando a que la reanuden, si lo hay. */
export function pausedSleep(events: BabyEvent[]): BabyEvent | null {
  let best: BabyEvent | null = null
  for (const event of events) {
    if (event.deletedAt || !isSleepPaused(event)) continue
    if (!best || Date.parse(event.endedAt ?? event.occurredAt) > Date.parse(best.endedAt ?? best.occurredAt)) {
      best = event
    }
  }
  if (!best) return null
  // Si después del tramo pausado ya hay otro sueño de la misma sesión, la
  // pausa se reanudó: lo que manda es el último tramo.
  const session = sessionIdOf(best)
  const cerrado = events.some(
    (e) =>
      !e.deletedAt &&
      e.type === 'sleep' &&
      e.id !== best?.id &&
      sessionIdOf(e) === session &&
      Date.parse(e.occurredAt) >= Date.parse(best?.endedAt ?? best?.occurredAt ?? ''),
  )
  return cerrado ? null : best
}

export function sessionIdOf(event: Pick<BabyEvent, 'payload'>): string | null {
  const value = (event.payload as { sessionId?: unknown }).sessionId
  return typeof value === 'string' ? value : null
}

/** Cierra el tramo por pausa, asegurando que la sesión tenga identificador. */
export function pauseSleepPayload(
  event: Pick<BabyEvent, 'id' | 'payload'>,
): PayloadOf<'sleep'> {
  const previous = (event.payload ?? {}) as PayloadOf<'sleep'>
  return { ...previous, sessionId: sessionIdOf(event) ?? event.id, paused: true }
}

/** El payload del tramo nuevo al reanudar: misma sesión, sin marca de pausa. */
export function resumeSleepPayload(previous: BabyEvent): PayloadOf<'sleep'> {
  const anterior = (previous.payload ?? {}) as PayloadOf<'sleep'>
  return {
    ...anterior,
    sessionId: sessionIdOf(previous) ?? previous.id,
    paused: undefined,
  }
}

/** Cierra la sesión entera: el tramo pausado deja de estarlo. */
export function closeSleepPayload(previous: BabyEvent): PayloadOf<'sleep'> {
  const anterior = (previous.payload ?? {}) as PayloadOf<'sleep'>
  return { ...anterior, paused: undefined }
}

function round(seconds: number): number {
  return Math.round(seconds)
}

/**
 * An interval event with no end is, by definition, still going.
 *
 * Without this there is a third state — not running and never finished — that
 * a sleep saved from the form used to land in: invisible on the home screen
 * and worth zero minutes in the statistics. Every write goes through here so
 * the state cannot be reached from any path.
 */
export function normaliseTimedEvent(event: BabyEvent, now: number = Date.now()): BabyEvent {
  if (!isTimedType(event.type) || event.deletedAt) return event

  // Finished means finished, whatever the flag says.
  if (event.endedAt) return event.running ? { ...event, running: false } : event
  if (event.running) return event

  const running: BabyEvent = { ...event, running: true }
  if (event.type !== 'breast') return running

  // A feed that becomes live needs an open segment, or its clock never moves.
  const parsed = payloadSchemas.breast.safeParse(event.payload)
  if (!parsed.success) return running
  const payload = parsed.data
  if (payload.activeSide || payload.pausedAt) return running

  const side: SingleSide =
    payload.firstSide ?? (payload.side === 'both' ? 'left' : (payload.side as SingleSide))
  const alreadyCounted = (payload.leftSeconds ?? 0) + (payload.rightSeconds ?? 0)

  return {
    ...running,
    payload: {
      ...payload,
      firstSide: payload.firstSide ?? side,
      activeSide: side,
      // Minutes typed by hand are already accounted for; the open segment
      // starts now so they are not counted twice.
      segmentStartedAt: alreadyCounted > 0 ? new Date(now).toISOString() : event.occurredAt,
    },
  }
}

/**
 * Corrects when something actually started — she fell asleep at 14:30 and you
 * only remembered to press the button at 15:10.
 *
 * For a feed the correction is not just a timestamp: the minutes you are
 * adding were spent at the breast, so they go to the side she started on. If
 * the open segment is still the first one, moving it with the start is the
 * same thing and keeps the payload simpler.
 */
export function withShiftedStart(
  event: Pick<BabyEvent, 'type' | 'payload' | 'occurredAt' | 'endedAt' | 'running'>,
  newStartMs: number,
): { occurredAt: string; payload: Record<string, unknown> } {
  const oldStartMs = Date.parse(event.occurredAt)
  const occurredAt = new Date(newStartMs).toISOString()
  if (event.type !== 'breast' || newStartMs === oldStartMs) {
    return { occurredAt, payload: event.payload }
  }

  const parsed = payloadSchemas.breast.safeParse(event.payload)
  if (!parsed.success) return { occurredAt, payload: event.payload }
  const payload = parsed.data

  const segmentStartedAt = payload.segmentStartedAt
    ? Date.parse(payload.segmentStartedAt)
    : null
  if (segmentStartedAt !== null && Math.abs(segmentStartedAt - oldStartMs) < 1000) {
    return {
      occurredAt,
      payload: { ...payload, segmentStartedAt: occurredAt },
    }
  }

  const addedSeconds = (oldStartMs - newStartMs) / 1000
  const first: SingleSide =
    payload.firstSide ?? (payload.side === 'both' ? 'left' : (payload.side as SingleSide))
  const leftSeconds = round(Math.max(0, (payload.leftSeconds ?? 0) + (first === 'left' ? addedSeconds : 0)))
  const rightSeconds = round(
    Math.max(0, (payload.rightSeconds ?? 0) + (first === 'right' ? addedSeconds : 0)),
  )

  return { occurredAt, payload: { ...payload, leftSeconds, rightSeconds } }
}

export const EVENT_LABELS: Record<EventType, string> = {
  breast: 'Pecho',
  bottle: 'Biberón',
  pump: 'Extracción',
  sleep: 'Sueño',
  wakeup: 'En pie',
  diaper: 'Pañal',
  temperature: 'Temperatura',
  weight: 'Peso',
  height: 'Talla',
  head: 'P. cefálico',
  medication: 'Medicación',
  note: 'Nota',
}

export const SIDE_LABELS: Record<Side, string> = {
  left: 'Izquierdo',
  right: 'Derecho',
  both: 'Ambos',
}
