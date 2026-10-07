import { eq, inArray } from 'drizzle-orm'
import webpush from 'web-push'
import { db } from '../db/client.js'
import { pushSubscriptions, users } from '../db/schema.js'
import { env, pushConfigured } from './env.js'

export interface PushPayload {
  kind: 'reminder' | 'cancel' | 'test'
  /** Notification tag: a new push with the same tag replaces the previous one. */
  tag: string
  title?: string
  body?: string
  url?: string
  /** When the reminder was actually due; the SW drops it if it is too stale. */
  firedAt?: string
  maxLateMinutes?: number
}

let configured = false

/**
 * Safari has no silent push: every push must show a notification, and after a
 * few that don't, it revokes the subscription for good. A "cancel" shows
 * nothing, so it must never reach an Apple endpoint.
 */
function acceptsSilentPush(endpoint: string): boolean {
  return !new URL(endpoint).hostname.endsWith('push.apple.com')
}

function ensureConfigured(): boolean {
  if (!pushConfigured) return false
  if (!configured) {
    webpush.setVapidDetails(env.VAPID_SUBJECT, env.VAPID_PUBLIC_KEY, env.VAPID_PRIVATE_KEY)
    configured = true
  }
  return true
}

async function subscriptionsForUsers(userIds: string[]) {
  if (userIds.length === 0) return []
  return db.select().from(pushSubscriptions).where(inArray(pushSubscriptions.userId, userIds))
}

async function userIdsOfHousehold(householdId: string): Promise<string[]> {
  const rows = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.householdId, householdId))
  return rows.map((row) => row.id)
}

/**
 * Sends to every device of a household. Gone subscriptions (404/410) are
 * removed: an uninstalled PWA must not keep the scheduler retrying forever.
 */
export async function pushToHousehold(householdId: string, payload: PushPayload): Promise<number> {
  if (!ensureConfigured()) return 0
  const subs = await subscriptionsForUsers(await userIdsOfHousehold(householdId))
  const body = JSON.stringify(payload)
  // Past this age a reminder is noise; the push service drops it, not the SW,
  // because a push the SW swallows counts against the subscription on Safari.
  const ttl = Math.min(3600, (payload.maxLateMinutes ?? 60) * 60)
  let delivered = 0

  await Promise.all(
    subs.map(async (sub) => {
      if (payload.kind === 'cancel' && !acceptsSilentPush(sub.endpoint)) return
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          body,
          { TTL: ttl, urgency: payload.kind === 'cancel' ? 'high' : 'normal' },
        )
        delivered += 1
      } catch (error) {
        const statusCode = (error as { statusCode?: number }).statusCode
        if (statusCode === 404 || statusCode === 410) {
          await db.delete(pushSubscriptions).where(eq(pushSubscriptions.id, sub.id))
        } else {
          const host = new URL(sub.endpoint).hostname
          const detail = (error as { body?: string }).body ?? error
          console.warn('[push] envío fallido', host, statusCode ?? '', detail)
        }
      }
    }),
  )
  return delivered
}

/** Closes a notification on every other device once somebody logs the event. */
export async function cancelOnHousehold(householdId: string, tag: string): Promise<void> {
  await pushToHousehold(householdId, { kind: 'cancel', tag })
}

export function vapidPublicKey(): string {
  return env.VAPID_PUBLIC_KEY
}
