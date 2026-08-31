import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { BabyEvent } from '@shared/events'
import { activeNightId, nightIdOf } from '@shared/night'
import { db } from './db'
import { endNight, startNight } from './night'
import { newEvent, saveEvent } from './sync'

const BABY = '11111111-1111-4111-8111-111111111111'
const USER = '22222222-2222-4222-8222-222222222222'

async function stored(): Promise<BabyEvent[]> {
  const rows = await db.events.where('babyId').equals(BABY).toArray()
  return rows.filter((row) => !row.deletedAt).sort((a, b) => a.occurredAt.localeCompare(b.occurredAt))
}

const sleeps = async (): Promise<BabyEvent[]> =>
  (await stored()).filter((event) => event.type === 'sleep')

beforeEach(async () => {
  // Sin red: la cola se queda pendiente y no estorba.
  globalThis.fetch = vi.fn(async () => {
    throw new TypeError('Failed to fetch')
  }) as unknown as typeof fetch
  await db.events.clear()
  await db.outbox.clear()
  await db.meta.clear()
})

describe('el modo «A dormir»', () => {
  it('abre la noche con un tramo de sueño en curso', async () => {
    await startNight(BABY, USER)
    const [sleep] = await sleeps()
    expect(sleep?.running).toBe(true)
    expect(nightIdOf(sleep as BabyEvent)).toBeTruthy()
    expect((sleep?.payload as { inferred?: boolean }).inferred).toBe(true)
  })

  it('adopta una siesta que ya estaba corriendo en vez de cortarla', async () => {
    const nap = newEvent({ babyId: BABY, type: 'sleep', running: true, createdBy: USER })
    await saveEvent(nap)
    await startNight(BABY, USER)

    const all = await sleeps()
    expect(all).toHaveLength(1)
    expect(all[0]?.id).toBe(nap.id)
    expect(nightIdOf(all[0] as BabyEvent)).toBeTruthy()
  })

  it('no abre dos noches a la vez', async () => {
    await startNight(BABY, USER)
    await startNight(BABY, USER)
    expect(await sleeps()).toHaveLength(1)
  })

  it('corta el sueño mientras dura la toma y lo reanuda tras la rutina', async () => {
    await startNight(BABY, USER)

    const feedStart = Date.now()
    const feed = {
      ...newEvent({ babyId: BABY, type: 'breast', running: true, createdBy: USER }),
      occurredAt: new Date(feedStart).toISOString(),
    }
    await saveEvent(feed)

    // Con la toma abierta, la noche sigue viva pero no hay sueño corriendo.
    let all = await sleeps()
    expect(all).toHaveLength(1)
    expect(all[0]?.running).toBe(false)
    expect((all[0]?.payload as { awaiting?: string }).awaiting).toBe(feed.id)
    expect(activeNightId(await stored())).toBeTruthy()

    const feedEnd = feedStart + 30 * 60_000
    await saveEvent({
      ...feed,
      running: false,
      endedAt: new Date(feedEnd).toISOString(),
      payload: { side: 'left', firstSide: 'left', leftSeconds: 1800 },
    })

    all = await sleeps()
    expect(all).toHaveLength(2)
    const resumed = all[1] as BabyEvent
    expect(resumed.running).toBe(true)
    // 30 minutos de toma más los 25 de rutina por defecto.
    expect(Date.parse(resumed.occurredAt)).toBe(feedEnd + 25 * 60_000)
    expect(nightIdOf(resumed)).toBe(nightIdOf(all[0] as BabyEvent))
  })

  it('un evento instantáneo corta y reanuda de una vez', async () => {
    await startNight(BABY, USER)
    const at = Date.now()
    await saveEvent({
      ...newEvent({ babyId: BABY, type: 'diaper', createdBy: USER, payload: { kind: 'pee' } }),
      occurredAt: new Date(at).toISOString(),
    })

    const all = await sleeps()
    expect(all).toHaveLength(2)
    expect(all[0]?.running).toBe(false)
    expect(Date.parse(all[1]?.occurredAt as string)).toBe(at + 25 * 60_000)
  })

  it('la extracción no la despierta y no corta nada', async () => {
    await startNight(BABY, USER)
    await saveEvent(
      newEvent({ babyId: BABY, type: 'pump', createdBy: USER, payload: { side: 'both', ml: 60 } }),
    )
    const all = await sleeps()
    expect(all).toHaveLength(1)
    expect(all[0]?.running).toBe(true)
  })

  it('un desvelo reanuda justo al terminar, sin cola', async () => {
    await startNight(BABY, USER)
    const from = Date.now()
    const to = from + 40 * 60_000
    await saveEvent({
      ...newEvent({ babyId: BABY, type: 'wakeup', createdBy: USER }),
      occurredAt: new Date(from).toISOString(),
      endedAt: new Date(to).toISOString(),
    })

    const all = await sleeps()
    expect(all).toHaveLength(2)
    expect(Date.parse(all[1]?.occurredAt as string)).toBe(to)
  })

  it('lo ocurrido antes de empezar la noche no la corta', async () => {
    await startNight(BABY, USER)
    await saveEvent({
      ...newEvent({ babyId: BABY, type: 'diaper', createdBy: USER, payload: { kind: 'poo' } }),
      occurredAt: new Date(Date.now() - 60 * 60_000).toISOString(),
    })
    const all = await sleeps()
    expect(all).toHaveLength(1)
    expect(all[0]?.running).toBe(true)
  })

  it('los buenos días cierran la noche y dan por buenos los tramos', async () => {
    await startNight(BABY, USER)
    await saveEvent({
      ...newEvent({ babyId: BABY, type: 'diaper', createdBy: USER, payload: { kind: 'poo' } }),
      occurredAt: new Date().toISOString(),
    })

    await endNight(BABY)

    const all = await sleeps()
    expect(all.length).toBeGreaterThanOrEqual(2)
    for (const segment of all) {
      expect(segment.running).toBe(false)
      expect(segment.endedAt).toBeTruthy()
      expect((segment.payload as { inferred?: boolean }).inferred).toBeUndefined()
      expect((segment.payload as { awaiting?: string }).awaiting).toBeUndefined()
    }
    expect(activeNightId(await stored())).toBeNull()
  })
})
