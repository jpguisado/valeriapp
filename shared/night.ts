import { durationSeconds, type BabyEvent } from './events.js'
import { subtractIntervals } from './stats.js'
import { toInstant } from './time.js'

/**
 * La noche, entendida como el rato en que duerme la casa.
 *
 * El envoltorio no marca cuándo se duerme la bebé —eso no lo sabe nadie, y
 * menos quien está dormido a su lado— sino cuándo os acostáis y cuándo os
 * dais por levantados. Los dos son momentos que una persona conoce y puede
 * pulsar, que es más de lo que se podía decir del modelo anterior.
 *
 * Dentro hay un único evento de sueño. Lo que realmente durmió se calcula al
 * leerlo, restando los intervalos que apuntasteis: tomas, ratos en pie, y
 * cualquier sueño que registrarais a mano ahí dentro. Nada se materializa, así
 * que corregir un borde recoloca la noche entera sin tocar lo guardado.
 */

/** Lo que resta del sueño de la noche: si tiene duración, no dormía. */
const SUBTRACTS: ReadonlySet<string> = new Set(['breast', 'wakeup', 'sleep', 'bottle'])

/** El evento de sueño que envuelve una noche, frente a una siesta a mano. */
export function isNightWrapper(event: BabyEvent): boolean {
  return event.type === 'sleep' && (event.payload as { night?: unknown }).night === true
}

/** La noche abierta, si la hay: sirve para no crear dos desde dos móviles. */
export function openNight(events: BabyEvent[]): BabyEvent | null {
  for (const event of events) {
    if (event.deletedAt || !isNightWrapper(event)) continue
    if (event.running) return event
  }
  return null
}

/** La noche en curso o, si no la hay, la última cerrada. */
export function lastNight(events: BabyEvent[]): BabyEvent | null {
  let best: BabyEvent | null = null
  for (const event of events) {
    if (event.deletedAt || !isNightWrapper(event)) continue
    if (!best || toInstant(event.occurredAt) > toInstant(best.occurredAt)) best = event
  }
  return best
}

/** Se sabe que esa noche se escapó algo, aunque no se sepa qué. */
export function isDoubtful(event: BabyEvent): boolean {
  return (event.payload as { doubtful?: unknown }).doubtful === true
}

/**
 * Los intervalos de dentro de la noche que no fueron sueño.
 *
 * Un evento puntual —un pañal, una medicación— no resta: si estuvisteis un
 * rato largo en pie, eso se apunta como rato en pie y el pañal cae dentro.
 * Descontar diez minutos por cada pañal sería la app afirmando algo que no
 * sabe, que es justo lo que hizo inservible el modo anterior.
 */
export function awakeIntervals(
  events: BabyEvent[],
  night: BabyEvent,
  now: number,
): Array<{ start: number; end: number }> {
  const from = toInstant(night.occurredAt)
  const to = night.endedAt ? toInstant(night.endedAt) : now

  return events
    .filter((event) => !event.deletedAt && event.id !== night.id && SUBTRACTS.has(event.type))
    .map((event) => {
      const start = toInstant(event.occurredAt)
      const end = event.endedAt ? toInstant(event.endedAt) : event.running ? now : start
      return { start, end }
    })
    .filter((range) => range.end > range.start && range.end > from && range.start < to)
}

/** Lo que durmió esa noche: el envoltorio menos lo que apuntasteis dentro. */
export function nightSleepSeconds(
  events: BabyEvent[],
  night: BabyEvent,
  now: number = Date.now(),
): number {
  const from = toInstant(night.occurredAt)
  const to = night.endedAt ? toInstant(night.endedAt) : now
  const pieces = subtractIntervals(from, to, awakeIntervals(events, night, now))
  return pieces.reduce((total, piece) => total + (piece.end - piece.start) / 1000, 0)
}

/**
 * La racha más larga sin necesitaros.
 *
 * Es el único número de la noche que no es una estimación: sale de los
 * eventos que sí registráis con certeza, porque son los momentos en que os
 * llamó. Por eso es el que se enseña arriba.
 */
export function longestStretchSeconds(
  events: BabyEvent[],
  night: BabyEvent,
  now: number = Date.now(),
): number {
  const from = toInstant(night.occurredAt)
  const to = night.endedAt ? toInstant(night.endedAt) : now
  const pieces = subtractIntervals(from, to, awakeIntervals(events, night, now))
  return pieces.reduce((best, piece) => Math.max(best, (piece.end - piece.start) / 1000), 0)
}

/** Cuánto lleva abierta una noche que nadie ha cerrado. */
export function nightOpenSeconds(night: BabyEvent, now: number = Date.now()): number {
  return Math.max(0, (now - toInstant(night.occurredAt)) / 1000)
}

export { durationSeconds }
