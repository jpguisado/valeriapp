import Dexie, { type Table } from 'dexie'
import type { BabyEvent } from '@shared/events'

/** Server rows carry a sequence number; local-only rows do not yet. */
export type StoredEvent = BabyEvent & { serverSeq?: number }

export interface OutboxEntry {
  /** Auto-incremented; the queue is processed in insertion order. */
  key?: number
  eventId: string
  /** Snapshot of the event as it was when queued. */
  event: BabyEvent
  queuedAt: string
  attempts: number
  lastError?: string
}

export interface MetaEntry {
  key: string
  value: unknown
}

export interface HouseholdSnapshot {
  household: {
    id: string
    name: string
    timezoneMode: 'device' | 'fixed'
    timezone: string
    backupEmail: string | null
    settleMinutes: number
  } | null
  babies: Array<{
    id: string
    name: string
    birthDate: string
    sex: 'female' | 'male' | null
    archived: boolean
  }>
  members: Array<{ id: string; displayName: string; username: string }>
  reminders: Record<string, unknown>
}

class ValeriaDatabase extends Dexie {
  events!: Table<StoredEvent, string>
  outbox!: Table<OutboxEntry, number>
  meta!: Table<MetaEntry, string>

  constructor() {
    super('valeriapp')
    this.version(1).stores({
      events: 'id, babyId, type, occurredAt, updatedAt, running, deletedAt',
      outbox: '++key, eventId, queuedAt',
      meta: 'key',
    })
  }
}

export const db = new ValeriaDatabase()

export async function readMeta<T>(key: string, fallback: T): Promise<T> {
  const row = await db.meta.get(key)
  return row ? (row.value as T) : fallback
}

export async function writeMeta(key: string, value: unknown): Promise<void> {
  await db.meta.put({ key, value })
}

/** Wipes every local trace; used on logout so a shared phone stays private. */
export async function clearLocalData(): Promise<void> {
  await db.transaction('rw', db.events, db.outbox, db.meta, async () => {
    await db.events.clear()
    await db.outbox.clear()
    await db.meta.clear()
  })
}
