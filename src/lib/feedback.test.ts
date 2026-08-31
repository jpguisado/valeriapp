import 'fake-indexeddb/auto'
import { describe, expect, it } from 'vitest'
import type { BabyEvent, EventType } from '@shared/events'
import { recordedMessage, startedMessage, stoppedMessage } from './feedback'

const MADRID = { mode: 'device' as const, fixed: 'Europe/Madrid' }
const BABY = '11111111-1111-4111-8111-111111111111'
const USER = '22222222-2222-4222-8222-222222222222'
const NOW = Date.parse('2026-08-30T18:00:00.000Z')

let counter = 0

function event(
  type: EventType,
  minutesAgo: number,
  payload: Record<string, unknown> = {},
  extra: Partial<BabyEvent> = {},
): BabyEvent {
  counter += 1
  const occurredAt = new Date(NOW - minutesAgo * 60_000).toISOString()
  return {
    id: `00000000-0000-4000-8000-${String(counter).padStart(12, '0')}`,
    babyId: BABY,
    type,
    occurredAt,
    endedAt: null,
    tz: 'Europe/Madrid',
    running: false,
    estimated: false,
    payload,
    note: null,
    createdBy: USER,
    createdAt: occurredAt,
    updatedAt: occurredAt,
    deletedAt: null,
    ...extra,
  }
}

function context(events: BabyEvent[]) {
  return { events, timezone: MADRID, now: NOW }
}

describe('startedMessage', () => {
  it('names the breast it started on', () => {
    const feed = event('breast', 0, { side: 'left', firstSide: 'left', activeSide: 'left' }, { running: true })
    expect(startedMessage(feed)).toBe('Pecho iniciado · izquierdo')
  })

  it('has its own wording for a pump session', () => {
    expect(startedMessage(event('pump', 0, { side: 'both', ml: 0 }, { running: true }))).toBe(
      'Extracción iniciada',
    )
  })
})

describe('stoppedMessage', () => {
  it('reports time at the breast and how many feeds today', () => {
    const earlier = event('bottle', 300, { ml: 90, kind: 'formula' })
    const feed = event('breast', 20, { side: 'left', firstSide: 'left', leftSeconds: 1080 }, {
      endedAt: new Date(NOW).toISOString(),
    })
    expect(stoppedMessage(feed, context([earlier, feed]))).toBe('Pecho · 18 min · 2 tomas hoy')
  })

  it('adds the day total to a sleep', () => {
    const sleep = event('sleep', 130, {}, { endedAt: new Date(NOW - 10 * 60_000).toISOString() })
    expect(stoppedMessage(sleep, context([sleep]))).toBe('Sueño · 2 h · 2,0 h hoy')
  })
})

describe('recordedMessage', () => {
  it('counts the nappies of the day, including the one just saved', () => {
    const earlier = event('diaper', 400, { kind: 'poo' })
    const nappy = event('diaper', 0, { kind: 'pee' })
    expect(recordedMessage(nappy, context([earlier]))).toBe('Pañal registrado · pis · 2 pañales hoy')
  })

  it('uses the singular for the first one of the day', () => {
    const nappy = event('diaper', 0, { kind: 'mixed' })
    expect(recordedMessage(nappy, context([]))).toBe('Pañal registrado · pis y caca · 1 pañal hoy')
  })

  it('reports the bottle volume and the running feed count', () => {
    const bottle = event('bottle', 0, { ml: 120, kind: 'formula' })
    expect(recordedMessage(bottle, context([]))).toBe('Biberón · 120 ml · 1 toma hoy')
  })

  it('points at a higher temperature earlier in the day', () => {
    const earlier = event('temperature', 300, { celsius: 37.4, method: 'axillary' })
    const now = event('temperature', 0, { celsius: 36.8, method: 'axillary' })
    expect(recordedMessage(now, context([earlier]))).toBe('36,8 ºC · máxima hoy 37,4 ºC')
  })

  it('says so when the new reading is the highest', () => {
    const now = event('temperature', 0, { celsius: 38.1, method: 'axillary' })
    expect(recordedMessage(now, context([]))).toBe('38,1 ºC · máxima de hoy')
  })

  it('recalls when the previous dose was given', () => {
    const earlier = event('medication', 480, { name: 'Apiretal', dose: '1,2 ml' })
    const now = event('medication', 0, { name: 'Apiretal', dose: '1,2 ml' })
    expect(recordedMessage(now, context([earlier]))).toBe('Apiretal · anterior hace 8 h')
  })

  it('compares a weight with the previous one', () => {
    const earlier = event('weight', 60 * 24 * 7, { grams: 4000 })
    const now = event('weight', 0, { grams: 4180 })
    expect(recordedMessage(now, context([earlier]))).toBe('4,180 kg · +180 g')
  })

  it('shows a weight on its own when there is nothing to compare', () => {
    expect(recordedMessage(event('weight', 0, { grams: 3450 }), context([]))).toBe('3,450 kg')
  })

  it('keeps a note plain', () => {
    expect(recordedMessage(event('note', 0, {}), context([]))).toBe('Nota guardada')
  })
})
