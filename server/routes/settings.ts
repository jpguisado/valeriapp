import { Hono } from 'hono'
import { z } from 'zod'
import { and, eq } from 'drizzle-orm'
import { REMINDER_TYPES } from '../../shared/reminders.js'
import { isValidTimezone } from '../../shared/time.js'
import { db } from '../db/client.js'
import { babies, households, reminderSettings } from '../db/schema.js'
import { requireAuth, type AppEnv } from '../lib/http.js'

export const settingsRoutes = new Hono<AppEnv>()

settingsRoutes.use('*', requireAuth)

const householdInput = z.object({
  name: z.string().trim().min(1).max(60).optional(),
  timezoneMode: z.enum(['device', 'fixed']).optional(),
  timezone: z.string().refine(isValidTimezone, 'Zona horaria desconocida').optional(),
  backupEmail: z.email().or(z.literal('')).optional(),
  settleMinutes: z.number().int().min(0).max(180).optional(),
})

settingsRoutes.patch('/household', async (c) => {
  const parsed = householdInput.safeParse(await c.req.json().catch(() => ({})))
  if (!parsed.success) {
    return c.json({ error: parsed.error.issues[0]?.message ?? 'Datos inválidos' }, 400)
  }
  const patch = { ...parsed.data }
  if (patch.backupEmail === '') patch.backupEmail = undefined
  const [row] = await db
    .update(households)
    .set(patch)
    .where(eq(households.id, c.get('user').householdId))
    .returning()
  return c.json({ household: row })
})

const reminderInput = z.object({
  type: z.enum(REMINDER_TYPES),
  enabled: z.boolean(),
  thresholdMinutes: z.number().int().min(0).max(10080),
  atTime: z.string().regex(/^\d{2}:\d{2}$/).optional(),
})

settingsRoutes.put('/reminders/:babyId', async (c) => {
  const babyId = c.req.param('babyId')
  const [baby] = await db
    .select()
    .from(babies)
    .where(and(eq(babies.id, babyId), eq(babies.householdId, c.get('user').householdId)))
    .limit(1)
  if (!baby) return c.json({ error: 'Bebé no encontrado' }, 404)

  const parsed = z.array(reminderInput).safeParse(await c.req.json().catch(() => []))
  if (!parsed.success) {
    return c.json({ error: parsed.error.issues[0]?.message ?? 'Datos inválidos' }, 400)
  }

  for (const setting of parsed.data) {
    await db
      .insert(reminderSettings)
      .values({
        babyId,
        type: setting.type,
        enabled: setting.enabled,
        thresholdMinutes: setting.thresholdMinutes,
        atTime: setting.atTime ?? null,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [reminderSettings.babyId, reminderSettings.type],
        set: {
          enabled: setting.enabled,
          thresholdMinutes: setting.thresholdMinutes,
          atTime: setting.atTime ?? null,
          updatedAt: new Date(),
        },
      })
  }
  return c.json({ ok: true })
})
