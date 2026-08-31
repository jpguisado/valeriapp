import type { Context, MiddlewareHandler } from 'hono'
import { currentUser, type AuthUser } from './auth.js'

export type AppEnv = { Variables: { user: AuthUser } }

export const requireAuth: MiddlewareHandler<AppEnv> = async (c, next) => {
  const user = await currentUser(c)
  if (!user) return c.json({ error: 'No autenticado' }, 401)
  c.set('user', user)
  await next()
}

/**
 * In-memory sliding-window limiter. The app has a handful of users behind one
 * nginx, so a Map is the right size of solution for keeping bots off /register.
 */
const buckets = new Map<string, number[]>()

export function rateLimit(options: {
  key: string
  limit: number
  windowMs: number
  /** Successful requests do not consume the budget, so a household logging in
   *  on five devices from one IP never locks itself out. */
  onlyFailures?: boolean
}): MiddlewareHandler {
  return async (c, next) => {
    const bucketKey = `${options.key}:${clientIp(c)}`
    const now = Date.now()
    const hits = (buckets.get(bucketKey) ?? []).filter((ts) => now - ts < options.windowMs)

    if (hits.length >= options.limit) {
      return c.json({ error: 'Demasiados intentos, prueba en unos minutos' }, 429)
    }

    hits.push(now)
    buckets.set(bucketKey, hits)
    if (buckets.size > 5000) buckets.clear()

    await next()

    if (options.onlyFailures && c.res.status < 400) {
      const remaining = (buckets.get(bucketKey) ?? []).filter((ts) => ts !== now)
      if (remaining.length === 0) buckets.delete(bucketKey)
      else buckets.set(bucketKey, remaining)
    }
  }
}

export function clientIp(c: Context): string {
  const forwarded = c.req.header('x-forwarded-for')
  if (forwarded) return forwarded.split(',')[0]?.trim() ?? 'unknown'
  return c.req.header('x-real-ip') ?? 'unknown'
}
