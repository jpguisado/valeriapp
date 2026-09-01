import {
  closeSleepPayload,
  finishBreastPayload,
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
  const stopped: BabyEvent = {
    ...event,
    running: false,
    estimated: false,
    endedAt: new Date(at).toISOString(),
    payload: event.type === 'breast' ? finishBreastPayload(event, at) : event.payload,
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

/**
 * Se ha despertado a mitad del sueño. El tramo se cierra aquí y la sesión
 * queda abierta: lo que venga después es otro tramo de lo mismo, no un sueño
 * nuevo. Sirve igual de noche que en una siesta.
 */
export async function pauseSleep(
  event: BabyEvent,
  at: number = Date.now(),
): Promise<void> {
  if (event.type !== 'sleep' || !event.running) return
  try {
    await saveEvent({
      ...event,
      running: false,
      estimated: false,
      endedAt: new Date(at).toISOString(),
      payload: pauseSleepPayload(event),
    })
  } catch {
    announceFailure()
    return
  }
  announcePaused(true)
}

/** Se ha vuelto a dormir: tramo nuevo, misma sesión. */
export async function resumeSleep(
  paused: BabyEvent,
  createdBy: string,
  at: number = Date.now(),
): Promise<void> {
  const tramo = newEvent({
    babyId: paused.babyId,
    type: 'sleep',
    running: true,
    createdBy,
    payload: resumeSleepPayload(paused),
  })
  tramo.occurredAt = new Date(at).toISOString()
  try {
    await saveEvent(tramo)
    // El tramo anterior deja de estar "en pausa": ya se reanudó.
    await saveEvent({ ...paused, payload: closeSleepPayload(paused) })
  } catch {
    announceFailure()
    return
  }
  announcePaused(false)
}

/** Se acabó la siesta o la noche: la sesión se cierra sin reanudar nada. */
export async function endSleepSession(paused: BabyEvent): Promise<void> {
  try {
    await saveEvent({ ...paused, payload: closeSleepPayload(paused) })
  } catch {
    announceFailure()
  }
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
 * Reabre una toma parada por error, con un segmento nuevo en el pecho en el
 * que se había quedado. Lo ya contado se conserva.
 */
export async function resumeSession(event: BabyEvent, at: number = Date.now()): Promise<void> {
  if (event.type !== 'breast' || event.running) return
  try {
    await saveEvent({
      ...event,
      running: true,
      endedAt: null,
      estimated: false,
      payload: reopenBreastPayload(event, at),
    })
  } catch {
    announceFailure()
    return
  }
  announceResumed()
}
