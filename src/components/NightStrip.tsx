import type { BabyEvent } from '@shared/events'
import {
  isDoubtful,
  longestStretchSeconds,
  nightSleepSeconds,
  openNight,
} from '@shared/night'
import { clock, duration } from '@/lib/format'
import { endNight, markDoubtful } from '@/lib/night'
import { CircleHelp, Sunrise } from './icons'

/**
 * La franja de la noche abierta.
 *
 * Arriba, la racha más larga sin necesitaros, que es el único dato de la noche
 * que no es una estimación. Debajo, las horas dormidas, marcadas como lo que
 * son. Y aquí se sale, porque es lo que estás mirando cuando decides que ya es
 * de día.
 */
export function NightStrip({
  events,
  timezone,
  now,
}: {
  events: BabyEvent[]
  timezone: string
  now: number
}) {
  const night = openNight(events)
  if (!night) return null

  const slept = nightSleepSeconds(events, night, now)
  const longest = longestStretchSeconds(events, night, now)
  const dudosa = isDoubtful(night)

  return (
    <section className="night-strip">
      <div className="grow col" style={{ gap: 1 }}>
        <span className="row" style={{ gap: 8 }}>
          <strong>{duration(longest)} del tirón</strong>
          <span className="dim small">· {duration(slept)} estimadas</span>
        </span>
        <span className="tiny faint">
          Desde las {clock(night.occurredAt, timezone)} · todo cuenta como sueño salvo lo
          que anotéis
        </span>
      </div>
      <button
        className="btn"
        aria-pressed={dudosa}
        title="De esta noche no me fío"
        onClick={() => void markDoubtful(night, !dudosa)}
      >
        <CircleHelp size={17} />
      </button>
      <button className="btn" onClick={() => void endNight(events)}>
        <Sunrise size={17} /> Ya estamos en pie
      </button>
    </section>
  )
}
