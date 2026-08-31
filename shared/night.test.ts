import { describe, expect, it } from 'vitest'
import type { BabyEvent, EventType } from './events.js'
import {
  DEFAULT_SETTLE_MINUTES,
  derivedEventId,
  interruptsNight,
  nightIdOf,
  planNightAdjustment,
  runningNightSleep,
  segmentsOfNight,
  wakesHer,
} from './night.js'

const START = Date.parse('2026-08-30T21:40:00.000Z')

function event(
  type: EventType,
  minutesFromStart: number,
  extra: Partial<BabyEvent> = {},
): BabyEvent {
  const occurredAt = new Date(START + minutesFromStart * 60_000).toISOString()
  return {
    id: crypto.randomUUID(),
    babyId: 'baby',
    type,
    occurredAt,
    endedAt: null,
    tz: 'Europe/Madrid',
    running: false,
    estimated: false,
    payload: {},
    note: null,
    createdBy: 'user',
    createdAt: occurredAt,
    updatedAt: occurredAt,
    deletedAt: null,
    ...extra,
  }
}

describe('qué la despierta', () => {
  it('lo que obliga a tocarla', () => {
    for (const type of ['breast', 'bottle', 'diaper', 'temperature', 'medication', 'weight'] as EventType[]) {
      expect(wakesHer(type)).toBe(true)
    }
  })

  it('la nota y la extracción, no', () => {
    expect(wakesHer('note')).toBe(false)
    expect(wakesHer('pump')).toBe(false)
  })
})

describe('identificadores deterministas', () => {
  it('los dos móviles derivan el mismo del mismo evento', () => {
    const id = '3f2a9c10-7b4e-4d21-9e88-1c2b3a4d5e6f'
    expect(derivedEventId(id)).toBe(derivedEventId(id))
  })

  it('no colisiona con el evento del que sale', () => {
    const id = crypto.randomUUID()
    expect(derivedEventId(id)).not.toBe(id)
  })

  it('produce identificadores distintos para eventos distintos', () => {
    const ids = new Set(Array.from({ length: 200 }, () => derivedEventId(crypto.randomUUID())))
    expect(ids.size).toBe(200)
  })

  it('tiene forma de identificador válido', () => {
    expect(derivedEventId(crypto.randomUUID())).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-8[0-9a-f]{3}-[0-9a-f]{12}$/,
    )
  })
})

describe('el corte del sueño', () => {
  const sleep = event('sleep', 0, { running: true, payload: { nightId: 'n1', inferred: true } })

  it('cierra al empezar el evento y reanuda tras la cola', () => {
    const feed = event('breast', 60, { endedAt: new Date(START + 85 * 60_000).toISOString() })
    const plan = planNightAdjustment(sleep, feed)

    expect(plan?.closeAt).toBe(START + 60 * 60_000)
    // 85 + 25 de rutina.
    expect(plan?.resumeAt).toBe(START + 110 * 60_000)
  })

  it('un desvelo no lleva cola: ya dice cuándo se volvió a dormir', () => {
    const wakeup = event('wakeup', 130, { endedAt: new Date(START + 170 * 60_000).toISOString() })
    const plan = planNightAdjustment(sleep, wakeup)
    expect(plan?.resumeAt).toBe(START + 170 * 60_000)
  })

  it('mientras el evento sigue abierto no se reanuda nada', () => {
    const feed = event('breast', 60, { running: true })
    expect(planNightAdjustment(sleep, feed)?.resumeAt).toBeNull()
  })

  it('respeta la cola configurada por el hogar', () => {
    const feed = event('breast', 60, { endedAt: new Date(START + 85 * 60_000).toISOString() })
    expect(planNightAdjustment(sleep, feed, 40)?.resumeAt).toBe(START + 125 * 60_000)
    expect(DEFAULT_SETTLE_MINUTES).toBe(25)
  })

  it('ignora lo que ocurrió antes de que empezase el tramo', () => {
    const feed = event('breast', -30, { endedAt: new Date(START - 10 * 60_000).toISOString() })
    expect(planNightAdjustment(sleep, feed)).toBeNull()
  })
})

describe('la noche en marcha', () => {
  it('la reconoce por el tramo abierto con su noche', () => {
    const suelto = event('sleep', 0, { running: true })
    const deNoche = event('sleep', 10, { running: true, payload: { nightId: 'n1' } })
    expect(runningNightSleep([suelto])).toBeNull()
    expect(nightIdOf(runningNightSleep([suelto, deNoche]) as BabyEvent)).toBe('n1')
  })

  it('agrupa los tramos de una noche en orden', () => {
    const a = event('sleep', 120, { payload: { nightId: 'n1' } })
    const b = event('sleep', 0, { payload: { nightId: 'n1' } })
    const otra = event('sleep', 60, { payload: { nightId: 'n2' } })
    expect(segmentsOfNight([a, b, otra], 'n1').map((e) => e.id)).toEqual([b.id, a.id])
  })

  it('la extracción y la nota no cortan la noche', () => {
    expect(interruptsNight(event('note', 30))).toBe(false)
    expect(interruptsNight(event('pump', 30, { endedAt: new Date(START).toISOString() }))).toBe(false)
    expect(interruptsNight(event('diaper', 30))).toBe(true)
  })
})
