import { isNightWrapper, openNight } from '@shared/night'
import type { BabyEvent } from '@shared/events'
import { announceFailure } from './feedback'
import { newEvent, saveEvent } from './sync'

/**
 * Abrir y cerrar la noche. Nada más.
 *
 * La versión anterior de este fichero se enganchaba a `saveEvent` y creaba o
 * movía eventos por su cuenta cada vez que se guardaba cualquier cosa. Guardar
 * un pañal podía cerrar un sueño y abrir otro, y deshacerlo a las tres de la
 * mañana costaba borrar cuatro eventos a mano. Ahora guardar un evento guarda
 * ese evento y ya.
 */

/** "Nos acostamos": un único evento de sueño que envuelve la noche. */
export async function startNight(
  babyId: string,
  createdBy: string,
  events: BabyEvent[],
): Promise<BabyEvent | null> {
  // Si el otro móvil ya la abrió, no se abre otra: contarían las dos.
  const abierta = openNight(events)
  if (abierta) return abierta

  const night = newEvent({
    babyId,
    type: 'sleep',
    running: true,
    createdBy,
    payload: { night: true },
  })
  try {
    await saveEvent(night)
  } catch {
    announceFailure()
    return null
  }
  return night
}

/** "Ya estamos en pie". El borde se puede corregir después. */
export async function endNight(events: BabyEvent[], at: number = Date.now()): Promise<void> {
  const abierta = openNight(events)
  if (!abierta) return
  try {
    await saveEvent({
      ...abierta,
      running: false,
      endedAt: new Date(Math.max(at, Date.parse(abierta.occurredAt))).toISOString(),
    })
  } catch {
    announceFailure()
  }
}

/** "De esta noche no me fío": se nos escapó algo y no sabemos qué. */
export async function markDoubtful(night: BabyEvent, doubtful: boolean): Promise<void> {
  if (!isNightWrapper(night)) return
  const payload = { ...(night.payload as Record<string, unknown>) }
  if (doubtful) payload.doubtful = true
  else delete payload.doubtful
  try {
    await saveEvent({ ...night, payload })
  } catch {
    announceFailure()
  }
}
