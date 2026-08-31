import { createHash, randomBytes, randomUUID, scrypt, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'
import { and, eq, gt, isNull } from 'drizzle-orm'
import type { Context } from 'hono'
import { getCookie, setCookie } from 'hono/cookie'
import { db } from '../db/client.js'
import { households, invites, sessions, users } from '../db/schema.js'
import { env, isProduction } from './env.js'

const scryptAsync = promisify(scrypt)
const KEY_LENGTH = 64

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString('hex')
  const derived = (await scryptAsync(password, salt, KEY_LENGTH)) as Buffer
  return `scrypt$${salt}$${derived.toString('hex')}`
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [algorithm, salt, hash] = stored.split('$')
  if (algorithm !== 'scrypt' || !salt || !hash) return false
  const derived = (await scryptAsync(password, salt, KEY_LENGTH)) as Buffer
  const expected = Buffer.from(hash, 'hex')
  if (expected.length !== derived.length) return false
  return timingSafeEqual(derived, expected)
}

/** Session tokens are stored hashed, so a database dump cannot be replayed. */
function digest(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

export interface AuthUser {
  id: string
  householdId: string
  username: string
  displayName: string
}

export async function createSession(c: Context, userId: string): Promise<void> {
  const token = randomBytes(32).toString('base64url')
  const expiresAt = new Date(Date.now() + env.SESSION_DAYS * 86_400_000)
  await db.insert(sessions).values({
    userId,
    tokenHash: digest(token),
    userAgent: c.req.header('user-agent')?.slice(0, 200) ?? null,
    expiresAt,
  })
  setCookie(c, env.COOKIE_NAME, token, {
    httpOnly: true,
    secure: env.COOKIE_SECURE && isProduction,
    sameSite: 'Lax',
    path: '/',
    maxAge: env.SESSION_DAYS * 86_400,
  })
}

export async function destroySession(c: Context): Promise<void> {
  const token = getCookie(c, env.COOKIE_NAME)
  if (token) {
    await db.delete(sessions).where(eq(sessions.tokenHash, digest(token)))
  }
  setCookie(c, env.COOKIE_NAME, '', { path: '/', maxAge: 0 })
}

export async function currentUser(c: Context): Promise<AuthUser | null> {
  const token = getCookie(c, env.COOKIE_NAME)
  if (!token) return null
  const rows = await db
    .select({
      id: users.id,
      householdId: users.householdId,
      username: users.username,
      displayName: users.displayName,
    })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.tokenHash, digest(token)), gt(sessions.expiresAt, new Date())))
    .limit(1)
  return rows[0] ?? null
}

/** Human-friendly, unambiguous invite code such as VAL-7K2. */
export function generateInviteCode(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  const pick = (n: number): string =>
    Array.from(randomBytes(n))
      .map((byte) => alphabet[byte % alphabet.length])
      .join('')
  return `${pick(3)}-${pick(3)}`
}

export const INVITE_TTL_HOURS = 24

export async function createInvite(householdId: string, createdBy: string) {
  const code = generateInviteCode()
  const expiresAt = new Date(Date.now() + INVITE_TTL_HOURS * 3_600_000)
  const [row] = await db
    .insert(invites)
    .values({ id: randomUUID(), householdId, code, createdBy, expiresAt })
    .returning()
  return row
}

/** Looks up a usable invite without consuming it; the user does not exist yet. */
export async function findUsableInvite(code: string) {
  const normalised = code.trim().toUpperCase()
  const [invite] = await db
    .select()
    .from(invites)
    .where(
      and(eq(invites.code, normalised), isNull(invites.usedAt), gt(invites.expiresAt, new Date())),
    )
    .limit(1)
  return invite ?? null
}

export async function markInviteUsed(inviteId: string, userId: string): Promise<void> {
  await db
    .update(invites)
    .set({ usedAt: new Date(), usedBy: userId })
    .where(eq(invites.id, inviteId))
}

export async function householdOf(householdId: string) {
  const [row] = await db.select().from(households).where(eq(households.id, householdId)).limit(1)
  return row ?? null
}
