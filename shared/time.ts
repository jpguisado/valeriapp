/**
 * Timezone-aware date helpers built on Intl, with no date library.
 *
 * Every event carries the IANA zone of the device that recorded it, so a feed
 * at 03:00 in Lisbon stays 03:00 even when read from Madrid. `TimezoneMode`
 * decides whether we honour that zone ('device') or force the household one.
 */

export type TimezoneMode = 'device' | 'fixed'

export interface TimezoneSetting {
  mode: TimezoneMode
  /** Household zone, used when mode is 'fixed' and as a fallback. */
  fixed: string
}

export const DEFAULT_TIMEZONE = 'Europe/Madrid'

/** 'YYYY-MM-DD' in some timezone. Our unit of "a day" everywhere. */
export type DayKey = string

export interface ZonedParts {
  year: number
  month: number
  day: number
  hour: number
  minute: number
  second: number
  dayKey: DayKey
  /** Minutes elapsed since local midnight; the x-axis of the sleep chart. */
  minutesOfDay: number
  /** 1 = Monday … 7 = Sunday. */
  weekday: number
}

const formatterCache = new Map<string, Intl.DateTimeFormat>()

function partsFormatter(tz: string): Intl.DateTimeFormat {
  let fmt = formatterCache.get(tz)
  if (!fmt) {
    fmt = new Intl.DateTimeFormat('en-GB', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      weekday: 'short',
    })
    formatterCache.set(tz, fmt)
  }
  return fmt
}

const WEEKDAY_INDEX: Record<string, number> = {
  Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7,
}

export function deviceTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || DEFAULT_TIMEZONE
  } catch {
    return DEFAULT_TIMEZONE
  }
}

export function isValidTimezone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-GB', { timeZone: tz })
    return true
  } catch {
    return false
  }
}

/** The zone an event should be read in, honouring the household setting. */
export function zoneFor(eventTz: string | undefined, setting: TimezoneSetting): string {
  if (setting.mode === 'fixed') return setting.fixed
  return eventTz && isValidTimezone(eventTz) ? eventTz : setting.fixed
}

export function toInstant(value: Date | string | number): number {
  if (value instanceof Date) return value.getTime()
  if (typeof value === 'number') return value
  return Date.parse(value)
}

export function zonedParts(value: Date | string | number, tz: string): ZonedParts {
  const ts = toInstant(value)
  const parts = partsFormatter(tz).formatToParts(new Date(ts))
  const get = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((p) => p.type === type)?.value ?? '0'

  const year = Number(get('year'))
  const month = Number(get('month'))
  const day = Number(get('day'))
  const hour = Number(get('hour')) % 24
  const minute = Number(get('minute'))
  const second = Number(get('second'))

  return {
    year,
    month,
    day,
    hour,
    minute,
    second,
    dayKey: `${pad(year, 4)}-${pad(month)}-${pad(day)}`,
    minutesOfDay: hour * 60 + minute,
    weekday: WEEKDAY_INDEX[get('weekday')] ?? 1,
  }
}

export function dayKeyOf(value: Date | string | number, tz: string): DayKey {
  return zonedParts(value, tz).dayKey
}

function pad(n: number, width = 2): string {
  return String(Math.abs(n)).padStart(width, '0')
}

/** Offset of `tz` at a given instant, in milliseconds. */
function offsetAt(ts: number, tz: string): number {
  const p = zonedParts(ts, tz)
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second)
  return asUtc - Math.floor(ts / 1000) * 1000
}

/** UTC instant of a local wall-clock time. Handles DST transitions. */
export function zonedTimeToInstant(
  tz: string,
  year: number,
  month: number,
  day: number,
  hour = 0,
  minute = 0,
): number {
  const guess = Date.UTC(year, month - 1, day, hour, minute)
  const firstOffset = offsetAt(guess, tz)
  let ts = guess - firstOffset
  const secondOffset = offsetAt(ts, tz)
  if (secondOffset !== firstOffset) ts = guess - secondOffset
  return ts
}

export function parseDayKey(dayKey: DayKey): { year: number; month: number; day: number } {
  const [y, m, d] = dayKey.split('-').map(Number)
  return { year: y ?? 1970, month: m ?? 1, day: d ?? 1 }
}

export function startOfDay(dayKey: DayKey, tz: string): number {
  const { year, month, day } = parseDayKey(dayKey)
  return zonedTimeToInstant(tz, year, month, day, 0, 0)
}

export function endOfDay(dayKey: DayKey, tz: string): number {
  return startOfDay(addDays(dayKey, 1), tz)
}

export function addDays(dayKey: DayKey, days: number): DayKey {
  const { year, month, day } = parseDayKey(dayKey)
  const d = new Date(Date.UTC(year, month - 1, day))
  d.setUTCDate(d.getUTCDate() + days)
  return `${pad(d.getUTCFullYear(), 4)}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`
}

export function addMonths(dayKey: DayKey, months: number): DayKey {
  const { year, month, day } = parseDayKey(dayKey)
  const d = new Date(Date.UTC(year, month - 1 + months, 1))
  const lastDay = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate()
  d.setUTCDate(Math.min(day, lastDay))
  return `${pad(d.getUTCFullYear(), 4)}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`
}

export function diffDays(from: DayKey, to: DayKey): number {
  const a = parseDayKey(from)
  const b = parseDayKey(to)
  const ms = Date.UTC(b.year, b.month - 1, b.day) - Date.UTC(a.year, a.month - 1, a.day)
  return Math.round(ms / 86_400_000)
}

/** Weeks run Monday to Sunday. */
export function startOfWeek(dayKey: DayKey): DayKey {
  const { year, month, day } = parseDayKey(dayKey)
  const d = new Date(Date.UTC(year, month - 1, day))
  const weekday = d.getUTCDay() === 0 ? 7 : d.getUTCDay()
  return addDays(dayKey, 1 - weekday)
}

export function startOfMonth(dayKey: DayKey): DayKey {
  const { year, month } = parseDayKey(dayKey)
  return `${pad(year, 4)}-${pad(month)}-01`
}

export function endOfMonth(dayKey: DayKey): DayKey {
  return addDays(addMonths(startOfMonth(dayKey), 1), -1)
}

export function dayKeysBetween(from: DayKey, to: DayKey): DayKey[] {
  const keys: DayKey[] = []
  for (let key = from; diffDays(key, to) >= 0; key = addDays(key, 1)) keys.push(key)
  return keys
}

/**
 * Where an instant falls within a day, as a fraction from 0 to 1.
 *
 * Divides by the day's *real* length, not by a fixed 1440 minutes: the days
 * the clocks change last 23 or 25 hours, and a fixed divisor would shift every
 * event by almost an hour on the ring.
 */
export function dayFraction(
  instant: Date | string | number,
  dayKey: DayKey,
  tz: string,
): number {
  const start = startOfDay(dayKey, tz)
  const end = endOfDay(dayKey, tz)
  const span = end - start
  if (span <= 0) return 0
  return (toInstant(instant) - start) / span
}

/** Age in whole days; drives the default feed-interval reminder. */
export function ageInDays(birthDate: DayKey, at: Date | string | number = Date.now()): number {
  const tz = DEFAULT_TIMEZONE
  return Math.max(0, diffDays(birthDate, dayKeyOf(at, tz)))
}

export function ageInMonths(birthDate: DayKey, at: Date | string | number = Date.now()): number {
  return Math.floor(ageInDays(birthDate, at) / 30.4375)
}
