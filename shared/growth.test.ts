import { describe, expect, it } from 'vitest'
import { lmsAt, percentileOfWeight, weightAtPercentile } from './growth.js'

describe('la referencia de la OMS', () => {
  it('reproduce las medianas publicadas al nacer', () => {
    expect(weightAtPercentile('female', 0, 50)).toBeCloseTo(3.23, 2)
    expect(weightAtPercentile('male', 0, 50)).toBeCloseTo(3.35, 2)
  })

  it('reproduce las medianas a las 13 semanas y a los 12 meses', () => {
    expect(weightAtPercentile('female', 91, 50)).toBeCloseTo(5.85, 1)
    expect(weightAtPercentile('female', Math.round(12 * 30.4375), 50)).toBeCloseTo(8.95, 1)
    expect(weightAtPercentile('male', Math.round(12 * 30.4375), 50)).toBeCloseTo(9.65, 1)
  })

  it('coincide con los percentiles de la tabla al nacer', () => {
    // De la propia tabla de la OMS para niñas, semana 0.
    expect(weightAtPercentile('female', 0, 3)).toBeCloseTo(2.4, 1)
    expect(weightAtPercentile('female', 0, 15)).toBeCloseTo(2.8, 1)
    expect(weightAtPercentile('female', 0, 85)).toBeCloseTo(3.7, 1)
    expect(weightAtPercentile('female', 0, 97)).toBeCloseTo(4.2, 1)
  })

  it('el percentil y su inverso se cierran sobre sí mismos', () => {
    for (const p of [3, 15, 50, 85, 97]) {
      const kg = weightAtPercentile('female', 60, p) as number
      expect(percentileOfWeight('female', 60, kg * 1000)).toBeCloseTo(p, 0)
    }
  })

  it('ordena los percentiles de menor a mayor', () => {
    const pesos = [3, 15, 50, 85, 97].map((p) => weightAtPercentile('female', 45, p) as number)
    expect(pesos).toEqual([...pesos].sort((a, b) => a - b))
  })

  it('se calla fuera del rango que cubre la tabla', () => {
    expect(lmsAt('female', -1)).toBeNull()
    expect(weightAtPercentile('female', 40 * 365, 50)).toBeNull()
  })
})
