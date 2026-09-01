import { describe, expect, it } from 'vitest'
import type { BabyEvent } from './events.js'
import {
  awakeIntervals,
  isNightWrapper,
  longestStretchSeconds,
  nightSleepSeconds,
  openNight,
} from './night.js'

const ev = (
  type: string,
  from: string,
  to?: string,
  extra: Record<string, unknown> = {},
): BabyEvent =>
  ({
    id: `${type}-${from}`,
    babyId: 'b1',
    type,
    occurredAt: `2026-09-01T${from}:00.000Z`,
    endedAt: to ? `2026-09-01T${to}:00.000Z` : null,
    running: false,
    estimated: false,
    payload: {},
    deletedAt: null,
    ...extra,
  }) as unknown as BabyEvent

/** La noche del 31 de agosto, con sus horas reales. */
const noche = ev('sleep', '00:00', '08:18', { id: 'noche', payload: { night: true } })
const dentro = [
  noche,
  ev('breast', '03:14', '03:58'),
  ev('wakeup', '03:15', '04:25'),
  ev('diaper', '04:15'),
  ev('breast', '07:10', '07:59'),
]

describe('la noche como envoltorio', () => {
  it('reconoce el envoltorio y no confunde una siesta con él', () => {
    expect(isNightWrapper(noche)).toBe(true)
    expect(isNightWrapper(ev('sleep', '14:00', '15:00'))).toBe(false)
  })

  it('resta lo apuntado dentro, y nada más', () => {
    // 498 min de envoltorio, menos la unión de lo apuntado: 03:14→04:25 son
    // 71 min (la toma arranca un minuto antes del rato en pie, y solapadas
    // cuentan una vez) y 07:10→07:59 son 49. Quedan 378.
    expect(Math.round(nightSleepSeconds(dentro, noche, Date.now()) / 60)).toBe(378)
  })

  it('un pañal no resta: si hubo rato en pie, se apunta como tal', () => {
    const conPanal = nightSleepSeconds(dentro, noche, Date.now())
    const sinPanal = nightSleepSeconds(
      dentro.filter((e) => e.type !== 'diaper'),
      noche,
      Date.now(),
    )
    expect(conPanal).toBe(sinPanal)
  })

  it('la racha más larga es un trozo real, no el total', () => {
    // Tramos: 00:00→03:14 (194), 04:25→07:10 (165) y 07:59→08:18 (19).
    // La racha es el mayor, no la suma: 194 min.
    expect(Math.round(longestStretchSeconds(dentro, noche, Date.now()) / 60)).toBe(194)
  })

  it('los intervalos de dentro no incluyen al propio envoltorio', () => {
    expect(awakeIntervals(dentro, noche, Date.now()).length).toBe(3)
  })

  it('solo hay una noche abierta: el segundo móvil no abre otra', () => {
    const abierta = ev('sleep', '22:00', undefined, {
      id: 'abierta',
      running: true,
      payload: { night: true },
    })
    expect(openNight([noche, abierta])?.id).toBe('abierta')
    expect(openNight([noche])).toBeNull()
  })
})
