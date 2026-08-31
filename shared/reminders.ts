/**
 * Reminder definitions and the pure logic that decides whether one is due.
 * Shared so the settings screen and the server scheduler can never disagree.
 */
import { firstSideOf, payloadOf, type BabyEvent } from './events.js'
import { ageInMonths, toInstant, type DayKey } from './time.js'

export const REMINDER_TYPES = [
  'feed',
  'breast_alternation',
  'diaper_wet',
  'diaper_poo',
  'pump',
  'daily_summary',
] as const

export type ReminderType = (typeof REMINDER_TYPES)[number]

export interface ReminderConfig {
  enabled: boolean
  /** Minutes without the tracked event before the reminder fires. */
  thresholdMinutes: number
  /** Local time HH:mm, only used by daily_summary. */
  atTime?: string
}

export type ReminderSettings = Record<ReminderType, ReminderConfig>

export const REMINDER_LABELS: Record<ReminderType, string> = {
  feed: 'Aviso de toma',
  breast_alternation: 'Alternancia de pecho',
  diaper_wet: 'Pañal mojado',
  diaper_poo: 'Deposición',
  pump: 'Extracción',
  daily_summary: 'Resumen del día',
}

export const REMINDER_DESCRIPTIONS: Record<ReminderType, string> = {
  feed: 'Avisa cuando pasa demasiado tiempo desde la última toma.',
  breast_alternation: 'Avisa si dos tomas seguidas han sido del mismo pecho.',
  diaper_wet: 'Avisa si lleva demasiado tiempo sin un pañal mojado.',
  diaper_poo: 'Avisa si lleva demasiado tiempo sin hacer caca.',
  pump: 'Recordatorio periódico para sacarte leche.',
  daily_summary: 'Un resumen de lo registrado, una vez al día.',
}

/** Feed interval that suits the baby's age, in minutes. */
export function defaultFeedIntervalMinutes(ageMonths: number): number {
  if (ageMonths < 3) return 180
  if (ageMonths < 6) return 240
  return 300
}

export function defaultSettings(ageMonths = 0): ReminderSettings {
  return {
    feed: { enabled: true, thresholdMinutes: defaultFeedIntervalMinutes(ageMonths) },
    breast_alternation: { enabled: true, thresholdMinutes: 0 },
    diaper_wet: { enabled: true, thresholdMinutes: 360 },
    diaper_poo: { enabled: true, thresholdMinutes: 2880 },
    pump: { enabled: false, thresholdMinutes: 180 },
    daily_summary: { enabled: false, thresholdMinutes: 0, atTime: '22:00' },
  }
}

export interface DueReminder {
  type: ReminderType
  title: string
  body: string
  /**
   * Identifies this particular firing. While it stays the same the reminder
   * has already been delivered and must not fire again; it changes as soon as
   * the awaited event is recorded.
   */
  triggerKey: string
}

interface EvaluateInput {
  babyName: string
  birthDate: DayKey
  events: BabyEvent[]
  settings: ReminderSettings
  now: number
}

function lastOf(events: BabyEvent[], types: string[], now: number): BabyEvent | null {
  let best: BabyEvent | null = null
  for (const event of events) {
    if (event.deletedAt) continue
    if (!types.includes(event.type)) continue
    const ts = toInstant(event.occurredAt)
    if (ts > now) continue
    if (!best || ts > toInstant(best.occurredAt)) best = event
  }
  return best
}

function minutesSince(event: BabyEvent | null, now: number): number | null {
  if (!event) return null
  const end = event.endedAt ? toInstant(event.endedAt) : toInstant(event.occurredAt)
  return (now - end) / 60_000
}

function humanMinutes(minutes: number): string {
  const total = Math.round(minutes)
  const hours = Math.floor(total / 60)
  const rest = total % 60
  if (hours === 0) return `${rest} min`
  if (rest === 0) return `${hours} h`
  return `${hours} h ${rest} min`
}

/**
 * Pure evaluation: which reminders are due right now for one baby.
 * Delivery, deduplication and quiet hours are the caller's business.
 */
export function evaluateReminders(input: EvaluateInput): DueReminder[] {
  const { babyName, birthDate, events, settings, now } = input
  const due: DueReminder[] = []
  const ageMonths = ageInMonths(birthDate, now)

  const feedConfig = settings.feed
  if (feedConfig?.enabled) {
    const threshold = feedConfig.thresholdMinutes || defaultFeedIntervalMinutes(ageMonths)
    const lastFeed = lastOf(events, ['breast', 'bottle'], now)
    const elapsed = minutesSince(lastFeed, now)
    const running = lastFeed?.running === true
    if (!running && elapsed !== null && elapsed >= threshold) {
      due.push({
        type: 'feed',
        title: `${babyName}: toca comer`,
        body: `Han pasado ${humanMinutes(elapsed)} desde la última toma.`,
        triggerKey: `feed:${lastFeed?.id ?? 'none'}`,
      })
    }
  }

  const alternationConfig = settings.breast_alternation
  if (alternationConfig?.enabled) {
    const breastFeeds = events
      .filter((e) => !e.deletedAt && e.type === 'breast' && toInstant(e.occurredAt) <= now)
      .sort((a, b) => toInstant(b.occurredAt) - toInstant(a.occurredAt))
      .slice(0, 2)
    const [latest, previous] = breastFeeds
    // What alternation is about is which breast the feed *started* on: a feed
    // that switched sides already balanced itself.
    const latestSide = latest ? firstSideOf(latest) : null
    const previousSide = previous ? firstSideOf(previous) : null
    if (latest && previous && latestSide && latestSide === previousSide && !latest.running) {
      const sideName = latestSide === 'left' ? 'izquierdo' : 'derecho'
      due.push({
        type: 'breast_alternation',
        title: `${babyName}: alterna el pecho`,
        body: `Las dos últimas tomas han empezado por el pecho ${sideName}.`,
        triggerKey: `alternation:${latest.id}`,
      })
    }
  }

  const wetConfig = settings.diaper_wet
  if (wetConfig?.enabled) {
    const lastWet = lastOf(
      events.filter((e) => {
        const payload = payloadOf(e, 'diaper')
        return payload ? payload.kind === 'pee' || payload.kind === 'mixed' : false
      }),
      ['diaper'],
      now,
    )
    const elapsed = minutesSince(lastWet, now)
    if (elapsed !== null && elapsed >= wetConfig.thresholdMinutes) {
      due.push({
        type: 'diaper_wet',
        title: `${babyName}: sin pañal mojado`,
        body: `Lleva ${humanMinutes(elapsed)} sin mojar el pañal.`,
        triggerKey: `wet:${lastWet?.id ?? 'none'}`,
      })
    }
  }

  const pooConfig = settings.diaper_poo
  if (pooConfig?.enabled) {
    const lastPoo = lastOf(
      events.filter((e) => {
        const payload = payloadOf(e, 'diaper')
        return payload ? payload.kind === 'poo' || payload.kind === 'mixed' : false
      }),
      ['diaper'],
      now,
    )
    const elapsed = minutesSince(lastPoo, now)
    if (elapsed !== null && elapsed >= pooConfig.thresholdMinutes) {
      due.push({
        type: 'diaper_poo',
        title: `${babyName}: sin deposición`,
        body: `Lleva ${humanMinutes(elapsed)} sin hacer caca.`,
        triggerKey: `poo:${lastPoo?.id ?? 'none'}`,
      })
    }
  }

  const pumpConfig = settings.pump
  if (pumpConfig?.enabled) {
    const lastPump = lastOf(events, ['pump'], now)
    const elapsed = minutesSince(lastPump, now)
    if (elapsed !== null && elapsed >= pumpConfig.thresholdMinutes) {
      due.push({
        type: 'pump',
        title: 'Toca extracción',
        body: `Han pasado ${humanMinutes(elapsed)} desde la última.`,
        triggerKey: `pump:${lastPump?.id ?? 'none'}`,
      })
    }
  }

  return due
}
