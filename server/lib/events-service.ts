import { and, asc, eq, gt, isNotNull, lt, sql } from 'drizzle-orm'
import {
  AUTO_CLOSE_SECONDS,
  finishBreastPayload,
  isTimedType,
  normaliseTimedEvent,
  type BabyEvent,
  type EventType,
} from '../../shared/events.js'
import { db } from '../db/client.js'
import { babies, eventRevisions, events, type EventRow } from '../db/schema.js'
import { cancelOnHousehold } from './push.js'

const NEXT_SEQ = sql`nextval('events_server_seq')`

export function rowToWire(row: EventRow): BabyEvent & { serverSeq: number; receivedAt: string } {
  return {
    id: row.id,
    babyId: row.babyId,
    type: row.type as EventType,
    occurredAt: row.occurredAt.toISOString(),
    endedAt: row.endedAt ? row.endedAt.toISOString() : null,
    tz: row.tz,
    running: row.running,
    estimated: row.estimated,
    payload: (row.payload ?? {}) as Record<string, unknown>,
    note: row.note,
    createdBy: row.createdBy,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    deletedAt: row.deletedAt ? row.deletedAt.toISOString() : null,
    serverSeq: Number(row.serverSeq),
    receivedAt: row.receivedAt.toISOString(),
  }
}

export interface UpsertResult {
  row: EventRow
  applied: boolean
}

/**
 * Last-write-wins on `updatedAt`, which is what an append-mostly log of
 * immutable facts needs: two devices editing the same event within the same
 * millisecond is not a scenario worth a CRDT.
 */
export async function upsertEvent(
  actorId: string,
  householdId: string,
  raw: BabyEvent,
): Promise<UpsertResult> {
  // Same guard as the client: an older build must not be able to store an
  // interval event that is neither running nor finished.
  const incoming = normaliseTimedEvent(raw)
  const [existing] = await db.select().from(events).where(eq(events.id, incoming.id)).limit(1)

  if (existing && existing.householdId !== householdId) {
    throw new Error('El evento pertenece a otro hogar')
  }
  if (existing && existing.updatedAt.toISOString() > incoming.updatedAt) {
    return { row: existing, applied: false }
  }

  const [baby] = await db.select().from(babies).where(eq(babies.id, incoming.babyId)).limit(1)
  if (!baby || baby.householdId !== householdId) {
    throw new Error('Bebé desconocido para este hogar')
  }

  const values = {
    id: incoming.id,
    householdId,
    babyId: incoming.babyId,
    type: incoming.type,
    occurredAt: new Date(incoming.occurredAt),
    endedAt: incoming.endedAt ? new Date(incoming.endedAt) : null,
    tz: incoming.tz,
    running: incoming.running,
    estimated: incoming.estimated,
    payload: incoming.payload,
    note: incoming.note,
    createdBy: existing?.createdBy ?? actorId,
    createdAt: new Date(incoming.createdAt),
    updatedAt: new Date(incoming.updatedAt),
    deletedAt: incoming.deletedAt ? new Date(incoming.deletedAt) : null,
    receivedAt: new Date(),
    serverSeq: NEXT_SEQ as unknown as number,
  }

  const [row] = await db
    .insert(events)
    .values(values)
    .onConflictDoUpdate({
      target: events.id,
      set: {
        type: values.type,
        occurredAt: values.occurredAt,
        endedAt: values.endedAt,
        tz: values.tz,
        running: values.running,
        estimated: values.estimated,
        payload: values.payload,
        note: values.note,
        updatedAt: values.updatedAt,
        deletedAt: values.deletedAt,
        receivedAt: values.receivedAt,
        serverSeq: NEXT_SEQ as unknown as number,
      },
    })
    .returning()

  const stored = row as EventRow
  const action = !existing ? 'create' : incoming.deletedAt && !existing.deletedAt ? 'delete' : 'update'
  await db.insert(eventRevisions).values({
    eventId: stored.id,
    action,
    actorId,
    snapshot: rowToWire(stored),
  })

  if (action !== 'delete' && !stored.deletedAt) {
    await cancelRemindersResolvedBy(householdId, stored)
  }
  return { row: stored, applied: true }
}

/** Recording the awaited event silences the matching reminder everywhere. */
async function cancelRemindersResolvedBy(householdId: string, row: EventRow): Promise<void> {
  const tags: string[] = []
  if (row.type === 'breast' || row.type === 'bottle') tags.push('feed', 'breast_alternation')
  if (row.type === 'diaper') tags.push('diaper_wet', 'diaper_poo')
  if (row.type === 'pump') tags.push('pump')
  await Promise.all(tags.map((tag) => cancelOnHousehold(householdId, `${tag}:${row.babyId}`)))
}

export async function eventsSince(householdId: string, cursor: number, limit = 2000) {
  const rows = await db
    .select()
    .from(events)
    .where(and(eq(events.householdId, householdId), gt(events.serverSeq, cursor)))
    .orderBy(asc(events.serverSeq))
    .limit(limit)
  return rows.map(rowToWire)
}

export async function allEventsOfHousehold(householdId: string) {
  const rows = await db
    .select()
    .from(events)
    .where(eq(events.householdId, householdId))
    .orderBy(asc(events.occurredAt))
  return rows.map(rowToWire)
}

export async function revisionsOf(eventId: string) {
  return db
    .select()
    .from(eventRevisions)
    .where(eq(eventRevisions.eventId, eventId))
    .orderBy(asc(eventRevisions.at))
}

/**
 * Closes timers somebody forgot to stop, marking the duration as estimated so
 * the UI can ask "did it really last 2 h?" instead of silently inventing data.
 */
export async function autoCloseStaleTimers(now = new Date()): Promise<number> {
  const running = await db
    .select()
    .from(events)
    .where(and(eq(events.running, true), isNotNull(events.occurredAt)))

  let closed = 0
  for (const row of running) {
    if (!isTimedType(row.type as EventType)) continue
    const limitSeconds = AUTO_CLOSE_SECONDS[row.type as keyof typeof AUTO_CLOSE_SECONDS]
    const elapsed = (now.getTime() - row.occurredAt.getTime()) / 1000
    if (elapsed < limitSeconds) continue

    const endedAt = new Date(row.occurredAt.getTime() + limitSeconds * 1000)
    // A breast feed also has to close its in-progress side segment.
    const payload =
      row.type === 'breast'
        ? finishBreastPayload(
            {
              type: 'breast',
              payload: (row.payload ?? {}) as Record<string, unknown>,
              occurredAt: row.occurredAt.toISOString(),
              endedAt: null,
              running: true,
            },
            endedAt.getTime(),
          )
        : (row.payload as Record<string, unknown>)

    const [updated] = await db
      .update(events)
      .set({
        running: false,
        estimated: true,
        endedAt,
        payload,
        updatedAt: now,
        serverSeq: NEXT_SEQ as unknown as number,
      })
      .where(eq(events.id, row.id))
      .returning()
    if (updated) {
      await db.insert(eventRevisions).values({
        eventId: row.id,
        action: 'auto_close',
        actorId: null,
        snapshot: rowToWire(updated),
      })
      closed += 1
    }
  }
  return closed
}

/** Events of the last `days` days, used by the reminder scheduler. */
export async function recentEvents(babyId: string, days: number): Promise<BabyEvent[]> {
  const since = new Date(Date.now() - days * 86_400_000)
  const rows = await db
    .select()
    .from(events)
    .where(and(eq(events.babyId, babyId), gt(events.occurredAt, since)))
    .orderBy(asc(events.occurredAt))
  return rows.map(rowToWire)
}

export async function purgeOldRevisions(keepDays = 400): Promise<void> {
  await db
    .delete(eventRevisions)
    .where(lt(eventRevisions.at, new Date(Date.now() - keepDays * 86_400_000)))
}
