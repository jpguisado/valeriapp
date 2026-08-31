/**
 * All statistics are derived here, from the same event list the UI holds
 * locally, so they work offline and are unit-testable without a database.
 *
 * Two attribution rules, deliberately different:
 *  - Counts (feeds, diapers…) belong to the day the event *started*.
 *  - Durations (sleep, breast) are clipped at local midnight and split
 *    across the days they actually cover, which is what "hours slept on
 *    Tuesday" means to a human.
 * Night metrics ignore both and use a night window that spans midnight.
 */
import { breastSplit, durationSeconds, payloadOf, type BabyEvent } from './events.js'
import {
  addDays,
  dayKeyOf,
  dayKeysBetween,
  endOfDay,
  startOfDay,
  toInstant,
  zoneFor,
  zonedParts,
  type DayKey,
  type TimezoneSetting,
} from './time.js'

/** Night runs 20:00 → 08:00 next day. */
export const NIGHT_START_MINUTE = 20 * 60
export const NIGHT_END_MINUTE = 8 * 60

export interface DiaperCounts {
  pee: number
  poo: number
  mixed: number
  dry: number
  total: number
  leaks: number
}

export interface SleepBand {
  /** Minutes from local midnight; clipped to [0, 1440]. */
  startMinute: number
  endMinute: number
  running: boolean
  estimated: boolean
}

export interface DailyStats {
  dayKey: DayKey
  feeds: number
  breastFeeds: number
  bottleFeeds: number
  bottleMl: number
  /** Lactancia mixta: el biberón dado dentro de una toma de pecho. */
  supplementMl: number
  pumpMl: number
  pumpSessions: number
  breastSeconds: number
  leftSeconds: number
  rightSeconds: number
  sleepSeconds: number
  daySleepSeconds: number
  nightSleepSeconds: number
  sleepSessions: number
  sleepBands: SleepBand[]
  diapers: DiaperCounts
  medications: number
  notes: number
  maxTemperature: number | null
  temperatures: number[]
  weightGrams: number | null
  heightCm: number | null
  headCm: number | null
  /** True when any duration on this day came from an auto-closed timer. */
  hasEstimates: boolean
}

export interface NightStats {
  /** The day the night started on. */
  dayKey: DayKey
  sleepSeconds: number
  wakings: number
  longestStretchSeconds: number
  /** Minutes from midnight of the first sleep onset, may exceed 1440. */
  firstSleepMinute: number | null
  lastWakeMinute: number | null
}

export interface PeriodSummary {
  from: DayKey
  to: DayKey
  days: number
  totals: {
    feeds: number
    bottleMl: number
    supplementMl: number
    pumpMl: number
    breastSeconds: number
    leftSeconds: number
    rightSeconds: number
    sleepSeconds: number
    diapers: DiaperCounts
    medications: number
  }
  perDay: {
    feeds: number
    bottleMl: number
    milkMl: number
    sleepSeconds: number
    daySleepSeconds: number
    nightSleepSeconds: number
    diapers: number
    nightWakings: number
  }
  averages: {
    mlPerBottle: number | null
    minutesPerBreastFeed: number | null
    minutesBetweenFeeds: number | null
  }
  maxTemperature: number | null
  lastWeightGrams: number | null
  lastHeightCm: number | null
  lastHeadCm: number | null
  hasEstimates: boolean
}

export interface MeasurementPoint {
  dayKey: DayKey
  at: number
  value: number
}

interface Options {
  timezone: TimezoneSetting
}

function emptyDiapers(): DiaperCounts {
  return { pee: 0, poo: 0, mixed: 0, dry: 0, total: 0, leaks: 0 }
}

function emptyDay(dayKey: DayKey): DailyStats {
  return {
    dayKey,
    feeds: 0,
    breastFeeds: 0,
    bottleFeeds: 0,
    bottleMl: 0,
    supplementMl: 0,
    pumpMl: 0,
    pumpSessions: 0,
    breastSeconds: 0,
    leftSeconds: 0,
    rightSeconds: 0,
    sleepSeconds: 0,
    daySleepSeconds: 0,
    nightSleepSeconds: 0,
    sleepSessions: 0,
    sleepBands: [],
    diapers: emptyDiapers(),
    medications: 0,
    notes: 0,
    maxTemperature: null,
    temperatures: [],
    weightGrams: null,
    heightCm: null,
    headCm: null,
    hasEstimates: false,
  }
}

export function liveEvents(events: BabyEvent[]): BabyEvent[] {
  return events.filter((e) => !e.deletedAt)
}

/** End of an event for maths: its end, or now while a timer runs. */
function effectiveEnd(event: BabyEvent, now: number): number {
  if (event.endedAt) return toInstant(event.endedAt)
  if (event.running) return Math.max(now, toInstant(event.occurredAt))
  return toInstant(event.occurredAt)
}

function isNightMinute(minute: number): boolean {
  return minute >= NIGHT_START_MINUTE || minute < NIGHT_END_MINUTE
}

/**
 * Splits an interval into per-day slices in the given zone.
 * Returns [dayKey, seconds, startMinute, endMinute] per touched day.
 */
function sliceByDay(
  startTs: number,
  endTs: number,
  tz: string,
): Array<{ dayKey: DayKey; seconds: number; startMinute: number; endMinute: number }> {
  const slices: Array<{ dayKey: DayKey; seconds: number; startMinute: number; endMinute: number }> = []
  let cursor = startTs
  let guard = 0
  while (cursor < endTs && guard++ < 400) {
    const dayKey = dayKeyOf(cursor, tz)
    const dayEnd = endOfDay(dayKey, tz)
    const sliceEnd = Math.min(endTs, dayEnd)
    const dayStart = startOfDay(dayKey, tz)
    slices.push({
      dayKey,
      seconds: (sliceEnd - cursor) / 1000,
      startMinute: Math.round((cursor - dayStart) / 60_000),
      endMinute: Math.round((sliceEnd - dayStart) / 60_000),
    })
    cursor = sliceEnd
  }
  if (slices.length === 0) {
    const dayKey = dayKeyOf(startTs, tz)
    const dayStart = startOfDay(dayKey, tz)
    const minute = Math.round((startTs - dayStart) / 60_000)
    slices.push({ dayKey, seconds: 0, startMinute: minute, endMinute: minute })
  }
  return slices
}

/** Seconds of an interval that fall inside the night window, in `tz`. */
function nightSecondsOf(startTs: number, endTs: number, tz: string): number {
  let night = 0
  for (const slice of sliceByDay(startTs, endTs, tz)) {
    const nightPortion = minutesOverlappingNight(slice.startMinute, slice.endMinute)
    night += nightPortion * 60
  }
  return night
}

function minutesOverlappingNight(startMinute: number, endMinute: number): number {
  const overlap = (a1: number, a2: number, b1: number, b2: number): number =>
    Math.max(0, Math.min(a2, b2) - Math.max(a1, b1))
  return (
    overlap(startMinute, endMinute, 0, NIGHT_END_MINUTE) +
    overlap(startMinute, endMinute, NIGHT_START_MINUTE, 1440)
  )
}

export function computeDailyStats(
  events: BabyEvent[],
  from: DayKey,
  to: DayKey,
  options: Options,
  now: number = Date.now(),
): DailyStats[] {
  const days = new Map<DayKey, DailyStats>()
  for (const key of dayKeysBetween(from, to)) days.set(key, emptyDay(key))

  const touch = (key: DayKey): DailyStats | null => days.get(key) ?? null

  for (const event of liveEvents(events)) {
    const tz = zoneFor(event.tz, options.timezone)
    const startTs = toInstant(event.occurredAt)
    const startKey = dayKeyOf(startTs, tz)
    const day = touch(startKey)

    switch (event.type) {
      case 'breast': {
        // One feed, however many times the baby changed breast. The time that
        // counts is time at the breast: pauses (waking her up again) are not
        // feeding, so we sum the per-side segments instead of the wall clock.
        if (day) {
          const split = breastSplit(event, now)
          day.feeds += 1
          day.breastFeeds += 1
          day.breastSeconds += split.leftSeconds + split.rightSeconds
          day.leftSeconds += split.leftSeconds
          day.rightSeconds += split.rightSeconds
          // El suplemento es parte de esta toma, no una toma más.
          day.supplementMl += payloadOf(event, 'breast')?.supplementMl ?? 0
          if (event.estimated) day.hasEstimates = true
        }
        break
      }
      case 'bottle': {
        const payload = payloadOf(event, 'bottle')
        if (day) {
          day.feeds += 1
          day.bottleFeeds += 1
          day.bottleMl += payload?.ml ?? 0
        }
        break
      }
      case 'pump': {
        const payload = payloadOf(event, 'pump')
        if (day) {
          day.pumpSessions += 1
          day.pumpMl += payload?.ml ?? 0
        }
        break
      }
      case 'sleep': {
        const endTs = effectiveEnd(event, now)
        if (day) day.sleepSessions += 1
        for (const slice of sliceByDay(startTs, endTs, tz)) {
          const target = touch(slice.dayKey)
          if (!target) continue
          const nightMinutes = minutesOverlappingNight(slice.startMinute, slice.endMinute)
          target.sleepSeconds += slice.seconds
          target.nightSleepSeconds += nightMinutes * 60
          target.daySleepSeconds += Math.max(0, slice.seconds - nightMinutes * 60)
          target.sleepBands.push({
            startMinute: slice.startMinute,
            endMinute: slice.endMinute,
            running: event.running,
            estimated: event.estimated,
          })
          if (event.estimated) target.hasEstimates = true
        }
        break
      }
      case 'diaper': {
        const payload = payloadOf(event, 'diaper')
        if (day && payload) {
          day.diapers[payload.kind] += 1
          day.diapers.total += 1
          if (payload.leak) day.diapers.leaks += 1
        }
        break
      }
      case 'temperature': {
        const payload = payloadOf(event, 'temperature')
        if (day && payload) {
          day.temperatures.push(payload.celsius)
          day.maxTemperature = Math.max(day.maxTemperature ?? -Infinity, payload.celsius)
        }
        break
      }
      case 'weight': {
        const payload = payloadOf(event, 'weight')
        if (day && payload) day.weightGrams = payload.grams
        break
      }
      case 'height': {
        const payload = payloadOf(event, 'height')
        if (day && payload) day.heightCm = payload.cm
        break
      }
      case 'head': {
        const payload = payloadOf(event, 'head')
        if (day && payload) day.headCm = payload.cm
        break
      }
      case 'medication': {
        if (day) day.medications += 1
        break
      }
      case 'note': {
        if (day) day.notes += 1
        break
      }
    }
  }

  return [...days.values()].sort((a, b) => (a.dayKey < b.dayKey ? -1 : 1))
}

export function computeNights(
  events: BabyEvent[],
  from: DayKey,
  to: DayKey,
  options: Options,
  now: number = Date.now(),
): NightStats[] {
  const sleeps = liveEvents(events)
    .filter((e) => e.type === 'sleep')
    .map((e) => ({
      start: toInstant(e.occurredAt),
      end: effectiveEnd(e, now),
      tz: zoneFor(e.tz, options.timezone),
    }))
    .sort((a, b) => a.start - b.start)

  return dayKeysBetween(from, to).map((dayKey) => {
    const tz = zoneFor(undefined, options.timezone) || options.timezone.fixed
    const nightStart = startOfDay(dayKey, tz) + NIGHT_START_MINUTE * 60_000
    const nightEnd = startOfDay(addDays(dayKey, 1), tz) + NIGHT_END_MINUTE * 60_000

    let sleepSeconds = 0
    let longest = 0
    let wakings = 0
    let firstSleep: number | null = null
    let lastWake: number | null = null

    for (const sleep of sleeps) {
      const overlapStart = Math.max(sleep.start, nightStart)
      const overlapEnd = Math.min(sleep.end, nightEnd)
      if (overlapEnd <= overlapStart) continue
      const seconds = (overlapEnd - overlapStart) / 1000
      sleepSeconds += seconds
      longest = Math.max(longest, seconds)
      if (firstSleep === null) firstSleep = overlapStart
      lastWake = overlapEnd
      // A wake-up counts when the baby stops sleeping while it is still night.
      if (sleep.end < nightEnd && sleep.end > nightStart) wakings += 1
    }
    if (wakings > 0 && lastWake !== null && lastWake < nightEnd) wakings -= 1

    const dayStart = startOfDay(dayKey, tz)
    return {
      dayKey,
      sleepSeconds,
      wakings: Math.max(0, wakings),
      longestStretchSeconds: longest,
      firstSleepMinute: firstSleep === null ? null : Math.round((firstSleep - dayStart) / 60_000),
      lastWakeMinute: lastWake === null ? null : Math.round((lastWake - dayStart) / 60_000),
    }
  })
}

export function summarise(
  events: BabyEvent[],
  from: DayKey,
  to: DayKey,
  options: Options,
  now: number = Date.now(),
): PeriodSummary {
  const daily = computeDailyStats(events, from, to, options, now)
  const nights = computeNights(events, from, to, options, now)
  const days = daily.length || 1

  const totals = {
    feeds: sum(daily, (d) => d.feeds),
    bottleMl: sum(daily, (d) => d.bottleMl),
    supplementMl: sum(daily, (d) => d.supplementMl),
    pumpMl: sum(daily, (d) => d.pumpMl),
    breastSeconds: sum(daily, (d) => d.breastSeconds),
    leftSeconds: sum(daily, (d) => d.leftSeconds),
    rightSeconds: sum(daily, (d) => d.rightSeconds),
    sleepSeconds: sum(daily, (d) => d.sleepSeconds),
    diapers: daily.reduce<DiaperCounts>((acc, d) => {
      acc.pee += d.diapers.pee
      acc.poo += d.diapers.poo
      acc.mixed += d.diapers.mixed
      acc.dry += d.diapers.dry
      acc.total += d.diapers.total
      acc.leaks += d.diapers.leaks
      return acc
    }, emptyDiapers()),
    medications: sum(daily, (d) => d.medications),
  }

  const bottleFeeds = sum(daily, (d) => d.bottleFeeds)
  const breastFeeds = sum(daily, (d) => d.breastFeeds)
  const temps = daily.flatMap((d) => d.temperatures)

  return {
    from,
    to,
    days: daily.length,
    totals,
    perDay: {
      feeds: totals.feeds / days,
      bottleMl: totals.bottleMl / days,
      milkMl: (totals.bottleMl + totals.supplementMl) / days,
      sleepSeconds: totals.sleepSeconds / days,
      daySleepSeconds: sum(daily, (d) => d.daySleepSeconds) / days,
      nightSleepSeconds: sum(daily, (d) => d.nightSleepSeconds) / days,
      diapers: totals.diapers.total / days,
      nightWakings: nights.length ? sum(nights, (n) => n.wakings) / nights.length : 0,
    },
    averages: {
      mlPerBottle: bottleFeeds ? totals.bottleMl / bottleFeeds : null,
      minutesPerBreastFeed: breastFeeds ? totals.breastSeconds / breastFeeds / 60 : null,
      minutesBetweenFeeds: averageGapMinutes(events, from, to, options),
    },
    maxTemperature: temps.length ? Math.max(...temps) : null,
    lastWeightGrams: lastValue(daily, (d) => d.weightGrams),
    lastHeightCm: lastValue(daily, (d) => d.heightCm),
    lastHeadCm: lastValue(daily, (d) => d.headCm),
    hasEstimates: daily.some((d) => d.hasEstimates),
  }
}

function averageGapMinutes(
  events: BabyEvent[],
  from: DayKey,
  to: DayKey,
  options: Options,
): number | null {
  const tz = options.timezone.fixed
  const rangeStart = startOfDay(from, tz)
  const rangeEnd = endOfDay(to, tz)
  const feeds = liveEvents(events)
    .filter((e) => e.type === 'breast' || e.type === 'bottle')
    .map((e) => toInstant(e.occurredAt))
    .filter((ts) => ts >= rangeStart && ts < rangeEnd)
    .sort((a, b) => a - b)
  if (feeds.length < 2) return null
  let total = 0
  for (let i = 1; i < feeds.length; i++) total += (feeds[i] as number) - (feeds[i - 1] as number)
  return total / (feeds.length - 1) / 60_000
}

export function measurementSeries(
  events: BabyEvent[],
  type: 'weight' | 'height' | 'head',
  options: Options,
): MeasurementPoint[] {
  return liveEvents(events)
    .filter((e) => e.type === type)
    .map((e) => {
      const tz = zoneFor(e.tz, options.timezone)
      const value =
        type === 'weight'
          ? (payloadOf(e, 'weight')?.grams ?? 0)
          : type === 'height'
            ? (payloadOf(e, 'height')?.cm ?? 0)
            : (payloadOf(e, 'head')?.cm ?? 0)
      return { dayKey: dayKeyOf(e.occurredAt, tz), at: toInstant(e.occurredAt), value }
    })
    .filter((point) => point.value > 0)
    .sort((a, b) => a.at - b.at)
}

/** La ventana de comparación del peso. Fija: pesáis una vez por semana. */
export const WEIGHT_WINDOW_DAYS = 7
/** Margen admitido alrededor de esa ventana antes de darla por ausente. */
export const WEIGHT_WINDOW_TOLERANCE_DAYS = 2

export type WeightProgress =
  | {
      status: 'ok'
      /** Gramos ganados en la ventana. */
      deltaGrams: number
      /** Días reales entre los dos pesajes, que pueden no ser siete exactos. */
      days: number
      previous: MeasurementPoint
      latest: MeasurementPoint
    }
  | {
      status: 'missing'
      /** El día en el que debería haber un pesaje para poder comparar. */
      expectedAt: number
      latest: MeasurementPoint
    }

/**
 * Cuánto ha ganado en la última semana, sobre una ventana fija de siete días.
 *
 * Comparar con "el pesaje anterior, fuera cuando fuera" daba un número que
 * cambiaba de significado cada vez: no es lo mismo ganar 400 gramos en cuatro
 * días que en doce. Con la ventana fija, la cifra siempre quiere decir lo
 * mismo — y cuando falta el pesaje de referencia, la app lo dice en lugar de
 * comparar contra cualquier cosa.
 */
export function weightProgress(points: MeasurementPoint[]): WeightProgress | null {
  const latest = points[points.length - 1]
  if (!latest) return null

  const target = latest.at - WEIGHT_WINDOW_DAYS * 86_400_000
  const tolerance = WEIGHT_WINDOW_TOLERANCE_DAYS * 86_400_000

  let best: MeasurementPoint | null = null
  for (const point of points) {
    if (point === latest || point.at >= latest.at) continue
    if (Math.abs(point.at - target) > tolerance) continue
    if (!best || Math.abs(point.at - target) < Math.abs(best.at - target)) best = point
  }

  if (!best) return { status: 'missing', expectedAt: target, latest }

  return {
    status: 'ok',
    deltaGrams: latest.value - best.value,
    days: Math.round((latest.at - best.at) / 86_400_000),
    previous: best,
    latest,
  }
}

/** Difference between two summaries, as a signed ratio per metric. */
export function trend(current: number, previous: number): number | null {
  if (!previous) return null
  return (current - previous) / previous
}

function sum<T>(items: T[], pick: (item: T) => number): number {
  return items.reduce((acc, item) => acc + pick(item), 0)
}

function lastValue<T>(items: T[], pick: (item: T) => number | null): number | null {
  for (let i = items.length - 1; i >= 0; i--) {
    const value = pick(items[i] as T)
    if (value != null) return value
  }
  return null
}

/** Local minute-of-day of the last event of a type, for the status header. */
export function lastEventOfType(events: BabyEvent[], type: BabyEvent['type']): BabyEvent | null {
  let best: BabyEvent | null = null
  for (const event of liveEvents(events)) {
    if (event.type !== type) continue
    if (!best || toInstant(event.occurredAt) > toInstant(best.occurredAt)) best = event
  }
  return best
}

export { zonedParts }
