import { describe, expect, it } from 'vitest'
import {
  payloadSchemas,
  finishSleepPayload,
  isSleepPaused,
  pauseSleepPayload,
  resumableIds,
  resumableSleepId,
  resumeSleepPayload,
  sleptSeconds,
  breastFeedingSeconds,
  breastSplit,
  finishBreastPayload,
  firstSideOf,
  endingSideOf,
  isBreastPaused,
  lastBreastSide,
  normaliseTimedEvent,
  pauseBreastPayload,
  reopenBreastPayload,
  resumableBreastId,
  resumeBreastPayload,
  startBreastPayload,
  switchBreastPayload,
  withShiftedStart,
  type BabyEvent,
} from './events.js'

const START = Date.parse('2026-08-30T08:00:00.000Z')

function feed(
  payload: Record<string, unknown>,
  running = true,
  endedAt: string | null = null,
): BabyEvent {
  return {
    id: '00000000-0000-4000-8000-000000000001',
    babyId: '11111111-1111-4111-8111-111111111111',
    type: 'breast',
    occurredAt: new Date(START).toISOString(),
    endedAt,
    tz: 'Europe/Madrid',
    running,
    estimated: false,
    payload,
    note: null,
    createdBy: '22222222-2222-4222-8222-222222222222',
    createdAt: new Date(START).toISOString(),
    updatedAt: new Date(START).toISOString(),
    deletedAt: null,
  }
}

describe('breast side segments', () => {
  it('accumulates the running segment on the active side', () => {
    const event = feed(startBreastPayload('left', new Date(START).toISOString()))
    const split = breastSplit(event, START + 10 * 60_000)
    expect(split.leftSeconds).toBe(600)
    expect(split.rightSeconds).toBe(0)
    expect(split.activeSide).toBe('left')
  })

  it('switches sides without ending the feed', () => {
    const event = feed(startBreastPayload('left', new Date(START).toISOString()))
    const switched = feed(switchBreastPayload(event, START + 8 * 60_000))

    expect(switched.payload.activeSide).toBe('right')
    expect(switched.payload.leftSeconds).toBe(480)
    expect(switched.payload.side).toBe('both')
    expect(firstSideOf(switched)).toBe('left')

    const split = breastSplit(switched, START + 20 * 60_000)
    expect(split.leftSeconds).toBe(480)
    expect(split.rightSeconds).toBe(720)
  })

  it('closes the last segment and summarises the feed as both sides', () => {
    const started = feed(startBreastPayload('right', new Date(START).toISOString()))
    const switched = feed(switchBreastPayload(started, START + 5 * 60_000))
    const finished = finishBreastPayload(switched, START + 12 * 60_000)

    expect(finished.side).toBe('both')
    expect(finished.firstSide).toBe('right')
    expect(finished.rightSeconds).toBe(300)
    expect(finished.leftSeconds).toBe(420)
    expect(finished.segmentStartedAt).toBeUndefined()
    // El lado en el que terminó se conserva: es por donde se reanudaría.
    expect(finished.activeSide).toBe('left')
  })

  it('keeps a single-sided feed single-sided', () => {
    const started = feed(startBreastPayload('left', new Date(START).toISOString()))
    const finished = finishBreastPayload(started, START + 9 * 60_000)
    expect(finished.side).toBe('left')
    expect(finished.leftSeconds).toBe(540)
    expect(finished.rightSeconds).toBe(0)
  })

  it('still reads events recorded before side switching existed', () => {
    const legacy = feed({ side: 'right' }, false, new Date(START + 15 * 60_000).toISOString())
    const split = breastSplit(legacy, START + 60 * 60_000)
    expect(split.rightSeconds).toBe(900)
    expect(split.leftSeconds).toBe(0)
    expect(firstSideOf(legacy)).toBe('right')
  })

  it('reports no starting side for a legacy feed recorded as both', () => {
    const legacy = feed({ side: 'both' }, false, new Date(START + 20 * 60_000).toISOString())
    expect(firstSideOf(legacy)).toBeNull()
    const split = breastSplit(legacy, START)
    expect(split.leftSeconds).toBe(600)
    expect(split.rightSeconds).toBe(600)
  })
})

describe('pausing a feed', () => {
  it('stops the clock without closing the feed', () => {
    const started = feed(startBreastPayload('left', new Date(START).toISOString()))
    const paused = feed(pauseBreastPayload(started, START + 6 * 60_000))

    expect(paused.payload.pausedAt).toBeTruthy()
    expect(paused.payload.leftSeconds).toBe(360)
    expect(paused.running).toBe(true)
    expect(isBreastPaused(paused)).toBe(true)

    // Ten minutes later, still paused: nothing has accrued.
    expect(breastFeedingSeconds(paused, START + 16 * 60_000)).toBe(360)
  })

  it('resumes on the same side and keeps counting', () => {
    const started = feed(startBreastPayload('left', new Date(START).toISOString()))
    const paused = feed(pauseBreastPayload(started, START + 6 * 60_000))
    const resumed = feed(resumeBreastPayload(paused, START + 16 * 60_000))

    expect(isBreastPaused(resumed)).toBe(false)
    expect(resumed.payload.activeSide).toBe('left')
    expect(breastFeedingSeconds(resumed, START + 20 * 60_000)).toBe(360 + 240)
  })

  it('excludes the pause from the finished feed', () => {
    const started = feed(startBreastPayload('right', new Date(START).toISOString()))
    const paused = feed(pauseBreastPayload(started, START + 5 * 60_000))
    const resumed = feed(resumeBreastPayload(paused, START + 25 * 60_000))
    const finished = finishBreastPayload(resumed, START + 30 * 60_000)

    // 30 minutes on the clock, 10 minutes actually feeding.
    expect(finished.rightSeconds).toBe(600)
    expect(finished.leftSeconds).toBe(0)
    expect(finished.side).toBe('right')
    expect(finished.pausedAt).toBeUndefined()
  })

  it('treats a switch of sides as resuming', () => {
    const started = feed(startBreastPayload('left', new Date(START).toISOString()))
    const paused = feed(pauseBreastPayload(started, START + 4 * 60_000))
    const switched = feed(switchBreastPayload(paused, START + 14 * 60_000))

    expect(isBreastPaused(switched)).toBe(false)
    expect(switched.payload.activeSide).toBe('right')
    expect(switched.payload.leftSeconds).toBe(240)
    expect(breastFeedingSeconds(switched, START + 20 * 60_000)).toBe(240 + 360)
  })

  it('closing a feed while paused adds nothing extra', () => {
    const started = feed(startBreastPayload('left', new Date(START).toISOString()))
    const paused = feed(pauseBreastPayload(started, START + 7 * 60_000))
    const finished = finishBreastPayload(paused, START + 40 * 60_000)
    expect(finished.leftSeconds).toBe(420)
  })
})

describe('correcting the start time', () => {
  it('moves a sleep back without touching anything else', () => {
    const sleep: BabyEvent = { ...feed({}), type: 'sleep', payload: {} }
    const corrected = withShiftedStart(sleep, START - 40 * 60_000)
    expect(Date.parse(corrected.occurredAt)).toBe(START - 40 * 60_000)
    expect(corrected.payload).toEqual({})
  })

  it('drags the open segment with the start when it is the first one', () => {
    const event = feed(startBreastPayload('left', new Date(START).toISOString()))
    const corrected = withShiftedStart(event, START - 10 * 60_000)
    const moved = feed(corrected.payload as Record<string, unknown>)

    expect(corrected.payload.segmentStartedAt).toBe(new Date(START - 10 * 60_000).toISOString())
    // Ten minutes earlier means ten more minutes at the breast.
    expect(breastFeedingSeconds({ ...moved, occurredAt: corrected.occurredAt }, START + 5 * 60_000)).toBe(
      15 * 60,
    )
  })

  it('gives the recovered minutes to the breast she started on', () => {
    const started = feed(startBreastPayload('right', new Date(START).toISOString()))
    const switched = feed(switchBreastPayload(started, START + 6 * 60_000))
    const corrected = withShiftedStart(
      { ...switched, occurredAt: new Date(START).toISOString() },
      START - 8 * 60_000,
    )

    // 6 minutes already on the right, plus the 8 recovered.
    expect((corrected.payload as { rightSeconds: number }).rightSeconds).toBe(14 * 60)
    expect((corrected.payload as { leftSeconds: number }).leftSeconds).toBe(0)
  })

  it('keeps a paused feed paused when its start is corrected', () => {
    const started = feed(startBreastPayload('left', new Date(START).toISOString()))
    const paused = feed(pauseBreastPayload(started, START + 5 * 60_000))
    const corrected = withShiftedStart(paused, START - 5 * 60_000)
    const moved = feed(corrected.payload as Record<string, unknown>)

    expect(isBreastPaused(moved)).toBe(true)
    // 5 minutes recorded plus the 5 recovered, and the pause still holds them.
    expect(breastFeedingSeconds(moved, START + 60 * 60_000)).toBe(10 * 60)
  })
})

describe('an interval event is never left in limbo', () => {
  it('turns a sleep with no end into a running one', () => {
    const ghost: BabyEvent = { ...feed({}), type: 'sleep', payload: {}, running: false, endedAt: null }
    expect(normaliseTimedEvent(ghost).running).toBe(true)
  })

  it('clears the running flag on something that already ended', () => {
    const finished: BabyEvent = {
      ...feed({}, true, new Date(START + 60_000).toISOString()),
      type: 'sleep',
      payload: {},
    }
    expect(normaliseTimedEvent(finished).running).toBe(false)
  })

  it('opens a segment when a feed becomes live, so its clock moves', () => {
    const ghost = feed({ side: 'left' }, false, null)
    const fixed = normaliseTimedEvent(ghost)

    expect(fixed.running).toBe(true)
    expect((fixed.payload as { activeSide?: string }).activeSide).toBe('left')
    expect(breastFeedingSeconds(fixed, START + 12 * 60_000)).toBe(12 * 60)
  })

  it('does not count typed minutes twice', () => {
    const ghost = feed(
      { side: 'right', firstSide: 'right', rightSeconds: 600, leftSeconds: 0 },
      false,
      null,
    )
    const fixed = normaliseTimedEvent(ghost, START)
    // The ten typed minutes stand; the open segment starts from now.
    expect(breastFeedingSeconds(fixed, START)).toBe(600)
    expect(breastFeedingSeconds(fixed, START + 5 * 60_000)).toBe(900)
  })

  it('leaves instant events alone', () => {
    const diaper: BabyEvent = { ...feed({}), type: 'diaper', payload: { kind: 'pee' } }
    expect(normaliseTimedEvent(diaper)).toBe(diaper)
  })
})

describe('el último pecho con registro', () => {
  it('es aquel en el que terminó la toma más reciente', () => {
    const events = [
      feed({ side: 'both', firstSide: 'right', leftSeconds: 1526, rightSeconds: 8 }, false,
        new Date(START + 30 * 60_000).toISOString()),
      { ...feed({ side: 'left', firstSide: 'left', leftSeconds: 600 }, false,
        new Date(START - 60 * 60_000).toISOString()), occurredAt: new Date(START - 90 * 60_000).toISOString() },
    ]
    // Empezó por el derecho por sugerencia, se corrigió a los 8 s y mamó del
    // izquierdo: lo último con registro es el izquierdo.
    expect(lastBreastSide(events)).toBe('left')
  })

  it('no inventa nada cuando todavía no hay tomas', () => {
    expect(lastBreastSide([])).toBeNull()
  })

  it('ignora las tomas borradas', () => {
    const borrada = { ...feed({ side: 'right', rightSeconds: 300 }, false, new Date(START).toISOString()),
      deletedAt: new Date().toISOString() }
    expect(lastBreastSide([borrada])).toBeNull()
  })
})

describe('reanudar una toma parada por error', () => {
  it('solo ofrece la última toma de pecho, y solo si está parada', () => {
    const vieja = { ...feed({ side: 'left' }, false, new Date(START).toISOString()),
      id: 'a', occurredAt: new Date(START - 3600_000).toISOString() }
    const ultima = { ...feed({ side: 'right' }, false, new Date(START + 600_000).toISOString()), id: 'b' }
    expect(resumableBreastId([vieja, ultima])).toBe('b')

    const corriendo = { ...ultima, running: true, endedAt: null }
    expect(resumableBreastId([vieja, corriendo])).toBeNull()
  })

  it('reabre por el pecho en el que se había quedado, sin perder lo contado', () => {
    const parada = feed(
      { side: 'both', firstSide: 'left', activeSide: 'right', leftSeconds: 600, rightSeconds: 300 },
      false,
      new Date(START + 15 * 60_000).toISOString(),
    )
    const reabierta = feed(reopenBreastPayload(parada, START + 20 * 60_000))

    expect(reabierta.payload.activeSide).toBe('right')
    expect(reabierta.payload.leftSeconds).toBe(600)
    expect(reabierta.payload.rightSeconds).toBe(300)
    // Cinco minutos más en el derecho tras reanudar.
    expect(breastFeedingSeconds(reabierta, START + 25 * 60_000)).toBe(600 + 300 + 300)
  })

  it('deduce el lado en las tomas guardadas antes de este cambio', () => {
    const antigua = feed({ side: 'both', firstSide: 'left', leftSeconds: 600, rightSeconds: 300 }, false,
      new Date(START + 15 * 60_000).toISOString())
    expect(endingSideOf(antigua)).toBe('right')

    const unSoloLado = feed({ side: 'left', leftSeconds: 900 }, false, new Date(START).toISOString())
    expect(endingSideOf(unSoloLado)).toBe('left')
  })
})

describe('lactancia mixta', () => {
  it('conserva el suplemento al parar la toma', () => {
    const conSuplemento = feed({
      side: 'left', firstSide: 'left', activeSide: 'left',
      segmentStartedAt: new Date(START).toISOString(),
      leftSeconds: 0, rightSeconds: 0,
      supplementMl: 60, supplementKind: 'formula',
    })
    const finished = finishBreastPayload(conSuplemento, START + 12 * 60_000)
    expect(finished.supplementMl).toBe(60)
    expect(finished.supplementKind).toBe('formula')
    expect(finished.leftSeconds).toBe(720)
  })
})

describe('pausar el sueño, igual que una toma', () => {
  const sueño = (over: Partial<BabyEvent> = {}): BabyEvent =>
    ({
      id: 's1',
      babyId: 'b1',
      type: 'sleep',
      occurredAt: '2026-09-03T13:10:00.000Z',
      endedAt: null,
      running: true,
      estimated: false,
      payload: {},
      deletedAt: null,
      ...over,
    }) as unknown as BabyEvent

  const AHORA = Date.parse('2026-09-03T14:51:00.000Z')

  it('la pausa para el reloj sin cerrar el sueño', () => {
    const payload = pauseSleepPayload(sueño(), Date.parse('2026-09-03T13:23:00.000Z'))
    expect(payload.pausedAt).toBe('2026-09-03T13:23:00.000Z')
    expect(isSleepPaused({ type: 'sleep', payload })).toBe(true)
  })

  it('al reanudar, el rato despierta queda anotado', () => {
    const pausado = sueño({ payload: { pausedAt: '2026-09-03T13:23:00.000Z' } })
    const payload = resumeSleepPayload(pausado, Date.parse('2026-09-03T13:29:00.000Z'))
    expect(payload.pausedAt).toBeUndefined()
    expect(payload.awake).toEqual([
      { from: '2026-09-03T13:23:00.000Z', to: '2026-09-03T13:29:00.000Z' },
    ])
  })

  /** La siesta real del 3 de septiembre, que quedó partida en tres registros. */
  it('una siesta con dos pausas es un solo sueño de 92 minutos', () => {
    const siesta = sueño({
      endedAt: '2026-09-03T14:51:00.000Z',
      running: false,
      payload: {
        awake: [
          { from: '2026-09-03T13:23:00.000Z', to: '2026-09-03T13:29:00.000Z' },
          { from: '2026-09-03T14:32:00.000Z', to: '2026-09-03T14:35:00.000Z' },
        ],
      },
    })
    // 101 minutos de reloj menos 6 y 3 despierta: 92, la suma de los tramos.
    expect(Math.round(sleptSeconds(siesta, AHORA) / 60)).toBe(92)
  })

  it('mientras está en pausa el reloj no corre', () => {
    const pausado = sueño({ payload: { pausedAt: '2026-09-03T13:23:00.000Z' } })
    expect(Math.round(sleptSeconds(pausado, AHORA) / 60)).toBe(13)
  })

  it('parar un sueño en pausa lo cierra donde se despertó', () => {
    const pausado = sueño({ payload: { pausedAt: '2026-09-03T13:23:00.000Z' } })
    expect(finishSleepPayload(pausado).pausedAt).toBeUndefined()
  })

  it('el último sueño parado se puede reabrir; uno en curso no', () => {
    const parado = sueño({ running: false, endedAt: '2026-09-03T14:51:00.000Z' })
    expect(resumableSleepId([parado])).toBe('s1')
    expect(resumableSleepId([sueño()])).toBeNull()
  })

  it('se puede reabrir la última toma y el último sueño a la vez', () => {
    const parado = sueño({ running: false, endedAt: '2026-09-03T14:51:00.000Z' })
    const toma = sueño({ id: 'p1', type: 'breast', running: false, endedAt: '2026-09-03T12:00:00.000Z' })
    expect([...resumableIds([parado, toma])].sort()).toEqual(['p1', 's1'])
  })
})
