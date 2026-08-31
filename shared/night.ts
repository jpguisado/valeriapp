/**
 * El modo "A dormir": de noche se da por hecho que duerme.
 *
 * En vez de pedir un cronómetro por cada tramo —cuatro o cinco por noche, y
 * justo cuando menos ganas hay de tocar el teléfono—, se marca el principio y
 * el final de la noche y son los eventos que se registran igualmente los que
 * recortan los ratos despiertos.
 *
 * Los tramos son eventos de sueño de verdad desde el primer momento, así que
 * cuentan para las estadísticas y se pueden corregir con las herramientas que
 * ya existen. Nacen marcados como deducidos y dejan de estarlo al dar los
 * buenos días.
 */
import { isTimedType, type BabyEvent, type EventType } from './events.js'
import { toInstant } from './time.js'

/** Minutos de rutina tras un evento antes de darla por dormida otra vez. */
export const DEFAULT_SETTLE_MINUTES = 25

/**
 * Lo que la despierta es lo que obliga a tocarla. La nota la escribes tú y la
 * extracción te la haces tú: ella ni se entera.
 */
const NEVER_WAKES: ReadonlySet<string> = new Set(['note', 'pump', 'sleep'])

export function wakesHer(type: EventType): boolean {
  return !NEVER_WAKES.has(type)
}

/**
 * El identificador del tramo que sigue a un evento se deriva del propio evento.
 *
 * Así los dos móviles calculan el mismo sin hablarse: si los dos reaccionan al
 * mismo pañal de las tres de la mañana, la sincronización funde sus dos tramos
 * en uno en lugar de duplicarlos.
 */
export function derivedEventId(sourceId: string): string {
  const flat = sourceId.replace(/-/g, '')
  const reversed = [...flat].reverse().join('')
  return [
    reversed.slice(0, 8),
    reversed.slice(8, 12),
    `4${reversed.slice(13, 16)}`,
    `8${reversed.slice(17, 20)}`,
    reversed.slice(20, 32),
  ].join('-')
}

export interface NightSegment {
  event: BabyEvent
  nightId: string
}

/** El tramo de sueño abierto de una noche en marcha, si lo hay. */
export function runningNightSleep(events: BabyEvent[]): BabyEvent | null {
  for (const event of events) {
    if (event.deletedAt || event.type !== 'sleep' || !event.running) continue
    if (nightIdOf(event)) return event
  }
  return null
}

export function nightIdOf(event: BabyEvent): string | null {
  if (event.type !== 'sleep') return null
  const value = (event.payload as { nightId?: unknown }).nightId
  return typeof value === 'string' ? value : null
}

export function isInferred(event: BabyEvent): boolean {
  return (event.payload as { inferred?: unknown }).inferred === true
}

export function awaitingOf(event: BabyEvent): string | null {
  const value = (event.payload as { awaiting?: unknown }).awaiting
  return typeof value === 'string' ? value : null
}

/**
 * La noche sigue en marcha mientras haya un tramo abierto o un tramo esperando
 * a que termine lo que la despertó. Sin lo segundo, la noche desaparecería
 * durante cada toma y no habría a qué volver al acabarla.
 */
export function activeNightId(events: BabyEvent[]): string | null {
  let best: BabyEvent | null = null
  for (const event of events) {
    if (event.deletedAt || event.type !== 'sleep') continue
    if (!nightIdOf(event)) continue
    if (!event.running && !awaitingOf(event)) continue
    if (!best || toInstant(event.occurredAt) > toInstant(best.occurredAt)) best = event
  }
  return best ? nightIdOf(best) : null
}

/** El tramo que espera a que termine un evento concreto. */
export function segmentAwaiting(events: BabyEvent[], wakingId: string): BabyEvent | null {
  for (const event of events) {
    if (event.deletedAt || event.type !== 'sleep') continue
    if (awaitingOf(event) === wakingId) return event
  }
  return null
}

/** Cuándo empezó la noche: el primero de sus tramos. */
export function nightStartedAt(events: BabyEvent[], nightId: string): number | null {
  const segments = segmentsOfNight(events, nightId)
  const first = segments[0]
  return first ? toInstant(first.occurredAt) : null
}

/** Lo que ha dormido en la noche, tramos abiertos incluidos. */
export function nightSleepSeconds(
  events: BabyEvent[],
  nightId: string,
  now: number = Date.now(),
): number {
  let seconds = 0
  for (const segment of segmentsOfNight(events, nightId)) {
    const from = toInstant(segment.occurredAt)
    const to = segment.endedAt ? toInstant(segment.endedAt) : segment.running ? now : from
    seconds += Math.max(0, (to - from) / 1000)
  }
  return seconds
}

/** Todos los tramos de una noche, en orden. */
export function segmentsOfNight(events: BabyEvent[], nightId: string): BabyEvent[] {
  return events
    .filter((event) => !event.deletedAt && nightIdOf(event) === nightId)
    .sort((a, b) => toInstant(a.occurredAt) - toInstant(b.occurredAt))
}

export interface NightAdjustment {
  /** Hasta cuándo se acorta el tramo abierto. */
  closeAt: number
  /** Cuándo vuelve a dormirse, o null si el evento sigue en curso. */
  resumeAt: number | null
  /** Identificador determinista del tramo siguiente. */
  nextId: string
}

/**
 * Qué hacer con el sueño cuando ocurre algo que la despierta.
 *
 * Un desvelo dice explícitamente cuándo se volvió a dormir, así que no lleva
 * cola: sumársela contaría dos veces la misma vuelta a la cama.
 */
export function planNightAdjustment(
  sleep: BabyEvent,
  waking: BabyEvent,
  settleMinutes: number = DEFAULT_SETTLE_MINUTES,
): NightAdjustment | null {
  const sleepStart = toInstant(sleep.occurredAt)
  const wakingStart = toInstant(waking.occurredAt)
  if (wakingStart < sleepStart) return null

  const wakingEnd = waking.endedAt ? toInstant(waking.endedAt) : waking.running ? null : wakingStart
  const tail = waking.type === 'wakeup' ? 0 : settleMinutes * 60_000

  return {
    closeAt: wakingStart,
    resumeAt: wakingEnd === null ? null : wakingEnd + tail,
    nextId: derivedEventId(waking.id),
  }
}

/** Un evento que corta el sueño de una noche en marcha. */
export function interruptsNight(event: BabyEvent): boolean {
  if (event.deletedAt) return false
  if (event.type === 'sleep') return false
  if (!wakesHer(event.type) && event.type !== 'wakeup') return false
  // Lo que dura y sigue abierto todavía no puede reanudar nada.
  return !isTimedType(event.type) || Boolean(event.endedAt) || Boolean(event.running)
}
