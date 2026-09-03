import {
  finishBreastPayload,
  finishSleepPayload,
  isSleepPaused,
  reopenSleepPayload,
  sleepPausedAt,
  isBreastPaused,
  isTimedType,
  pauseBreastPayload,
  pauseSleepPayload,
  reopenBreastPayload,
  resumeBreastPayload,
  resumeSleepPayload,
  startBreastPayload,
  switchBreastPayload,
  withShiftedStart,
  type BabyEvent,
  type EventType,
  type SingleSide,
} from '@shared/events'
import { defaultPayload } from '@/components/EventSheet'
import {
  announceFailure,
  announcePaused,
  announceResumed,
  announceSideSwitch,
  announceStarted,
  announceStartMoved,
  announceStopped,
  type FeedbackContext,
} from './feedback'
import { newEvent, saveEvent } from './sync'

/**
 * Timer actions live here so the quick grid and the running-timer card can
 * never disagree about how a feed is started, switched or closed.
 */

export async function startTimer(
  babyId: string,
  type: EventType,
  createdBy: string,
  /** Obligatorio en el pecho: el lado lo elige quien registra, no la app. */
  side?: SingleSide,
): Promise<void> {
  if (!isTimedType(type)) return
  const now = new Date().toISOString()
  const event = newEvent({
    babyId,
    type,
    running: true,
    createdBy,
    payload:
      type === 'breast' ? startBreastPayload(side ?? 'left', now) : defaultPayload(type),
  })
  try {
    await saveEvent(event)
  } catch {
    announceFailure()
    return
  }
  announceStarted(event)
}

export async function stopTimer(
  event: BabyEvent,
  context: FeedbackContext,
  at: number = Date.now(),
): Promise<void> {
  // Parar un sueño en pausa lo cierra donde se despertó: lo de después no fue
  // sueño y no tiene por qué constar como tal.
  const pausadoEn = event.type === 'sleep' ? sleepPausedAt(event) : null
  const fin = pausadoEn ? Date.parse(pausadoEn) : at
  const stopped: BabyEvent = {
    ...event,
    running: false,
    estimated: false,
    endedAt: new Date(fin).toISOString(),
    payload:
      event.type === 'breast'
        ? finishBreastPayload(event, at)
        : event.type === 'sleep'
          ? finishSleepPayload(event)
          : event.payload,
  }
  try {
    await saveEvent(stopped)
  } catch {
    announceFailure()
    return
  }
  announceStopped(stopped, context)
}

/** The baby dozed off: the clock stops, the feed stays open. */
export async function pauseFeed(event: BabyEvent, at: number = Date.now()): Promise<void> {
  if (event.type !== 'breast' || !event.running || isBreastPaused(event)) return
  await saveEvent({ ...event, payload: pauseBreastPayload(event, at) })
  announcePaused(true)
}

export async function resumeFeed(event: BabyEvent, at: number = Date.now()): Promise<void> {
  if (event.type !== 'breast' || !event.running || !isBreastPaused(event)) return
  await saveEvent({ ...event, payload: resumeBreastPayload(event, at) })
  announcePaused(false)
}

/** Se ha despertado a mitad del sueño: el reloj para, el sueño sigue abierto. */
export async function pauseSleep(event: BabyEvent, at: number = Date.now()): Promise<void> {
  if (event.type !== 'sleep' || !event.running || isSleepPaused(event)) return
  await saveEvent({ ...event, payload: pauseSleepPayload(event, at) })
  announcePaused(true)
}

export async function resumeSleep(event: BabyEvent, at: number = Date.now()): Promise<void> {
  if (event.type !== 'sleep' || !event.running || !isSleepPaused(event)) return
  await saveEvent({ ...event, payload: resumeSleepPayload(event, at) })
  announcePaused(false)
}

/** Baby moved to the other breast: same feed, new segment. */
export async function switchSide(event: BabyEvent, at: number = Date.now()): Promise<void> {
  if (event.type !== 'breast' || !event.running) return
  const payload = switchBreastPayload(event, at)
  await saveEvent({ ...event, payload })
  announceSideSwitch(payload.activeSide ?? 'left')
}

/**
 * Corrects the start time of something already recorded, running or not.
 * Clamped so a start can never land in the future or after the end.
 */
export async function adjustStart(
  event: BabyEvent,
  newStartMs: number,
  tz: string,
): Promise<void> {
  const ceiling = event.endedAt ? Date.parse(event.endedAt) : Date.now()
  const clamped = Math.min(newStartMs, ceiling)
  if (clamped === Date.parse(event.occurredAt)) return
  const { occurredAt, payload } = withShiftedStart(event, clamped)
  await saveEvent({ ...event, occurredAt, payload })
  announceStartMoved(occurredAt, tz)
}

/**
 * Reabre una toma o un sueño parados por error. Lo ya contado se conserva; en
 * el pecho, además, se sigue por el lado en el que se había quedado.
 */
export async function resumeSession(event: BabyEvent, at: number = Date.now()): Promise<void> {
  if ((event.type !== 'breast' && event.type !== 'sleep') || event.running) return
  try {
    await saveEvent({
      ...event,
      running: true,
      endedAt: null,
      estimated: false,
      payload:
        event.type === 'breast' ? reopenBreastPayload(event, at) : reopenSleepPayload(event),
    })
  } catch {
    announceFailure()
    return
  }
  announceResumed()
}
