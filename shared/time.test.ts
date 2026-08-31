import { describe, expect, it } from 'vitest'
import {
  addDays,
  dayFraction,
  addMonths,
  dayKeyOf,
  dayKeysBetween,
  diffDays,
  endOfMonth,
  startOfDay,
  startOfMonth,
  startOfWeek,
  zonedParts,
  zonedTimeToInstant,
} from './time.js'

describe('zonedParts', () => {
  it('reads an instant in the requested zone', () => {
    const parts = zonedParts('2026-08-30T01:30:00.000Z', 'Europe/Madrid')
    expect(parts.dayKey).toBe('2026-08-30')
    expect(parts.hour).toBe(3) // CEST = UTC+2
    expect(parts.minutesOfDay).toBe(3 * 60 + 30)
  })

  it('keeps a Lisbon feed at its local hour', () => {
    const instant = '2026-08-30T02:00:00.000Z'
    expect(zonedParts(instant, 'Europe/Lisbon').hour).toBe(3)
    expect(zonedParts(instant, 'Europe/Madrid').hour).toBe(4)
  })

  it('assigns the right day either side of local midnight', () => {
    // 23:30 in Madrid is already the next day in UTC.
    expect(dayKeyOf('2026-08-30T21:30:00.000Z', 'Europe/Madrid')).toBe('2026-08-30')
    expect(dayKeyOf('2026-08-30T22:30:00.000Z', 'Europe/Madrid')).toBe('2026-08-31')
  })
})

describe('zonedTimeToInstant', () => {
  it('round-trips a wall clock time', () => {
    const ts = zonedTimeToInstant('Europe/Madrid', 2026, 8, 30, 4, 15)
    expect(zonedParts(ts, 'Europe/Madrid').hour).toBe(4)
    expect(zonedParts(ts, 'Europe/Madrid').minute).toBe(15)
  })

  it('survives the spring DST jump', () => {
    // 2026-03-29: Madrid jumps 02:00 -> 03:00.
    const before = zonedTimeToInstant('Europe/Madrid', 2026, 3, 29, 1, 30)
    const after = zonedTimeToInstant('Europe/Madrid', 2026, 3, 29, 3, 30)
    expect(after - before).toBe(60 * 60 * 1000)
  })

  it('makes the autumn DST day 25 hours long', () => {
    const start = startOfDay('2026-10-25', 'Europe/Madrid')
    const next = startOfDay('2026-10-26', 'Europe/Madrid')
    expect((next - start) / 3_600_000).toBe(25)
  })
})

describe('calendar helpers', () => {
  it('starts weeks on Monday', () => {
    expect(startOfWeek('2026-08-30')).toBe('2026-08-24') // 30 Aug 2026 is a Sunday
    expect(startOfWeek('2026-08-31')).toBe('2026-08-31')
  })

  it('walks days and months', () => {
    expect(addDays('2026-02-28', 1)).toBe('2026-03-01')
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28')
    expect(startOfMonth('2026-08-30')).toBe('2026-08-01')
    expect(endOfMonth('2026-02-10')).toBe('2026-02-28')
    expect(diffDays('2026-08-01', '2026-08-30')).toBe(29)
    expect(dayKeysBetween('2026-08-28', '2026-08-30')).toEqual([
      '2026-08-28',
      '2026-08-29',
      '2026-08-30',
    ])
  })
})

describe('dayFraction', () => {
  it('places midday at the middle of an ordinary day', () => {
    const noon = zonedTimeToInstant('Europe/Madrid', 2026, 8, 30, 12, 0)
    expect(dayFraction(noon, '2026-08-30', 'Europe/Madrid')).toBeCloseTo(0.5, 6)
  })

  it('pins the edges of the day to 0 and 1', () => {
    expect(dayFraction(startOfDay('2026-08-30', 'Europe/Madrid'), '2026-08-30', 'Europe/Madrid')).toBe(0)
    const end = startOfDay('2026-08-31', 'Europe/Madrid')
    expect(dayFraction(end, '2026-08-30', 'Europe/Madrid')).toBeCloseTo(1, 6)
  })

  it('divides by the real length on the 25-hour day', () => {
    // 2026-10-25 in Madrid lasts 25 hours: noon is no longer the halfway point.
    const noon = zonedTimeToInstant('Europe/Madrid', 2026, 10, 25, 12, 0)
    const fraction = dayFraction(noon, '2026-10-25', 'Europe/Madrid')
    expect(fraction).toBeCloseTo(13 / 25, 4)
    expect(fraction).not.toBeCloseTo(0.5, 3)
  })

  it('divides by the real length on the 23-hour day', () => {
    // 2026-03-29 lasts 23 hours.
    const noon = zonedTimeToInstant('Europe/Madrid', 2026, 3, 29, 12, 0)
    expect(dayFraction(noon, '2026-03-29', 'Europe/Madrid')).toBeCloseTo(11 / 23, 4)
  })

  it('reads a feed recorded in another timezone at its own local hour', () => {
    // 03:00 in Lisbon is 04:00 in Madrid; drawn on the Lisbon ring it sits at 3/24.
    const instant = zonedTimeToInstant('Europe/Lisbon', 2026, 8, 30, 3, 0)
    expect(dayFraction(instant, '2026-08-30', 'Europe/Lisbon')).toBeCloseTo(3 / 24, 5)
    expect(dayFraction(instant, '2026-08-30', 'Europe/Madrid')).toBeCloseTo(4 / 24, 5)
  })
})

describe('ventanas móviles de las estadísticas', () => {
  it('los últimos siete días acaban hoy y empiezan seis atrás', () => {
    const today = '2026-08-31'
    expect(addDays(today, -6)).toBe('2026-08-25')
    expect(dayKeysBetween(addDays(today, -6), today)).toHaveLength(7)
  })

  it('retroceder un bloque no deja huecos ni solapes con el anterior', () => {
    const to = addDays('2026-08-31', -7)
    const from = addDays(to, -6)
    expect(to).toBe('2026-08-24')
    expect(from).toBe('2026-08-18')
    // El bloque anterior termina justo el día antes del actual.
    expect(addDays(to, 1)).toBe('2026-08-25')
  })

  it('la ventana de treinta días cruza de mes sin perder días', () => {
    const window = dayKeysBetween(addDays('2026-09-05', -29), '2026-09-05')
    expect(window).toHaveLength(30)
    expect(window[0]).toBe('2026-08-07')
  })
})
