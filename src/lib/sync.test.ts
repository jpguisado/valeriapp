import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { BabyEvent } from '@shared/events'
import { db, readMeta } from './db'
import { newEvent, saveEvent, sync, syncState } from './sync'

const BABY = '11111111-1111-4111-8111-111111111111'
const USER = '22222222-2222-4222-8222-222222222222'

function make(overrides: Partial<BabyEvent> = {}): BabyEvent {
  return { ...newEvent({ babyId: BABY, type: 'diaper', createdBy: USER, payload: { kind: 'pee' } }), ...overrides }
}

function respondWith(body: unknown, ok = true): void {
  globalThis.fetch = vi.fn(async () =>
    new Response(JSON.stringify(body), { status: ok ? 200 : 500, headers: { 'Content-Type': 'application/json' } }),
  ) as unknown as typeof fetch
}

/** Drains any fire-and-forget sync started by saveEvent, so tests are deterministic. */
async function settle(): Promise<void> {
  await sync()
  await sync()
}

function offline(): void {
  globalThis.fetch = vi.fn(async () => {
    throw new TypeError('Failed to fetch')
  }) as unknown as typeof fetch
}

function emptyResponse(cursor = 0, events: BabyEvent[] = []) {
  return {
    serverTime: new Date().toISOString(),
    cursor,
    events,
    rejected: [],
    snapshot: { household: null, babies: [], members: [], reminders: {} },
  }
}

beforeEach(async () => {
  offline()
  await db.events.clear()
  await db.outbox.clear()
  await db.meta.clear()
})

describe('outbox', () => {
  it('stores the event locally before any network call', async () => {
    const event = make()
    await saveEvent(event)
    expect(await db.events.get(event.id)).toMatchObject({ id: event.id, type: 'diaper' })
    expect(await db.outbox.count()).toBe(1)
  })

  it('keeps queueing while offline and reports the pending count', async () => {
    await saveEvent(make())
    await saveEvent(make())
    await settle()
    expect(syncState().status).toBe('offline')
    expect(await db.outbox.count()).toBe(2)
  })

  it('collapses repeated edits of one event into a single mutation', async () => {
    const event = make()
    await saveEvent(event)
    await saveEvent({ ...event, note: 'primera corrección' })
    await saveEvent({ ...event, note: 'segunda corrección' })
    await settle()
    expect(await db.outbox.count()).toBe(3)

    let sent: BabyEvent[] = []
    globalThis.fetch = vi.fn(async (_url, init) => {
      sent = JSON.parse(String((init as RequestInit).body)).mutations as BabyEvent[]
      return new Response(JSON.stringify(emptyResponse(7)), { status: 200 })
    }) as unknown as typeof fetch

    await sync()
    expect(sent).toHaveLength(1)
    expect(sent[0]?.note).toBe('segunda corrección')
    expect(await db.outbox.count()).toBe(0)
  })

  it('empties the queue and advances the cursor on success', async () => {
    await saveEvent(make())
    await settle()
    respondWith(emptyResponse(42))
    await sync()
    expect(await db.outbox.count()).toBe(0)
    expect(await readMeta('cursor', 0)).toBe(42)
    expect(syncState().status).toBe('idle')
  })

  it('applies events coming back from the server', async () => {
    await settle()
    const remote = { ...make({ note: 'de otro móvil' }), serverSeq: 5 }
    respondWith(emptyResponse(5, [remote]))
    await sync()
    expect(await db.events.get(remote.id)).toMatchObject({ note: 'de otro móvil' })
  })

  it('counts attempts when the server fails, without losing the queue', async () => {
    await saveEvent(make())
    await settle()
    respondWith({ error: 'boom' }, false)
    await sync()
    expect(syncState().status).toBe('error')
    const [entry] = await db.outbox.toArray()
    expect(entry?.attempts).toBe(1)
    expect(await db.outbox.count()).toBe(1)
  })

  it('keeps an event the server rejected instead of dropping it', async () => {
    const event = make()
    await saveEvent(event)
    await settle()
    respondWith({ ...emptyResponse(3), rejected: [{ id: event.id, reason: 'Bebé desconocido para este hogar' }] })
    await sync()
    const [entry] = await db.outbox.toArray()
    expect(entry).toMatchObject({ eventId: event.id, attempts: 1, lastError: 'Bebé desconocido para este hogar' })
    expect(await db.events.get(event.id)).toBeTruthy()
  })

  it('never gives up on queued events after repeated failures', async () => {
    const event = make()
    await saveEvent(event)
    await settle()
    for (let i = 0; i < 25; i += 1) {
      respondWith({ error: 'boom' }, false)
      await sync()
    }
    let sent: BabyEvent[] = []
    globalThis.fetch = vi.fn(async (_url, init) => {
      sent = JSON.parse(String((init as RequestInit).body)).mutations as BabyEvent[]
      return new Response(JSON.stringify(emptyResponse(1)), { status: 200 })
    }) as unknown as typeof fetch
    await sync()
    expect(sent.map((item) => item.id)).toEqual([event.id])
    expect(await db.outbox.count()).toBe(0)
  })

  it('does not overwrite an edit made while the request was in flight', async () => {
    const event = make({ note: 'viejo' })
    await saveEvent(event)
    await settle()
    await saveEvent({ ...event, note: 'viejo otra vez' })
    globalThis.fetch = vi.fn(async () => {
      // The user edits again while the server is still answering.
      await db.outbox.add({
        eventId: event.id,
        event: { ...event, note: 'editado mientras tanto' },
        queuedAt: new Date().toISOString(),
        attempts: 0,
      })
      await db.events.put({ ...event, note: 'editado mientras tanto' })
      return new Response(JSON.stringify(emptyResponse(9, [{ ...event, note: 'viejo otra vez' }])), {
        status: 200,
      })
    }) as unknown as typeof fetch
    await sync()
    expect(await db.events.get(event.id)).toMatchObject({ note: 'editado mientras tanto' })
    expect(await db.outbox.count()).toBe(1)
  })

  it('sends a long queue in batches the server accepts', async () => {
    for (let i = 0; i < 1200; i += 1) {
      const event = make()
      await db.outbox.add({ eventId: event.id, event, queuedAt: new Date().toISOString(), attempts: 0 })
    }
    const sizes: number[] = []
    globalThis.fetch = vi.fn(async (_url, init) => {
      sizes.push((JSON.parse(String((init as RequestInit).body)).mutations as unknown[]).length)
      return new Response(JSON.stringify(emptyResponse(1)), { status: 200 })
    }) as unknown as typeof fetch
    await sync()
    expect(sizes).toEqual([500, 500, 200])
    expect(await db.outbox.count()).toBe(0)
  })

  it('marks a deletion as a normal mutation instead of dropping the row', async () => {
    const event = make()
    await saveEvent(event)
    await saveEvent({ ...event, deletedAt: new Date().toISOString() })
    const stored = await db.events.get(event.id)
    expect(stored?.deletedAt).toBeTruthy()
  })
})
