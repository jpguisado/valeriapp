import { describe, expect, it } from 'vitest'
import { babyAgeDetailed, duration, hours, liveDuration, rangeLabel } from './format'

describe('liveDuration', () => {
  it('counts seconds while the session is short', () => {
    expect(liveDuration(0)).toBe('0:00')
    expect(liveDuration(7)).toBe('0:07')
    expect(liveDuration(64)).toBe('1:04')
    expect(liveDuration(724)).toBe('12:04')
    expect(liveDuration(3599)).toBe('59:59')
  })

  it('switches to minutes once it passes an hour', () => {
    expect(liveDuration(3600)).toBe('1 h')
    expect(liveDuration(7800)).toBe('2 h 10 min')
  })

  it('never shows a negative clock', () => {
    expect(liveDuration(-5)).toBe('0:00')
  })
})

describe('duration and hours keep their own jobs', () => {
  it('duration reads in words', () => {
    expect(duration(724)).toBe('12 min')
    expect(duration(7800)).toBe('2 h 10 min')
  })

  it('hours is the decimal readout for day totals', () => {
    expect(hours(19_440)).toBe('5,4 h')
  })
})

describe('rangeLabel', () => {
  it('junta el mes cuando la ventana no lo cruza', () => {
    expect(rangeLabel('2026-08-25', '2026-08-31')).toBe('25 – 31 de agosto')
  })

  it('nombra los dos meses cuando los cruza', () => {
    expect(rangeLabel('2026-08-28', '2026-09-03')).toBe('28 ago – 3 sep')
  })

  it('añade los años cuando cruza de año', () => {
    expect(rangeLabel('2026-12-28', '2027-01-03')).toBe('28 dic 2026 – 3 ene 2027')
  })
})

describe('babyAgeDetailed', () => {
  const at = (iso: string) => Date.parse(iso)
  const tz = 'Europe/Madrid'

  it('cuenta meses de calendario y lo que sobra en semanas y días', () => {
    expect(babyAgeDetailed('2026-08-12', at('2026-10-24T10:00:00Z'), tz)).toBe('2 meses, 1 semana y 5 días')
  })

  it('omite lo que vale cero', () => {
    expect(babyAgeDetailed('2026-08-12', at('2026-10-12T10:00:00Z'), tz)).toBe('2 meses')
    expect(babyAgeDetailed('2026-10-10', at('2026-10-24T10:00:00Z'), tz)).toBe('2 semanas')
    expect(babyAgeDetailed('2026-10-20', at('2026-10-24T10:00:00Z'), tz)).toBe('4 días')
    expect(babyAgeDetailed('2026-09-24', at('2026-10-25T10:00:00Z'), tz)).toBe('1 mes y 1 día')
  })

  it('no ha cumplido el mes hasta llegar al mismo día', () => {
    expect(babyAgeDetailed('2026-09-25', at('2026-10-24T10:00:00Z'), tz)).toBe('4 semanas y 1 día')
  })

  it('usa el día local, no el UTC', () => {
    // 00:30 en Madrid del 12 es todavía el 11 en UTC.
    expect(babyAgeDetailed('2026-08-12', at('2026-10-11T22:30:00Z'), tz)).toBe('2 meses')
  })
})
