import { describe, expect, it } from 'vitest'
import type { BabyEvent, EventType } from './events.js'
import { defaultFeedIntervalMinutes, defaultSettings, evaluateReminders } from './reminders.js'

const NOW = Date.parse('2026-08-30T12:00:00.000Z')

function event(type: EventType, minutesAgo: number, payload: Record<string, unknown> = {}, extra: Partial<BabyEvent> = {}): BabyEvent {
  const occurredAt = new Date(NOW - minutesAgo * 60_000).toISOString()
  return {
    id: crypto.randomUUID(),
    babyId: 'baby',
    type,
    occurredAt,
    endedAt: null,
    tz: 'Europe/Madrid',
    running: false,
    estimated: false,
    payload,
    note: null,
    createdBy: 'user',
    createdAt: occurredAt,
    updatedAt: occurredAt,
    deletedAt: null,
    ...extra,
  }
}

function evaluate(events: BabyEvent[], overrides = {}) {
  return evaluateReminders({
    babyName: 'Valeria',
    birthDate: '2026-07-01',
    events,
    settings: { ...defaultSettings(1), ...overrides },
    now: NOW,
  })
}

describe('defaultFeedIntervalMinutes', () => {
  it('grows with age', () => {
    expect(defaultFeedIntervalMinutes(1)).toBe(180)
    expect(defaultFeedIntervalMinutes(4)).toBe(240)
    expect(defaultFeedIntervalMinutes(9)).toBe(300)
  })
})

describe('evaluateReminders', () => {
  it('fires a feed reminder once the interval has passed', () => {
    const due = evaluate([event('bottle', 200, { ml: 90, kind: 'formula' })])
    expect(due.map((item) => item.type)).toContain('feed')
  })

  it('stays quiet while a feed is in progress', () => {
    const due = evaluate([event('breast', 200, { side: 'left' }, { running: true })])
    expect(due.map((item) => item.type)).not.toContain('feed')
  })

  it('warns when two breastfeeds in a row used the same side', () => {
    const due = evaluate([
      event('breast', 30, { side: 'left' }),
      event('breast', 200, { side: 'left' }),
    ])
    expect(due.map((item) => item.type)).toContain('breast_alternation')
  })

  it('looks at the side the feed started on, not the one it ended on', () => {
    // Both feeds switched breasts, but both started on the left.
    const due = evaluate([
      event('breast', 30, { side: 'both', firstSide: 'left', leftSeconds: 300, rightSeconds: 400 }),
      event('breast', 200, { side: 'both', firstSide: 'left', leftSeconds: 200, rightSeconds: 500 }),
    ])
    expect(due.map((item) => item.type)).toContain('breast_alternation')
  })

  it('stays quiet when a switched feed started on the other breast', () => {
    const due = evaluate([
      event('breast', 30, { side: 'both', firstSide: 'right', leftSeconds: 300, rightSeconds: 400 }),
      event('breast', 200, { side: 'both', firstSide: 'left', leftSeconds: 200, rightSeconds: 500 }),
    ])
    expect(due.map((item) => item.type)).not.toContain('breast_alternation')
  })

  it('says nothing when the sides alternate', () => {
    const due = evaluate([
      event('breast', 30, { side: 'right' }),
      event('breast', 200, { side: 'left' }),
    ])
    expect(due.map((item) => item.type)).not.toContain('breast_alternation')
  })

  it('tracks wet and dirty diapers separately', () => {
    const due = evaluate([
      event('diaper', 30, { kind: 'pee' }),
      event('diaper', 3000, { kind: 'poo' }),
    ])
    const types = due.map((item) => item.type)
    expect(types).not.toContain('diaper_wet')
    expect(types).toContain('diaper_poo')
  })

  it('gives each firing a trigger key that changes with the awaited event', () => {
    const older = event('bottle', 300, { ml: 90, kind: 'formula' })
    const newer = event('bottle', 200, { ml: 90, kind: 'formula' })
    const first = evaluate([older]).find((item) => item.type === 'feed')
    const second = evaluate([older, newer]).find((item) => item.type === 'feed')
    expect(first?.triggerKey).not.toBe(second?.triggerKey)
  })

  it('respects disabled reminders', () => {
    const due = evaluate([event('bottle', 500, { ml: 90, kind: 'formula' })], {
      feed: { enabled: false, thresholdMinutes: 180 },
    })
    expect(due.map((item) => item.type)).not.toContain('feed')
  })
})
