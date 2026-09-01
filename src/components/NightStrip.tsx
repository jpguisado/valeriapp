import type { BabyEvent } from '@shared/events'
import { activeNightId, nightSleepSeconds, nightStartedAt } from '@shared/night'
import { clock, duration } from '@/lib/format'
import { endNight } from '@/lib/night'
import { Sunrise } from './icons'

/**
 * La franja de la noche: dice desde cuándo dura, cuánto lleva dormida y qué
 * significa tener el modo puesto. También es por donde se sale de él, porque
 * es lo que estás mirando cuando decides que ya es de día.
 */
export function NightStrip({
  events,
  babyId,
  timezone,
  now,
}: {
  events: BabyEvent[]
  babyId: string
  timezone: string
  now: number
}) {
  const sessionId = activeNightId(events)
  if (!sessionId) return null

  const since = nightStartedAt(events, sessionId)
  const slept = nightSleepSeconds(events, sessionId, now)

  return (
    <section className="night-strip">
      <div className="grow col" style={{ gap: 1 }}>
        <span className="row" style={{ gap: 8 }}>
          <strong>Noche desde las {since === null ? '—' : clock(since, timezone)}</strong>
          <span className="dim small">· {duration(slept)} dormida</span>
        </span>
        <span className="tiny faint">Se cuenta como sueño salvo lo que anotes</span>
      </div>
      <button className="btn" onClick={() => void endNight(babyId)}>
        <Sunrise size={17} /> Buenos días
      </button>
    </section>
  )
}
