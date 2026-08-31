/**
 * What each confirmation says.
 *
 * A toast that only says "guardado" is a shrug. These carry the number you
 * would have gone looking for anyway — how many nappies today, how much milk,
 * how long since the last dose — so registering something also answers the
 * question that follows it.
 */
import {
  EVENT_LABELS,
  breastFeedingSeconds,
  durationSeconds,
  payloadOf,
  type BabyEvent,
} from '@shared/events'
import { computeDailyStats } from '@shared/stats'
import { dayKeyOf, toInstant, type TimezoneSetting } from '@shared/time'
import { ago, celsius, clock, cm, duration, grams, hours, ml, number } from './format'
import { vibrate, type Haptic } from './haptics'
import { toast, toastError } from './toast'

export interface FeedbackContext {
  events: BabyEvent[]
  timezone: TimezoneSetting
  now?: number
}

/** The event may not be in the local mirror yet, so merge it in explicitly. */
function withEvent(context: FeedbackContext, event: BabyEvent): BabyEvent[] {
  return [...context.events.filter((candidate) => candidate.id !== event.id), event]
}

function todayStats(context: FeedbackContext, event: BabyEvent) {
  const now = context.now ?? Date.now()
  const today = dayKeyOf(now, context.timezone.fixed)
  const [stats] = computeDailyStats(withEvent(context, event), today, today, {
    timezone: context.timezone,
  }, now)
  return stats
}

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`
}

/** Previous event of the same type, ignoring the one just saved. */
function previousOfType(context: FeedbackContext, event: BabyEvent): BabyEvent | null {
  let best: BabyEvent | null = null
  for (const candidate of context.events) {
    if (candidate.id === event.id || candidate.deletedAt) continue
    if (candidate.type !== event.type) continue
    if (toInstant(candidate.occurredAt) >= toInstant(event.occurredAt)) continue
    if (!best || toInstant(candidate.occurredAt) > toInstant(best.occurredAt)) best = candidate
  }
  return best
}

export function startedMessage(event: BabyEvent): string {
  if (event.type === 'breast') {
    const side = payloadOf(event, 'breast')?.activeSide ?? payloadOf(event, 'breast')?.side
    const name = side === 'right' ? 'derecho' : 'izquierdo'
    return `Pecho iniciado · ${name}`
  }
  if (event.type === 'pump') return 'Extracción iniciada'
  if (event.type === 'wakeup') return 'Desvelo en curso'
  return `${EVENT_LABELS[event.type]} iniciado`
}

export function stoppedMessage(event: BabyEvent, context: FeedbackContext): string {
  const stats = todayStats(context, event)
  if (event.type === 'breast') {
    const minutes = duration(breastFeedingSeconds(event, context.now ?? Date.now()))
    const feeds = stats ? ` · ${plural(stats.feeds, 'toma hoy', 'tomas hoy')}` : ''
    return `Pecho · ${minutes}${feeds}`
  }
  const length = duration(durationSeconds(event) ?? 0)
  if (event.type === 'sleep') {
    const total = stats ? ` · ${hours(stats.sleepSeconds)} hoy` : ''
    return `Sueño · ${length}${total}`
  }
  return `${EVENT_LABELS[event.type]} · ${length}`
}

export function recordedMessage(event: BabyEvent, context: FeedbackContext): string {
  const stats = todayStats(context, event)
  const previous = previousOfType(context, event)

  switch (event.type) {
    case 'breast':
      return stoppedMessage(event, context)

    case 'bottle': {
      const payload = payloadOf(event, 'bottle')
      const feeds = stats ? ` · ${plural(stats.feeds, 'toma hoy', 'tomas hoy')}` : ''
      return `Biberón · ${ml(payload?.ml ?? 0)}${feeds}`
    }

    case 'diaper': {
      const payload = payloadOf(event, 'diaper')
      const kind = payload
        ? { pee: 'pis', poo: 'caca', mixed: 'pis y caca', dry: 'seco' }[payload.kind]
        : ''
      const total = stats ? ` · ${plural(stats.diapers.total, 'pañal hoy', 'pañales hoy')}` : ''
      return `Pañal registrado · ${kind}${total}`
    }

    case 'pump': {
      const payload = payloadOf(event, 'pump')
      const total = stats && stats.pumpMl > 0 ? ` · ${ml(stats.pumpMl)} hoy` : ''
      return `Extracción · ${ml(payload?.ml ?? 0)}${total}`
    }

    case 'temperature': {
      const payload = payloadOf(event, 'temperature')
      const value = celsius(payload?.celsius ?? 0)
      const max = stats?.maxTemperature ?? null
      if (max !== null && payload && max > payload.celsius) {
        return `${value} · máxima hoy ${celsius(max)}`
      }
      return `${value} · máxima de hoy`
    }

    case 'medication': {
      const payload = payloadOf(event, 'medication')
      const name = payload?.name ?? 'Medicación'
      if (!previous) return `${name} registrado`
      return `${name} · anterior ${ago(previous.occurredAt, toInstant(event.occurredAt))}`
    }

    case 'weight': {
      const value = payloadOf(event, 'weight')?.grams ?? 0
      const before = previous ? (payloadOf(previous, 'weight')?.grams ?? null) : null
      if (before === null) return grams(value)
      const delta = value - before
      return `${grams(value)} · ${delta >= 0 ? '+' : '−'}${Math.abs(delta)} g`
    }

    case 'height':
    case 'head': {
      const key = event.type === 'height' ? 'height' : 'head'
      const value = payloadOf(event, key)?.cm ?? 0
      const before = previous ? (payloadOf(previous, key)?.cm ?? null) : null
      if (before === null) return cm(value)
      const delta = value - before
      return `${cm(value)} · ${delta >= 0 ? '+' : '−'}${number(Math.abs(delta), 1)} cm`
    }

    case 'sleep':
    case 'wakeup':
      return stoppedMessage(event, context)

    case 'note':
      return 'Nota guardada'
  }
}

/** Fires the toast and the matching buzz in one call. */
function announce(text: string, haptic: Haptic): void {
  toast(text)
  vibrate(haptic)
}

export function announceStarted(event: BabyEvent): void {
  announce(startedMessage(event), 'start')
}

export function announceStopped(event: BabyEvent, context: FeedbackContext): void {
  announce(stoppedMessage(event, context), 'stop')
}

export function announceRecorded(event: BabyEvent, context: FeedbackContext): void {
  announce(recordedMessage(event, context), 'record')
}

export function announcePaused(paused: boolean): void {
  announce(paused ? 'Toma en pausa' : 'Toma reanudada', 'toggle')
}

export function announceSideSwitch(side: 'left' | 'right'): void {
  announce(`Cambio a ${side === 'left' ? 'izquierdo' : 'derecho'}`, 'toggle')
}

export function announceResumed(): void {
  announce('Toma reanudada', 'start')
}

export function announceEdited(): void {
  announce('Cambios guardados', 'record')
}

export function announceStartMoved(instant: string | number, tz: string): void {
  announce(`Inicio movido a las ${clock(instant, tz)}`, 'record')
}

export function announceDeleted(): void {
  announce('Registro borrado', 'delete')
}

export function announceFailure(text = 'No se pudo guardar'): void {
  toastError(text)
  vibrate('error')
}
