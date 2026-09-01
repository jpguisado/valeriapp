import { describe, expect, it } from 'vitest'
import type { BabyEvent, EventType } from './events.js'
import { computeDailyStats, computeNights, measurementSeries, summarise, weightProgress } from './stats.js'

const BABY = '11111111-1111-4111-8111-111111111111'
const USER = '22222222-2222-4222-8222-222222222222'
const MADRID = { mode: 'device' as const, fixed: 'Europe/Madrid' }

let counter = 0

function event(
  type: EventType,
  occurredAt: string,
  extra: Partial<BabyEvent> = {},
  tz = 'Europe/Madrid',
): BabyEvent {
  counter += 1
  return {
    id: `00000000-0000-4000-8000-${String(counter).padStart(12, '0')}`,
    babyId: BABY,
    type,
    occurredAt,
    endedAt: null,
    tz,
    running: false,
    estimated: false,
    payload: {},
    note: null,
    createdBy: USER,
    createdAt: occurredAt,
    updatedAt: occurredAt,
    deletedAt: null,
    ...extra,
  }
}

describe('computeDailyStats', () => {
  it('counts feeds on the day they started, in local time', () => {
    const events = [
      // 23:30 Madrid on the 29th (21:30 UTC)
      event('bottle', '2026-08-29T21:30:00.000Z', { payload: { ml: 90, kind: 'formula' } }),
      // 00:30 Madrid on the 30th (22:30 UTC on the 29th)
      event('bottle', '2026-08-29T22:30:00.000Z', { payload: { ml: 60, kind: 'formula' } }),
    ]
    const [first, second] = computeDailyStats(events, '2026-08-29', '2026-08-30', { timezone: MADRID })
    expect(first?.feeds).toBe(1)
    expect(first?.bottleMl).toBe(90)
    expect(second?.feeds).toBe(1)
    expect(second?.bottleMl).toBe(60)
  })

  it('splits a sleep that crosses midnight across both days', () => {
    const events = [
      event('sleep', '2026-08-29T20:00:00.000Z', { endedAt: '2026-08-30T04:00:00.000Z' }),
    ]
    const [first, second] = computeDailyStats(events, '2026-08-29', '2026-08-30', { timezone: MADRID })
    // 22:00 -> 00:00 local on the 29th, 00:00 -> 06:00 on the 30th.
    expect((first?.sleepSeconds ?? 0) / 3600).toBeCloseTo(2, 5)
    expect((second?.sleepSeconds ?? 0) / 3600).toBeCloseTo(6, 5)
    expect(first?.sleepSessions).toBe(1)
    expect(second?.sleepSessions).toBe(0)
  })

  it('separates night sleep from naps', () => {
    const events = [
      // 13:00 -> 15:00 local: a nap.
      event('sleep', '2026-08-30T11:00:00.000Z', { endedAt: '2026-08-30T13:00:00.000Z' }),
      // 22:00 -> 23:00 local: night.
      event('sleep', '2026-08-30T20:00:00.000Z', { endedAt: '2026-08-30T21:00:00.000Z' }),
    ]
    const [day] = computeDailyStats(events, '2026-08-30', '2026-08-30', { timezone: MADRID })
    expect((day?.daySleepSeconds ?? 0) / 3600).toBeCloseTo(2, 5)
    expect((day?.nightSleepSeconds ?? 0) / 3600).toBeCloseTo(1, 5)
  })

  it('reads a Lisbon event in its own zone when the mode is device', () => {
    const events = [
      // 23:30 UTC = 00:30 in Lisbon on the 31st, 01:30 in Madrid.
      event('bottle', '2026-08-30T23:30:00.000Z', { payload: { ml: 50, kind: 'formula' } }, 'Europe/Lisbon'),
    ]
    const device = computeDailyStats(events, '2026-08-30', '2026-08-31', { timezone: MADRID })
    expect(device[0]?.feeds).toBe(0)
    expect(device[1]?.feeds).toBe(1)

    const fixed = computeDailyStats(events, '2026-08-30', '2026-08-31', {
      timezone: { mode: 'fixed', fixed: 'Europe/Madrid' },
    })
    expect(fixed[1]?.feeds).toBe(1)
  })

  it('splits breast time per side and honours explicit per-side seconds', () => {
    const events = [
      event('breast', '2026-08-30T08:00:00.000Z', {
        endedAt: '2026-08-30T08:20:00.000Z',
        payload: { side: 'both', leftSeconds: 300, rightSeconds: 900 },
      }),
      event('breast', '2026-08-30T12:00:00.000Z', {
        endedAt: '2026-08-30T12:10:00.000Z',
        payload: { side: 'left' },
      }),
    ]
    const [day] = computeDailyStats(events, '2026-08-30', '2026-08-30', { timezone: MADRID })
    expect(day?.leftSeconds).toBe(300 + 600)
    expect(day?.rightSeconds).toBe(900)
    expect(day?.breastFeeds).toBe(2)
  })

  it('ignores deleted events', () => {
    const events = [
      event('diaper', '2026-08-30T09:00:00.000Z', { payload: { kind: 'poo' } }),
      event('diaper', '2026-08-30T10:00:00.000Z', {
        payload: { kind: 'pee' },
        deletedAt: '2026-08-30T11:00:00.000Z',
      }),
    ]
    const [day] = computeDailyStats(events, '2026-08-30', '2026-08-30', { timezone: MADRID })
    expect(day?.diapers.total).toBe(1)
    expect(day?.diapers.poo).toBe(1)
  })

  it('counts a running timer up to now and flags estimates', () => {
    const now = Date.parse('2026-08-30T12:00:00.000Z')
    const events = [
      event('sleep', '2026-08-30T10:00:00.000Z', { running: true }),
      event('sleep', '2026-08-30T06:00:00.000Z', {
        endedAt: '2026-08-30T07:00:00.000Z',
        estimated: true,
      }),
    ]
    const [day] = computeDailyStats(events, '2026-08-30', '2026-08-30', { timezone: MADRID }, now)
    expect((day?.sleepSeconds ?? 0) / 3600).toBeCloseTo(3, 5)
    expect(day?.hasEstimates).toBe(true)
  })
})

describe('computeNights', () => {
  it('counts wake-ups inside the night window', () => {
    const events = [
      // 22:00 -> 01:00 local, then 01:30 -> 06:00 local.
      event('sleep', '2026-08-30T20:00:00.000Z', { endedAt: '2026-08-30T23:00:00.000Z' }),
      event('sleep', '2026-08-30T23:30:00.000Z', { endedAt: '2026-08-31T04:00:00.000Z' }),
    ]
    const [night] = computeNights(events, '2026-08-30', '2026-08-30', { timezone: MADRID })
    expect((night?.sleepSeconds ?? 0) / 3600).toBeCloseTo(7.5, 5)
    expect(night?.wakings).toBe(1)
    expect((night?.longestStretchSeconds ?? 0) / 3600).toBeCloseTo(4.5, 5)
  })
})

describe('summarise', () => {
  it('averages over the days in range, not over the days with data', () => {
    const events = [
      event('bottle', '2026-08-24T09:00:00.000Z', { payload: { ml: 100, kind: 'formula' } }),
      event('bottle', '2026-08-24T15:00:00.000Z', { payload: { ml: 100, kind: 'formula' } }),
    ]
    const summary = summarise(events, '2026-08-24', '2026-08-30', { timezone: MADRID })
    expect(summary.days).toBe(7)
    expect(summary.totals.bottleMl).toBe(200)
    expect(summary.perDay.feeds).toBeCloseTo(2 / 7, 5)
    expect(summary.averages.mlPerBottle).toBe(100)
    expect(summary.averages.minutesBetweenFeeds).toBeCloseTo(360, 5)
  })

  it('keeps the last measurement of the period', () => {
    const events = [
      event('weight', '2026-08-24T09:00:00.000Z', { payload: { grams: 4200 } }),
      event('weight', '2026-08-29T09:00:00.000Z', { payload: { grams: 4500 } }),
    ]
    const summary = summarise(events, '2026-08-24', '2026-08-30', { timezone: MADRID })
    expect(summary.lastWeightGrams).toBe(4500)
    expect(measurementSeries(events, 'weight', { timezone: MADRID })).toHaveLength(2)
  })
})

describe('feeds on both breasts', () => {
  it('counts one feed and splits the time between sides', () => {
    const events = [
      event('breast', '2026-08-30T08:00:00.000Z', {
        endedAt: '2026-08-30T08:20:00.000Z',
        payload: {
          side: 'both',
          firstSide: 'left',
          leftSeconds: 480,
          rightSeconds: 720,
        },
      }),
    ]
    const [day] = computeDailyStats(events, '2026-08-30', '2026-08-30', { timezone: MADRID })
    expect(day?.feeds).toBe(1)
    expect(day?.breastFeeds).toBe(1)
    expect(day?.leftSeconds).toBe(480)
    expect(day?.rightSeconds).toBe(720)
    expect(day?.breastSeconds).toBe(1200)
  })

  it('adds the segment still in progress to the active side', () => {
    const now = Date.parse('2026-08-30T08:15:00.000Z')
    const events = [
      event('breast', '2026-08-30T08:00:00.000Z', {
        running: true,
        payload: {
          side: 'both',
          firstSide: 'left',
          activeSide: 'right',
          segmentStartedAt: '2026-08-30T08:10:00.000Z',
          leftSeconds: 600,
          rightSeconds: 0,
        },
      }),
    ]
    const [day] = computeDailyStats(events, '2026-08-30', '2026-08-30', { timezone: MADRID }, now)
    expect(day?.feeds).toBe(1)
    expect(day?.leftSeconds).toBe(600)
    expect(day?.rightSeconds).toBe(300)
  })
})

describe('feeds with pauses', () => {
  it('counts time at the breast, not time on the clock', () => {
    const events = [
      // 40 minutes of wall clock, 15 of them actually feeding.
      event('breast', '2026-08-30T08:00:00.000Z', {
        endedAt: '2026-08-30T08:40:00.000Z',
        payload: { side: 'left', firstSide: 'left', leftSeconds: 900, rightSeconds: 0 },
      }),
    ]
    const [day] = computeDailyStats(events, '2026-08-30', '2026-08-30', { timezone: MADRID })
    expect(day?.feeds).toBe(1)
    expect(day?.breastSeconds).toBe(900)
    expect(day?.leftSeconds).toBe(900)
  })

  it('freezes the running total while a feed is paused', () => {
    const events = [
      event('breast', '2026-08-30T08:00:00.000Z', {
        running: true,
        payload: {
          side: 'left',
          firstSide: 'left',
          activeSide: 'left',
          pausedAt: '2026-08-30T08:06:00.000Z',
          leftSeconds: 360,
          rightSeconds: 0,
        },
      }),
    ]
    const at = Date.parse('2026-08-30T08:30:00.000Z')
    const [day] = computeDailyStats(events, '2026-08-30', '2026-08-30', { timezone: MADRID }, at)
    expect(day?.breastSeconds).toBe(360)
  })
})

describe('lactancia mixta en las estadísticas', () => {
  it('cuenta una sola toma y suma los ml del suplemento aparte', () => {
    const events = [
      event('breast', '2026-08-30T08:00:00.000Z', {
        endedAt: '2026-08-30T08:20:00.000Z',
        payload: {
          side: 'left', firstSide: 'left', leftSeconds: 1200, rightSeconds: 0,
          supplementMl: 60, supplementKind: 'formula',
        },
      }),
      event('bottle', '2026-08-30T14:00:00.000Z', { payload: { ml: 90, kind: 'formula' } }),
    ]
    const [day] = computeDailyStats(events, '2026-08-30', '2026-08-30', { timezone: MADRID })
    expect(day?.feeds).toBe(2)
    expect(day?.bottleMl).toBe(90)
    expect(day?.supplementMl).toBe(60)

    const summary = summarise(events, '2026-08-30', '2026-08-30', { timezone: MADRID })
    expect(summary.totals.supplementMl).toBe(60)
    expect(summary.perDay.milkMl).toBe(150)
  })

  it('una toma de pecho sin suplemento no suma leche', () => {
    const events = [
      event('breast', '2026-08-30T08:00:00.000Z', {
        endedAt: '2026-08-30T08:20:00.000Z',
        payload: { side: 'left', leftSeconds: 1200 },
      }),
    ]
    const [day] = computeDailyStats(events, '2026-08-30', '2026-08-30', { timezone: MADRID })
    expect(day?.supplementMl).toBe(0)
  })
})

describe('el avance del peso', () => {
  const point = (dayKey: string, value: number) => ({
    dayKey,
    at: Date.parse(`${dayKey}T09:00:00.000Z`),
    value,
  })

  it('compara sobre una ventana fija de siete días', () => {
    const progress = weightProgress([
      point('2026-08-17', 2995),
      point('2026-08-24', 3200),
      point('2026-08-31', 3405),
    ])
    expect(progress?.status).toBe('ok')
    if (progress?.status !== 'ok') return
    expect(progress.deltaGrams).toBe(205)
    expect(progress.days).toBe(7)
    expect(progress.previous.dayKey).toBe('2026-08-24')
  })

  it('admite un par de días de margen y dice cuántos han pasado', () => {
    const progress = weightProgress([point('2026-08-25', 3200), point('2026-08-31', 3405)])
    expect(progress?.status).toBe('ok')
    if (progress?.status !== 'ok') return
    expect(progress.days).toBe(6)
  })

  it('pide el pesaje que falta en vez de compararlo con cualquier otro', () => {
    // El anterior es de hace diez días: fuera de la ventana.
    const progress = weightProgress([point('2026-08-21', 2995), point('2026-08-31', 3405)])
    expect(progress?.status).toBe('missing')
    if (progress?.status !== 'missing') return
    expect(progress.expectedAt).toBe(Date.parse('2026-08-24T09:00:00.000Z'))
  })

  it('elige el pesaje más cercano a los siete días si hay varios', () => {
    const progress = weightProgress([
      point('2026-08-22', 3000),
      point('2026-08-25', 3100),
      point('2026-08-31', 3405),
    ])
    if (progress?.status !== 'ok') throw new Error('debería comparar')
    expect(progress.previous.dayKey).toBe('2026-08-25')
  })

  it('admite que un bebé pierda peso', () => {
    const progress = weightProgress([point('2026-08-04', 2600), point('2026-08-11', 2515)])
    if (progress?.status !== 'ok') throw new Error('debería comparar')
    expect(progress.deltaGrams).toBe(-85)
  })

  it('con un solo pesaje pide el de referencia', () => {
    expect(weightProgress([point('2026-08-31', 3405)])?.status).toBe('missing')
    expect(weightProgress([])).toBeNull()
  })
})

describe('el desvelo apuntado dentro de un sueño', () => {
  const evento = (
    type: 'sleep' | 'wakeup',
    from: string,
    to: string,
  ): BabyEvent =>
    ({
      id: `${type}-${from}`,
      babyId: 'b1',
      type,
      occurredAt: `${from}:00.000Z`,
      endedAt: `${to}:00.000Z`,
      running: false,
      estimated: false,
      payload: {},
      tz: 'UTC',
      deletedAt: null,
    }) as unknown as BabyEvent

  // El caso real de la noche del 31 de agosto: un sueño de 419 minutos con
  // dos desvelos apuntados encima que sumaban 149.
  it('no cuenta como dormido el rato que se apuntó despierta', () => {
    const events = [
      evento('sleep', '2026-09-01T01:19', '2026-09-01T08:18'),
      evento('wakeup', '2026-09-01T03:15', '2026-09-01T04:25'),
      evento('wakeup', '2026-09-01T07:00', '2026-09-01T08:30'),
    ]
    const [dia] = computeDailyStats(events, '2026-09-01', '2026-09-01', {
      timezone: { mode: 'fixed', fixed: 'UTC' },
    })
    // 419 − 70 (03:15-04:25) − 78 (07:00 hasta el final del sueño) = 271.
    expect(Math.round((dia?.sleepSeconds ?? 0) / 60)).toBe(271)
  })

  it('parte la banda en los trozos realmente dormidos', () => {
    const events = [
      evento('sleep', '2026-09-01T01:19', '2026-09-01T08:18'),
      evento('wakeup', '2026-09-01T03:15', '2026-09-01T04:25'),
      evento('wakeup', '2026-09-01T07:00', '2026-09-01T08:30'),
    ]
    const [dia] = computeDailyStats(events, '2026-09-01', '2026-09-01', {
      timezone: { mode: 'fixed', fixed: 'UTC' },
    })
    // Sólo dos: el segundo desvelo se prolonga más allá del final del sueño,
    // así que no queda nada dormido después de él.
    expect(dia?.sleepBands.map((b) => [b.startMinute, b.endMinute])).toEqual([
      [79, 195],
      [265, 420],
    ])
  })

  it('un sueño sin desvelos encima no cambia', () => {
    const [dia] = computeDailyStats(
      [evento('sleep', '2026-09-01T01:00', '2026-09-01T03:00')],
      '2026-09-01',
      '2026-09-01',
      { timezone: { mode: 'fixed', fixed: 'UTC' } },
    )
    expect(Math.round((dia?.sleepSeconds ?? 0) / 60)).toBe(120)
  })
})
