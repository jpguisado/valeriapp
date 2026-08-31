import { Hono } from 'hono'
import { z } from 'zod'
import { eq, sql } from 'drizzle-orm'
import { db } from '../db/client.js'
import { babies, households, users } from '../db/schema.js'
import {
  createInvite,
  createSession,
  destroySession,
  findUsableInvite,
  hashPassword,
  markInviteUsed,
  verifyPassword,
} from '../lib/auth.js'
import { env } from '../lib/env.js'
import { rateLimit, requireAuth, type AppEnv } from '../lib/http.js'

const credentials = z.object({
  username: z.string().trim().min(3).max(40).regex(/^[\p{L}\p{N}._-]+$/u, 'Usuario inválido'),
  password: z.string().min(8, 'Mínimo 8 caracteres').max(200),
})

const registration = credentials.extend({
  displayName: z.string().trim().min(1).max(60),
  inviteCode: z.string().trim().min(3).max(20),
})

export const authRoutes = new Hono<AppEnv>()

authRoutes.post(
  '/register',
  rateLimit({ key: 'register', limit: 5, windowMs: 15 * 60_000, onlyFailures: true }),
  async (c) => {
    const parsed = registration.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) {
      return c.json({ error: parsed.error.issues[0]?.message ?? 'Datos inválidos' }, 400)
    }
    const { username, password, displayName, inviteCode } = parsed.data

    const invite = await findUsableInvite(inviteCode)
    if (!invite) return c.json({ error: 'Código de invitación inválido o caducado' }, 400)

    const existing = await db
      .select({ id: users.id })
      .from(users)
      .where(sql`lower(${users.username}) = lower(${username})`)
      .limit(1)
    if (existing.length > 0) return c.json({ error: 'Ese usuario ya existe' }, 409)

    const [user] = await db
      .insert(users)
      .values({
        householdId: invite.householdId,
        username,
        displayName,
        passwordHash: await hashPassword(password),
      })
      .returning()
    if (!user) return c.json({ error: 'No se pudo crear el usuario' }, 500)

    await markInviteUsed(invite.id, user.id)
    await createSession(c, user.id)
    return c.json({ user: publicUser(user) })
  },
)

authRoutes.post('/login', rateLimit({ key: 'login', limit: 10, windowMs: 10 * 60_000, onlyFailures: true }), async (c) => {
  const parsed = credentials.safeParse(await c.req.json().catch(() => ({})))
  if (!parsed.success) return c.json({ error: 'Usuario o contraseña incorrectos' }, 401)

  const [user] = await db
    .select()
    .from(users)
    .where(sql`lower(${users.username}) = lower(${parsed.data.username})`)
    .limit(1)
  if (!user || !(await verifyPassword(parsed.data.password, user.passwordHash))) {
    return c.json({ error: 'Usuario o contraseña incorrectos' }, 401)
  }
  await createSession(c, user.id)
  return c.json({ user: publicUser(user) })
})

authRoutes.post('/logout', async (c) => {
  await destroySession(c)
  return c.json({ ok: true })
})

authRoutes.get('/me', requireAuth, async (c) => {
  const user = c.get('user')
  const [household] = await db
    .select()
    .from(households)
    .where(eq(households.id, user.householdId))
    .limit(1)
  return c.json({ user, household, vapidPublicKey: env.VAPID_PUBLIC_KEY })
})

authRoutes.post('/password', requireAuth, async (c) => {
  const schema = z.object({
    currentPassword: z.string().min(1),
    newPassword: z.string().min(8, 'Mínimo 8 caracteres').max(200),
  })
  const parsed = schema.safeParse(await c.req.json().catch(() => ({})))
  if (!parsed.success) {
    return c.json({ error: parsed.error.issues[0]?.message ?? 'Datos inválidos' }, 400)
  }

  const actor = c.get('user')
  const [user] = await db.select().from(users).where(eq(users.id, actor.id)).limit(1)
  if (!user || !(await verifyPassword(parsed.data.currentPassword, user.passwordHash))) {
    return c.json({ error: 'La contraseña actual no es correcta' }, 401)
  }

  await db
    .update(users)
    .set({ passwordHash: await hashPassword(parsed.data.newPassword) })
    .where(eq(users.id, actor.id))

  // Every other device keeps its session; only the password changed.
  return c.json({ ok: true })
})

authRoutes.get('/members', requireAuth, async (c) => {
  const rows = await db
    .select({ id: users.id, displayName: users.displayName, username: users.username })
    .from(users)
    .where(eq(users.householdId, c.get('user').householdId))
  return c.json({ members: rows })
})

authRoutes.post('/invites', requireAuth, async (c) => {
  const user = c.get('user')
  const invite = await createInvite(user.householdId, user.id)
  return c.json({ invite })
})

/**
 * Creates the very first household and user. Only reachable while
 * ALLOW_BOOTSTRAP is on and no household exists yet.
 */
authRoutes.post('/bootstrap', rateLimit({ key: 'bootstrap', limit: 3, windowMs: 3_600_000 }), async (c) => {
  if (!env.ALLOW_BOOTSTRAP) return c.json({ error: 'No disponible' }, 404)
  const count = await db.select({ id: households.id }).from(households).limit(1)
  if (count.length > 0) return c.json({ error: 'Ya existe un hogar' }, 409)

  const schema = credentials.extend({
    displayName: z.string().trim().min(1).max(60),
    householdName: z.string().trim().min(1).max(60).default('Casa'),
    babyName: z.string().trim().min(1).max(60),
    babyBirthDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  })
  const parsed = schema.safeParse(await c.req.json().catch(() => ({})))
  if (!parsed.success) {
    return c.json({ error: parsed.error.issues[0]?.message ?? 'Datos inválidos' }, 400)
  }

  const [household] = await db
    .insert(households)
    .values({ name: parsed.data.householdName, backupEmail: env.BACKUP_EMAIL_TO || null })
    .returning()
  if (!household) return c.json({ error: 'No se pudo crear el hogar' }, 500)

  const [user] = await db
    .insert(users)
    .values({
      householdId: household.id,
      username: parsed.data.username,
      displayName: parsed.data.displayName,
      passwordHash: await hashPassword(parsed.data.password),
    })
    .returning()
  if (!user) return c.json({ error: 'No se pudo crear el usuario' }, 500)

  await db.insert(babies).values({
    householdId: household.id,
    name: parsed.data.babyName,
    birthDate: parsed.data.babyBirthDate,
  })

  await createSession(c, user.id)
  return c.json({ user: publicUser(user), household })
})

function publicUser(user: typeof users.$inferSelect) {
  return {
    id: user.id,
    householdId: user.householdId,
    username: user.username,
    displayName: user.displayName,
  }
}
