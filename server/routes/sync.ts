import { Hono } from 'hono'
import { z } from 'zod'
import { and, eq } from 'drizzle-orm'
import { babyEventSchema } from '../../shared/events.js'
import { ageInMonths } from '../../shared/time.js'
import { db } from '../db/client.js'
import { babies, households, users } from '../db/schema.js'
import { eventsSince, revisionsOf, upsertEvent } from '../lib/events-service.js'
import { settingsForBaby } from '../lib/scheduler.js'
import { requireAuth, type AppEnv } from '../lib/http.js'

const syncRequest = z.object({
  cursor: z.number().int().min(0).default(0),
  mutations: z.array(babyEventSchema).max(500).default([]),
})

export const syncRoutes = new Hono<AppEnv>()

syncRoutes.use('*', requireAuth)

/**
 * The whole offline story in one endpoint: push what the device queued, pull
 * everything the household changed since the device's cursor.
 */
syncRoutes.post('/', async (c) => {
  const user = c.get('user')
  const parsed = syncRequest.safeParse(await c.req.json().catch(() => ({})))
  if (!parsed.success) {
    return c.json({ error: parsed.error.issues[0]?.message ?? 'Petición inválida' }, 400)
  }

  const rejected: Array<{ id: string; reason: string }> = []
  for (const mutation of parsed.data.mutations) {
    try {
      await upsertEvent(user.id, user.householdId, mutation)
    } catch (error) {
      rejected.push({ id: mutation.id, reason: (error as Error).message })
    }
  }

  const changes = await eventsSince(user.householdId, parsed.data.cursor)
  const nextCursor = changes.reduce((max, event) => Math.max(max, event.serverSeq), parsed.data.cursor)

  return c.json({
    serverTime: new Date().toISOString(),
    cursor: nextCursor,
    events: changes,
    rejected,
    snapshot: await snapshotOf(user.householdId),
  })
})

syncRoutes.get('/snapshot', async (c) => {
  return c.json(await snapshotOf(c.get('user').householdId))
})

syncRoutes.get('/revisions/:id', async (c) => {
  const rows = await revisionsOf(c.req.param('id'))
  const actorIds = [...new Set(rows.map((row) => row.actorId).filter(Boolean))] as string[]
  const members = actorIds.length
    ? await db
        .select({ id: users.id, displayName: users.displayName })
        .from(users)
        .where(eq(users.householdId, c.get('user').householdId))
    : []
  return c.json({ revisions: rows, members })
})

/** Small, rarely-changing tables travel whole on every sync. */
async function snapshotOf(householdId: string) {
  const [household] = await db.select().from(households).where(eq(households.id, householdId)).limit(1)
  const babyRows = await db
    .select()
    .from(babies)
    .where(and(eq(babies.householdId, householdId), eq(babies.archived, false)))
  const members = await db
    .select({ id: users.id, displayName: users.displayName, username: users.username })
    .from(users)
    .where(eq(users.householdId, householdId))

  const reminders: Record<string, unknown> = {}
  for (const baby of babyRows) {
    reminders[baby.id] = await settingsForBaby(baby.id, ageInMonths(baby.birthDate))
  }

  return { household, babies: babyRows, members, reminders }
}
