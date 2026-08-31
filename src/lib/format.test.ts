import { describe, expect, it } from 'vitest'
import { duration, hours, liveDuration, rangeLabel } from './format'

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
