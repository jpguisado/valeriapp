import { useMemo, type ReactNode } from 'react'
import { breastSplit, firstSideOf, payloadOf, type BabyEvent, type EventType } from '@shared/events'
import { longestStretchSeconds, nightSleepSeconds, openNight } from '@shared/night'
import { computeDailyStats, lastEventOfType } from '@shared/stats'
import { dayKeyOf, type TimezoneSetting } from '@shared/time'
import { ago, celsius, clock, duration, grams, hours } from '@/lib/format'
import { EVENT_ACCENTS } from './event-meta'
import { EventIcon } from './icons'

interface Props {
  events: BabyEvent[]
  timezone: TimezoneSetting
  now: number
}

/**
 * The answer to "when did she last eat?" without scrolling, tapping or
 * thinking. Everything else on the home screen is secondary to this block.
 */
export function StatusHeader({ events, timezone, now }: Props) {
  const tz = timezone.fixed
  const today = dayKeyOf(now, tz)

  const data = useMemo(() => {
    const [stats] = computeDailyStats(events, today, today, { timezone }, now)
    const feeds = events.filter((event) => event.type === 'breast' || event.type === 'bottle')
    return {
      stats,
      lastFeed: feeds[0] ?? null,
      lastBreast: lastEventOfType(events, 'breast'),
      runningSleep: events.find((event) => event.type === 'sleep' && event.running) ?? null,
      lastSleep: events.find((event) => event.type === 'sleep' && !event.running) ?? null,
      lastMedication: lastEventOfType(events, 'medication'),
      lastTemperature: lastEventOfType(events, 'temperature'),
      lastWeight: lastEventOfType(events, 'weight'),
    }
  }, [events, today, timezone, now])

  const temperature = data.lastTemperature ? payloadOf(data.lastTemperature, 'temperature') : null
  const fever =
    temperature &&
    now - Date.parse(data.lastTemperature!.occurredAt) < 12 * 3_600_000 &&
    temperature.celsius >= 38

  const sleepValue = data.runningSleep
    ? duration((now - Date.parse(data.runningSleep.occurredAt)) / 1000)
    : data.lastSleep
      ? ago(data.lastSleep.endedAt ?? data.lastSleep.occurredAt, now)
      : '—'

  const noche = openNight(events)
  const diapers = data.stats?.diapers
  const medication = data.lastMedication ? payloadOf(data.lastMedication, 'medication') : null

  return (
    <>
      <div className="status-grid">
        <Item
          type={data.lastFeed?.type ?? 'breast'}
          label="Última toma"
          value={data.lastFeed ? ago(data.lastFeed.occurredAt, now) : 'Sin registros'}
          detail={
            data.lastFeed
              ? `${clock(data.lastFeed.occurredAt, tz)}${feedDetail(data.lastFeed, data.lastBreast, now)}`
              : 'Aún nada hoy'
          }
        />
        <Item
          type="sleep"
          label={noche ? 'Del tirón' : data.runningSleep ? 'Durmiendo' : 'Último sueño'}
          /* De noche manda la racha más larga: es lo único que no es
             estimación, porque sale de los momentos en que os llamó. */
          value={noche ? duration(longestStretchSeconds(events, noche, now)) : sleepValue}
          detail={
            noche
              ? `${hours(nightSleepSeconds(events, noche, now))} estimadas`
              : data.runningSleep
                ? `desde las ${clock(data.runningSleep.occurredAt, tz)}`
                : data.stats
                  ? `${hours(data.stats.sleepSeconds)} hoy`
                  : undefined
          }
        />
        <Item
          type="diaper"
          label="Pañales hoy"
          value={String(diapers?.total ?? 0)}
          detail={
            diapers && diapers.total > 0
              ? `${diapers.pee + diapers.mixed} pis · ${diapers.poo + diapers.mixed} caca`
              : 'Ninguno todavía'
          }
        />
        <Item
          type="bottle"
          label="Tomas hoy"
          value={String(data.stats?.feeds ?? 0)}
          detail={
            data.stats && data.stats.bottleMl + data.stats.supplementMl > 0
              ? `${Math.round(data.stats.bottleMl + data.stats.supplementMl)} ml de leche`
              : data.lastFeed
                ? `Última ${clock(data.lastFeed.occurredAt, tz)}`
                : 'Aún nada hoy'
          }
        />
      </div>

      {fever && (
        <p className="banner warn">
          <span style={{ color: 'var(--temperature)', display: 'flex', flex: 'none' }}>
            <EventIcon type="temperature" size={17} />
          </span>
          <span>
            {celsius(temperature.celsius)} a las {clock(data.lastTemperature!.occurredAt, tz)}
          </span>
        </p>
      )}

      {(medication || data.lastWeight) && (
        <div className="row wrap tiny faint" style={{ gap: 14, padding: '0 4px' }}>
          {medication && (
            <span className="row" style={{ gap: 6 }}>
              <span style={{ color: EVENT_ACCENTS.medication, display: 'flex' }}>
                <EventIcon type="medication" size={14} />
              </span>
              {medication.name}
              {medication.dose ? ` · ${medication.dose}` : ''} · {ago(data.lastMedication!.occurredAt, now)}
            </span>
          )}
          {data.lastWeight && (
            <span className="row" style={{ gap: 6 }}>
              <span style={{ color: EVENT_ACCENTS.weight, display: 'flex' }}>
                <EventIcon type="weight" size={14} />
              </span>
              {grams(payloadOf(data.lastWeight, 'weight')?.grams ?? null)}
            </span>
          )}
        </div>
      )}
    </>
  )
}

function Item({
  type,
  label,
  value,
  detail,
}: {
  type: EventType
  label: string
  value: string
  detail?: ReactNode
}) {
  return (
    <div className="status-item">
      <span className="label">
        <span style={{ color: EVENT_ACCENTS[type], display: 'flex' }}>
          <EventIcon type={type} size={14} strokeWidth={2.2} />
        </span>
        {label}
      </span>
      <span className="value">{value}</span>
      {detail && <span className="tiny faint">{detail}</span>}
    </div>
  )
}

/** " · pecho izq→der" when the last feed was at the breast. */
function feedDetail(lastFeed: BabyEvent, lastBreast: BabyEvent | null, now: number): string {
  if (lastFeed.type !== 'breast' || !lastBreast) return ''
  const split = breastSplit(lastBreast, now)
  const first = firstSideOf(lastBreast)
  if (split.leftSeconds > 0 && split.rightSeconds > 0) {
    return first === 'right' ? ' · pecho der→izq' : ' · pecho izq→der'
  }
  return split.rightSeconds > 0 ? ' · pecho derecho' : ' · pecho izquierdo'
}
