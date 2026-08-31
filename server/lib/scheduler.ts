/**
 * One-minute tick that does the three things nobody should have to remember:
 * closes forgotten timers, fires due reminders, and runs the backup job.
 */
import { and, eq } from 'drizzle-orm'
import { defaultSettings, evaluateReminders, REMINDER_TYPES, type ReminderSettings, type ReminderType } from '../../shared/reminders.js'
import { ageInMonths, dayKeyOf, zonedParts } from '../../shared/time.js'
import { summarise } from '../../shared/stats.js'
import { db } from '../db/client.js'
import { babies, households, reminderSettings, reminderState } from '../db/schema.js'
import { env } from './env.js'
import { autoCloseStaleTimers, recentEvents } from './events-service.js'
import { pushToHousehold } from './push.js'
import { runBackupTick } from './backup.js'

const TICK_MS = 60_000
let timer: NodeJS.Timeout | null = null

export async function settingsForBaby(babyId: string, ageMonths: number): Promise<ReminderSettings> {
  const rows = await db.select().from(reminderSettings).where(eq(reminderSettings.babyId, babyId))
  const settings = defaultSettings(ageMonths)
  for (const row of rows) {
    if (!(REMINDER_TYPES as readonly string[]).includes(row.type)) continue
    settings[row.type as ReminderType] = {
      enabled: row.enabled,
      thresholdMinutes: row.thresholdMinutes,
      atTime: row.atTime ?? undefined,
    }
  }
  return settings
}

async function alreadyFired(babyId: string, type: ReminderType, triggerKey: string): Promise<boolean> {
  const [row] = await db
    .select()
    .from(reminderState)
    .where(and(eq(reminderState.babyId, babyId), eq(reminderState.type, type)))
    .limit(1)
  return row?.triggerKey === triggerKey
}

async function rememberFiring(babyId: string, type: ReminderType, triggerKey: string): Promise<void> {
  await db
    .insert(reminderState)
    .values({ babyId, type, triggerKey, firedAt: new Date() })
    .onConflictDoUpdate({
      target: [reminderState.babyId, reminderState.type],
      set: { triggerKey, firedAt: new Date() },
    })
}

async function processBaby(
  baby: typeof babies.$inferSelect,
  householdTimezone: string,
  now: number,
): Promise<void> {
  const ageMonths = ageInMonths(baby.birthDate, now)
  const settings = await settingsForBaby(baby.id, ageMonths)
  const events = await recentEvents(baby.id, 5)

  for (const reminder of evaluateReminders({
    babyName: baby.name,
    birthDate: baby.birthDate,
    events,
    settings,
    now,
  })) {
    if (await alreadyFired(baby.id, reminder.type, reminder.triggerKey)) continue
    await pushToHousehold(baby.householdId, {
      kind: 'reminder',
      tag: `${reminder.type}:${baby.id}`,
      title: reminder.title,
      body: reminder.body,
      url: '/',
      firedAt: new Date(now).toISOString(),
      maxLateMinutes: env.PUSH_MAX_LATE_MINUTES,
    })
    await rememberFiring(baby.id, reminder.type, reminder.triggerKey)
  }

  await maybeSendDailySummary(baby, settings, householdTimezone, now, events)
}

async function maybeSendDailySummary(
  baby: typeof babies.$inferSelect,
  settings: ReminderSettings,
  householdTimezone: string,
  now: number,
  events: Awaited<ReturnType<typeof recentEvents>>,
): Promise<void> {
  const config = settings.daily_summary
  if (!config?.enabled) return
  const [hour, minute] = (config.atTime ?? '22:00').split(':').map(Number)
  const local = zonedParts(now, householdTimezone)
  if (local.hour !== (hour ?? 22) || local.minute !== (minute ?? 0)) return

  const today = dayKeyOf(now, householdTimezone)
  if (await alreadyFired(baby.id, 'daily_summary', today)) return

  const summary = summarise(events, today, today, {
    timezone: { mode: 'device', fixed: householdTimezone },
  }, now)
  const hours = Math.round((summary.totals.sleepSeconds / 3600) * 10) / 10

  await pushToHousehold(baby.householdId, {
    kind: 'reminder',
    tag: `daily_summary:${baby.id}`,
    title: `${baby.name}: resumen del día`,
    body: `${summary.totals.feeds} tomas · ${hours} h de sueño · ${summary.totals.diapers.total} pañales`,
    url: '/estadisticas',
    firedAt: new Date(now).toISOString(),
    maxLateMinutes: env.PUSH_MAX_LATE_MINUTES,
  })
  await rememberFiring(baby.id, 'daily_summary', today)
}

export async function tick(now = Date.now()): Promise<void> {
  try {
    await autoCloseStaleTimers(new Date(now))
  } catch (error) {
    console.error('[scheduler] auto-cierre falló', error)
  }

  if (env.REMINDERS_ENABLED) {
    try {
      const rows = await db
        .select({ baby: babies, timezone: households.timezone })
        .from(babies)
        .innerJoin(households, eq(households.id, babies.householdId))
        .where(eq(babies.archived, false))
      for (const row of rows) {
        await processBaby(row.baby, row.timezone, now)
      }
    } catch (error) {
      console.error('[scheduler] recordatorios fallaron', error)
    }
  }

  try {
    await runBackupTick(new Date(now))
  } catch (error) {
    console.error('[scheduler] backup falló', error)
  }
}

export function startScheduler(): void {
  if (timer) return
  timer = setInterval(() => {
    void tick()
  }, TICK_MS)
  timer.unref?.()
  console.log('[scheduler] activo (cada 60 s)')
}

export function stopScheduler(): void {
  if (timer) clearInterval(timer)
  timer = null
}
