/**
 * Percentiles de peso para la edad, a partir de los patrones de la OMS.
 *
 * El método LMS convierte una edad en tres parámetros —asimetría, mediana y
 * dispersión— con los que se pasa de kilos a percentil y de percentil a kilos.
 * Entre dos edades de la tabla se interpola linealmente, que a estas escalas
 * es indistinguible de la curva real.
 */
import { WEIGHT_BY_MONTH, WEIGHT_BY_WEEK, type Sex } from './growth-data.js'
import { ageInDays, type DayKey } from './time.js'

export type { Sex }

/** Percentiles que se dibujan como banda de referencia. */
export const REFERENCE_PERCENTILES = [3, 15, 50, 85, 97] as const

const DAYS_PER_MONTH = 30.4375
/** Hasta las 13 semanas la tabla semanal es más fina que la mensual. */
const WEEKLY_LIMIT_DAYS = 13 * 7

type Lms = readonly [number, number, number]

function interpolate(table: ReadonlyArray<Lms>, position: number): Lms | null {
  if (table.length === 0) return null
  const clamped = Math.max(0, Math.min(table.length - 1, position))
  const low = Math.floor(clamped)
  const high = Math.min(table.length - 1, low + 1)
  const lower = table[low]
  const upper = table[high]
  if (!lower || !upper) return null
  const t = clamped - low
  return [
    lower[0] + (upper[0] - lower[0]) * t,
    lower[1] + (upper[1] - lower[1]) * t,
    lower[2] + (upper[2] - lower[2]) * t,
  ]
}

/** Los tres parámetros a una edad dada, o null si se sale de la tabla. */
export function lmsAt(sex: Sex, ageDays: number): Lms | null {
  if (ageDays < 0) return null
  if (ageDays <= WEEKLY_LIMIT_DAYS) {
    return interpolate(WEIGHT_BY_WEEK[sex], ageDays / 7)
  }
  const months = ageDays / DAYS_PER_MONTH
  const table = WEIGHT_BY_MONTH[sex]
  if (months > table.length - 1) return null
  return interpolate(table, months)
}

/** Los kilos que corresponden a un percentil a esa edad. */
export function weightAtPercentile(sex: Sex, ageDays: number, percentile: number): number | null {
  const lms = lmsAt(sex, ageDays)
  if (!lms) return null
  return valueAtZ(lms, zFromPercentile(percentile))
}

/** En qué percentil cae un peso concreto, de 0 a 100. */
export function percentileOfWeight(sex: Sex, ageDays: number, grams: number): number | null {
  const lms = lmsAt(sex, ageDays)
  if (!lms) return null
  const [l, m, s] = lms
  const kg = grams / 1000
  if (kg <= 0) return null
  const z = l === 0 ? Math.log(kg / m) / s : ((kg / m) ** l - 1) / (l * s)
  return normalCdf(z) * 100
}

export function ageDaysAt(birthDate: DayKey, at: string | number | Date): number {
  return ageInDays(birthDate, at)
}

function valueAtZ([l, m, s]: Lms, z: number): number {
  return l === 0 ? m * Math.exp(s * z) : m * (1 + l * s * z) ** (1 / l)
}

/** Función de distribución normal, aproximación de Abramowitz y Stegun. */
function normalCdf(z: number): number {
  const sign = z < 0 ? -1 : 1
  const x = Math.abs(z) / Math.SQRT2
  const t = 1 / (1 + 0.3275911 * x)
  const y =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) *
      t *
      Math.exp(-x * x)
  return 0.5 * (1 + sign * y)
}

/** La inversa, por bisección: basta y evita meter otra aproximación. */
function zFromPercentile(percentile: number): number {
  const target = percentile / 100
  let low = -5
  let high = 5
  for (let i = 0; i < 60; i++) {
    const mid = (low + high) / 2
    if (normalCdf(mid) < target) low = mid
    else high = mid
  }
  return (low + high) / 2
}
