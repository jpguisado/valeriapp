import { z } from 'zod'

const schema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().default(3000),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL es obligatoria'),

  /** Where the browser reaches the app; used in push notification links. */
  PUBLIC_URL: z.string().default('http://localhost:5173'),

  /** Registration requires an invite code, so this only gates the very first user. */
  ALLOW_BOOTSTRAP: z.coerce.boolean().default(false),

  VAPID_PUBLIC_KEY: z.string().default(''),
  VAPID_PRIVATE_KEY: z.string().default(''),
  VAPID_SUBJECT: z.string().default('mailto:admin@example.com'),

  RESEND_API_KEY: z.string().default(''),
  BACKUP_EMAIL_FROM: z.string().default('onboarding@resend.dev'),
  BACKUP_EMAIL_TO: z.string().default(''),
  BACKUP_DIR: z.string().default('/data/backups'),
  BACKUP_RETENTION_DAYS: z.coerce.number().int().default(30),
  /** Set to 0 to disable the in-process backup job entirely. */
  BACKUP_ENABLED: z.coerce.boolean().default(true),

  REMINDERS_ENABLED: z.coerce.boolean().default(true),
  /** Reminders arriving later than this are dropped as noise. */
  PUSH_MAX_LATE_MINUTES: z.coerce.number().int().default(120),

  COOKIE_NAME: z.string().default('valeriapp_session'),
  COOKIE_SECURE: z.coerce.boolean().default(true),
  SESSION_DAYS: z.coerce.number().int().default(365),
})

const parsed = schema.safeParse(process.env)

if (!parsed.success) {
  const issues = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n')
  throw new Error(`Configuración inválida:\n${issues}`)
}

export const env = parsed.data
export const isProduction = env.NODE_ENV === 'production'
export const pushConfigured = Boolean(env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY)
