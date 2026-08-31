import { Hono } from 'hono'
import { z } from 'zod'
import { and, eq } from 'drizzle-orm'
import { db } from '../db/client.js'
import { babies } from '../db/schema.js'
import { requireAuth, type AppEnv } from '../lib/http.js'

const babyInput = z.object({
  name: z.string().trim().min(1).max(60),
  birthDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Fecha con formato aaaa-mm-dd'),
  sex: z.enum(['female', 'male']).nullable().optional(),
})

export const babyRoutes = new Hono<AppEnv>()

babyRoutes.use('*', requireAuth)

babyRoutes.get('/', async (c) => {
  const rows = await db.select().from(babies).where(eq(babies.householdId, c.get('user').householdId))
  return c.json({ babies: rows })
})

babyRoutes.post('/', async (c) => {
  const parsed = babyInput.safeParse(await c.req.json().catch(() => ({})))
  if (!parsed.success) {
    return c.json({ error: parsed.error.issues[0]?.message ?? 'Datos inválidos' }, 400)
  }
  const [row] = await db
    .insert(babies)
    .values({ householdId: c.get('user').householdId, ...parsed.data })
    .returning()
  return c.json({ baby: row })
})

babyRoutes.patch('/:id', async (c) => {
  const parsed = babyInput.partial().extend({ archived: z.boolean().optional() }).safeParse(
    await c.req.json().catch(() => ({})),
  )
  if (!parsed.success) {
    return c.json({ error: parsed.error.issues[0]?.message ?? 'Datos inválidos' }, 400)
  }
  const [row] = await db
    .update(babies)
    .set({ ...parsed.data, updatedAt: new Date() })
    .where(and(eq(babies.id, c.req.param('id')), eq(babies.householdId, c.get('user').householdId)))
    .returning()
  if (!row) return c.json({ error: 'Bebé no encontrado' }, 404)
  return c.json({ baby: row })
})
