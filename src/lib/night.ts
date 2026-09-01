/**
 * El modo "A dormir" del lado del cliente: arrancar la noche, cerrarla y
 * mantener la cadena de tramos cada vez que ocurre algo que la despierta.
 *
 * Todo pasa por `saveEvent`, que es el único sitio por donde se escribe, así
 * que la cadena se mantiene sola venga el evento de donde venga: del selector,
 * del formulario, de un temporizador o de una corrección.
 */
import {
  activeNightId,
  awaitingOf,
  interruptsNight,
  sleepSessionId,
  planNightAdjustment,
  runningNightSleep,
  segmentAwaiting,
  segmentsOfNight,
} from '@shared/night'
import { deviceTimezone } from '@shared/time'
import type { BabyEvent } from '@shared/events'
import { db, type StoredEvent } from './db'
import { announceFailure } from './feedback'
import { saveEvent } from './sync'
import { toast } from './toast'

async function eventsOf(babyId: string): Promise<BabyEvent[]> {
  const rows = await db.events.where('babyId').equals(babyId).toArray()
  return rows.filter((row) => !row.deletedAt)
}

function newSleep(
  babyId: string,
  createdBy: string,
  at: number,
  sessionId: string,
  id?: string,
): StoredEvent {
  const stamp = new Date().toISOString()
  return {
    id: id ?? crypto.randomUUID(),
    babyId,
    type: 'sleep',
    occurredAt: new Date(at).toISOString(),
    endedAt: null,
    tz: deviceTimezone(),
    running: true,
    estimated: false,
    payload: { sessionId, inferred: true },
    note: null,
    createdBy,
    createdAt: stamp,
    updatedAt: stamp,
    deletedAt: null,
  }
}

/** Desde ahora se considera que duerme. */
export async function startNight(babyId: string, createdBy: string): Promise<void> {
  const events = await eventsOf(babyId)
  if (activeNightId(events)) {
    toast('La noche ya está en marcha')
    return
  }

  const sessionId = crypto.randomUUID()
  // Si ya había una siesta corriendo, se adopta: es la misma bebé durmiendo.
  const ongoing = events.find((event) => event.type === 'sleep' && event.running)
  try {
    if (ongoing) {
      await saveEvent({
        ...ongoing,
        payload: { ...(ongoing.payload as object), sessionId, inferred: true },
      })
    } else {
      await saveEvent(newSleep(babyId, createdBy, Date.now(), sessionId))
    }
  } catch {
    announceFailure('No se pudo empezar la noche')
    return
  }
  toast('A dormir · se contará como sueño salvo lo que anotes')
}

/** Cierra la noche y da por buenos todos sus tramos. */
export async function endNight(babyId: string): Promise<void> {
  const events = await eventsOf(babyId)
  const sessionId = activeNightId(events)
  if (!sessionId) return

  const now = Date.now()
  for (const segment of segmentsOfNight(events, sessionId)) {
    const payload = { ...(segment.payload as Record<string, unknown>) }
    delete payload.inferred
    delete payload.awaiting
    await saveEvent({
      ...segment,
      running: false,
      endedAt: segment.endedAt ?? new Date(Math.max(now, Date.parse(segment.occurredAt))).toISOString(),
      payload,
    })
  }
  toast('Buenos días · la noche queda confirmada')
}

/**
 * Ajusta la cadena de sueño cuando se guarda algo que la despierta.
 *
 * Se llama desde `saveEvent`, después de escribir el evento, y es deliberadamente
 * silenciosa: si la noche no está en marcha no hace nada.
 */
export async function reconcileNight(event: BabyEvent, settleMinutes: number): Promise<void> {
  if (event.type === 'sleep') return
  const events = await eventsOf(event.babyId)
  if (!activeNightId(events)) return

  // Lo que estaba esperando a que terminase este evento ya puede reanudarse.
  const waiting = segmentAwaiting(events, event.id)
  if (waiting && (event.endedAt || !event.running)) {
    const plan = planNightAdjustment(waiting, event, settleMinutes)
    const payload = { ...(waiting.payload as Record<string, unknown>) }
    delete payload.awaiting
    await saveEvent({ ...waiting, payload })
    if (plan?.resumeAt != null) {
      await saveEvent(
        newSleep(
          event.babyId,
          event.createdBy,
          plan.resumeAt,
          sleepSessionId(waiting) as string,
          plan.nextId,
        ),
      )
    }
    return
  }

  if (!interruptsNight(event)) return
  const sleeping = runningNightSleep(events)
  if (!sleeping) return

  const plan = planNightAdjustment(sleeping, event, settleMinutes)
  if (!plan) return

  const sessionId = sleepSessionId(sleeping) as string
  const payload = { ...(sleeping.payload as Record<string, unknown>) }
  if (plan.resumeAt === null) payload.awaiting = event.id

  await saveEvent({
    ...sleeping,
    running: false,
    endedAt: new Date(Math.max(plan.closeAt, Date.parse(sleeping.occurredAt))).toISOString(),
    payload,
  })

  if (plan.resumeAt !== null) {
    await saveEvent(
      newSleep(event.babyId, event.createdBy, plan.resumeAt, sessionId, plan.nextId),
    )
  }
}

export { activeNightId, awaitingOf, sleepSessionId }
