import { Hono } from 'hono'
import { z } from 'zod'
import { and, eq } from 'drizzle-orm'
import { db } from '../db/client.js'
import { pushSubscriptions } from '../db/schema.js'
import { env, pushConfigured } from '../lib/env.js'
import { requireAuth, type AppEnv } from '../lib/http.js'
import { pushToHousehold } from '../lib/push.js'

const subscriptionInput = z.object({
  endpoint: z.url(),
  keys: z.object({ p256dh: z.string().min(1), auth: z.string().min(1) }),
})

export const pushRoutes = new Hono<AppEnv>()

pushRoutes.get('/key', (c) => c.json({ key: env.VAPID_PUBLIC_KEY, enabled: pushConfigured }))

pushRoutes.use('*', requireAuth)

pushRoutes.post('/subscribe', async (c) => {
  const parsed = subscriptionInput.safeParse(await c.req.json().catch(() => ({})))
  if (!parsed.success) return c.json({ error: 'Suscripción inválida' }, 400)
  const { endpoint, keys } = parsed.data

  await db
    .insert(pushSubscriptions)
    .values({ userId: c.get('user').id, endpoint, p256dh: keys.p256dh, auth: keys.auth })
    .onConflictDoUpdate({
      target: pushSubscriptions.endpoint,
      set: { userId: c.get('user').id, p256dh: keys.p256dh, auth: keys.auth, failureCount: 0 },
    })
  return c.json({ ok: true })
})

pushRoutes.post('/unsubscribe', async (c) => {
  const body = await c.req.json().catch(() => ({}))
  const endpoint = typeof body.endpoint === 'string' ? body.endpoint : null
  if (!endpoint) return c.json({ error: 'Falta endpoint' }, 400)
  await db
    .delete(pushSubscriptions)
    .where(and(eq(pushSubscriptions.endpoint, endpoint), eq(pushSubscriptions.userId, c.get('user').id)))
  return c.json({ ok: true })
})

pushRoutes.post('/test', async (c) => {
  const sent = await pushToHousehold(c.get('user').householdId, {
    kind: 'test',
    tag: 'test',
    title: 'Valeriapp',
    body: 'Las notificaciones funcionan.',
    url: '/',
  })
  return c.json({ sent })
})
