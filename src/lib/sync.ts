/**
 * The offline engine, in one file.
 *
 * Writes always land in IndexedDB first and are queued in an outbox; the
 * network is an afterthought. Events are immutable facts with client-generated
 * UUIDs, so replaying the queue is idempotent and two devices editing the same
 * event resolve by last-write-wins on `updatedAt` — no CRDT needed for a log
 * of things that already happened.
 */
import { deviceTimezone } from '@shared/time'
import { normaliseTimedEvent, type BabyEvent } from '@shared/events'
import { api, OfflineError } from './api'
import { db, readMeta, writeMeta, type HouseholdSnapshot, type StoredEvent } from './db'

const CURSOR_KEY = 'cursor'
const SNAPSHOT_KEY = 'snapshot'
const LAST_SYNC_KEY = 'lastSyncAt'
/** Matches the server's per-request limit; a bigger queue goes in several rounds. */
const BATCH_SIZE = 500

export interface SyncResponse {
  serverTime: string
  cursor: number
  events: StoredEvent[]
  rejected: Array<{ id: string; reason: string }>
  snapshot: HouseholdSnapshot
}

export type SyncStatus = 'idle' | 'syncing' | 'offline' | 'error'

interface SyncState {
  status: SyncStatus
  pending: number
  lastSyncAt: string | null
  lastError: string | null
  /** Server clock minus device clock, in ms; surfaces a badly set phone. */
  clockSkewMs: number
}

type Listener = (state: SyncState) => void

let state: SyncState = {
  status: 'idle',
  pending: 0,
  lastSyncAt: null,
  lastError: null,
  clockSkewMs: 0,
}
const listeners = new Set<Listener>()
let busy = false
let inFlight: Promise<void> | null = null
let pendingRerun: Promise<void> | null = null

export function subscribeToSync(listener: Listener): () => void {
  listeners.add(listener)
  listener(state)
  return () => listeners.delete(listener)
}

function update(patch: Partial<SyncState>): void {
  state = { ...state, ...patch }
  for (const listener of listeners) listener(state)
}

export function syncState(): SyncState {
  return state
}

/** Queues a new or edited event. Returns as soon as it is safe on disk. */
export async function saveEvent(event: BabyEvent): Promise<void> {
  // The single choke point for every local write, so an interval event can
  // never be stored without either an end or a running flag.
  const stamped: BabyEvent = {
    ...normaliseTimedEvent(event),
    updatedAt: new Date().toISOString(),
  }
  await db.transaction('rw', db.events, db.outbox, async () => {
    await db.events.put(stamped as StoredEvent)
    await db.outbox.add({
      eventId: stamped.id,
      event: stamped,
      queuedAt: new Date().toISOString(),
      attempts: 0,
    })
  })
  update({ pending: await db.outbox.count() })

  void sync()
}

export async function deleteEvent(id: string): Promise<void> {
  const existing = await db.events.get(id)
  if (!existing) return
  await saveEvent({ ...existing, deletedAt: new Date().toISOString() })
}

export function newEvent(input: {
  babyId: string
  type: BabyEvent['type']
  occurredAt?: string
  endedAt?: string | null
  running?: boolean
  payload?: Record<string, unknown>
  note?: string | null
  createdBy: string
}): BabyEvent {
  const now = new Date().toISOString()
  return {
    id: crypto.randomUUID(),
    babyId: input.babyId,
    type: input.type,
    occurredAt: input.occurredAt ?? now,
    endedAt: input.endedAt ?? null,
    tz: deviceTimezone(),
    running: input.running ?? false,
    estimated: false,
    payload: input.payload ?? {},
    note: input.note ?? null,
    createdBy: input.createdBy,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  }
}

/**
 * Collapses the queue to one mutation per event: the newest wins. A queued
 * change is never skipped for having failed before; it stays until the server
 * has taken it.
 */
async function pendingMutations(): Promise<{ mutations: BabyEvent[]; keys: Map<string, number[]> }> {
  const entries = await db.outbox.orderBy('key').toArray()
  const latest = new Map<string, BabyEvent>()
  const keys = new Map<string, number[]>()
  for (const entry of entries) {
    latest.set(entry.eventId, entry.event)
    if (entry.key === undefined) continue
    keys.set(entry.eventId, [...(keys.get(entry.eventId) ?? []), entry.key])
  }
  return { mutations: [...latest.values()], keys }
}

/**
 * Callers always get a promise that resolves once their own data has had its
 * turn: anything queued while a run is in flight shares a single follow-up
 * run, instead of returning early and letting the caller believe the queue was
 * flushed.
 */
export function sync(): Promise<void> {
  if (!busy) return startRun()
  if (!pendingRerun) {
    pendingRerun = (inFlight ?? Promise.resolve()).then(() => {
      pendingRerun = null
      return startRun()
    })
  }
  return pendingRerun
}

function startRun(): Promise<void> {
  busy = true
  inFlight = runOnce().finally(() => {
    busy = false
    inFlight = null
  })
  return inFlight
}

async function runOnce(): Promise<void> {
  update({ status: 'syncing' })

  try {
    const { mutations, keys } = await pendingMutations()
    let response: SyncResponse | null = null
    const rejected: SyncResponse['rejected'] = []

    // At least one round, even with nothing to send, to pull what others did.
    for (let from = 0; from === 0 || from < mutations.length; from += BATCH_SIZE) {
      const batch = mutations.slice(from, from + BATCH_SIZE)
      const cursor = await readMeta<number>(CURSOR_KEY, 0)
      response = await api.post<SyncResponse>('/api/sync', { cursor, mutations: batch })
      rejected.push(...response.rejected)
      await applyResponse(response, batch, keys)
    }
    if (!response) return

    if (rejected.length > 0) {
      console.warn('[sync] el servidor rechazó eventos', rejected)
    }

    update({
      status: 'idle',
      pending: await db.outbox.count(),
      lastSyncAt: response.serverTime,
      lastError: rejected[0]?.reason ?? null,
      clockSkewMs: Date.parse(response.serverTime) - Date.now(),
    })
  } catch (error) {
    if (error instanceof OfflineError) {
      update({ status: 'offline', pending: await db.outbox.count() })
    } else {
      await noteFailure((error as Error).message)
      update({ status: 'error', lastError: (error as Error).message, pending: await db.outbox.count() })
    }
  }
}

async function applyResponse(
  response: SyncResponse,
  sent: BabyEvent[],
  keys: Map<string, number[]>,
): Promise<void> {
  const refused = new Set(response.rejected.map((item) => item.id))
  const reasons = new Map(response.rejected.map((item) => [item.id, item.reason]))

  await db.transaction('rw', db.events, db.outbox, db.meta, async () => {
    // Only drop queue entries the server actually took. A rejected event stays
    // queued: dropping it would leave it on this phone alone, for good.
    const taken: number[] = []
    for (const event of sent) {
      const eventKeys = keys.get(event.id) ?? []
      if (refused.has(event.id)) {
        for (const key of eventKeys) {
          const entry = await db.outbox.get(key)
          if (entry) await db.outbox.update(key, { attempts: entry.attempts + 1, lastError: reasons.get(event.id) })
        }
      } else {
        taken.push(...eventKeys)
      }
    }
    if (taken.length > 0) await db.outbox.bulkDelete(taken)

    // What is still queued is newer than whatever the server sends back for
    // it, so the server copy must not overwrite it.
    const stillQueued = new Set((await db.outbox.toArray()).map((entry) => entry.eventId))
    const incoming = response.events.filter((event) => !stillQueued.has(event.id))
    if (incoming.length > 0) await db.events.bulkPut(incoming)

    await db.meta.put({ key: CURSOR_KEY, value: response.cursor })
    await db.meta.put({ key: SNAPSHOT_KEY, value: response.snapshot })
    await db.meta.put({ key: LAST_SYNC_KEY, value: response.serverTime })
  })
}

async function noteFailure(message: string): Promise<void> {
  const entries = await db.outbox.toArray()
  await db.transaction('rw', db.outbox, async () => {
    for (const entry of entries) {
      if (entry.key === undefined) continue
      await db.outbox.update(entry.key, { attempts: entry.attempts + 1, lastError: message })
    }
  })
}

export async function loadSnapshot(): Promise<HouseholdSnapshot | null> {
  return readMeta<HouseholdSnapshot | null>(SNAPSHOT_KEY, null)
}

export async function resetCursor(): Promise<void> {
  await writeMeta(CURSOR_KEY, 0)
}

let interval: number | null = null

/** Sync on the four moments that matter: start, focus, reconnect, and a slow tick. */
export function startSyncLoop(): () => void {
  const onOnline = (): void => void sync()
  const onVisible = (): void => {
    if (document.visibilityState === 'visible') void sync()
  }
  window.addEventListener('online', onOnline)
  document.addEventListener('visibilitychange', onVisible)
  interval = window.setInterval(() => void sync(), 60_000)
  void sync()

  return () => {
    window.removeEventListener('online', onOnline)
    document.removeEventListener('visibilitychange', onVisible)
    if (interval) window.clearInterval(interval)
    interval = null
  }
}
