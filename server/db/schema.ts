import {
  bigint,
  boolean,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'

export const households = pgTable('households', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  /** 'device' honours each event's own zone, 'fixed' forces `timezone`. */
  timezoneMode: text('timezone_mode').notNull().default('device'),
  timezone: text('timezone').notNull().default('Europe/Madrid'),
  backupEmail: text('backup_email'),
  /** Minutos de rutina tras un evento antes de darla por dormida otra vez. */
  settleMinutes: integer('settle_minutes').notNull().default(25),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    householdId: uuid('household_id')
      .notNull()
      .references(() => households.id, { onDelete: 'cascade' }),
    username: text('username').notNull(),
    passwordHash: text('password_hash').notNull(),
    displayName: text('display_name').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex('users_username_key').on(table.username)],
)

export const sessions = pgTable(
  'sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull(),
    userAgent: text('user_agent'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  },
  (table) => [uniqueIndex('sessions_token_key').on(table.tokenHash)],
)

export const invites = pgTable(
  'invites',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    householdId: uuid('household_id')
      .notNull()
      .references(() => households.id, { onDelete: 'cascade' }),
    code: text('code').notNull(),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    usedAt: timestamp('used_at', { withTimezone: true }),
    usedBy: uuid('used_by').references(() => users.id, { onDelete: 'set null' }),
  },
  (table) => [uniqueIndex('invites_code_key').on(table.code)],
)

export const babies = pgTable(
  'babies',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    householdId: uuid('household_id')
      .notNull()
      .references(() => households.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    birthDate: date('birth_date').notNull(),
    /** 'female' | 'male'; nulo mientras no se sepa. */
    sex: text('sex'),
    archived: boolean('archived').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('babies_household_idx').on(table.householdId)],
)

export const events = pgTable(
  'events',
  {
    /** Generated on the device, so an offline write already has its final id. */
    id: uuid('id').primaryKey(),
    householdId: uuid('household_id')
      .notNull()
      .references(() => households.id, { onDelete: 'cascade' }),
    babyId: uuid('baby_id')
      .notNull()
      .references(() => babies.id, { onDelete: 'cascade' }),
    type: text('type').notNull(),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull(),
    endedAt: timestamp('ended_at', { withTimezone: true }),
    tz: text('tz').notNull(),
    running: boolean('running').notNull().default(false),
    estimated: boolean('estimated').notNull().default(false),
    payload: jsonb('payload').notNull().default({}),
    note: text('note'),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    /** When the server saw it; compared with occurredAt to spot clock skew. */
    receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
    /** Monotonic per-write counter; the sync cursor. */
    serverSeq: bigint('server_seq', { mode: 'number' }).notNull(),
  },
  (table) => [
    index('events_household_seq_idx').on(table.householdId, table.serverSeq),
    index('events_baby_occurred_idx').on(table.babyId, table.occurredAt),
    index('events_running_idx').on(table.householdId, table.running),
  ],
)

export const eventRevisions = pgTable(
  'event_revisions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    eventId: uuid('event_id').notNull(),
    action: text('action').notNull(),
    actorId: uuid('actor_id').references(() => users.id, { onDelete: 'set null' }),
    at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
    snapshot: jsonb('snapshot').notNull(),
  },
  (table) => [index('event_revisions_event_idx').on(table.eventId, table.at)],
)

export const reminderSettings = pgTable(
  'reminder_settings',
  {
    babyId: uuid('baby_id')
      .notNull()
      .references(() => babies.id, { onDelete: 'cascade' }),
    type: text('type').notNull(),
    enabled: boolean('enabled').notNull().default(false),
    thresholdMinutes: integer('threshold_minutes').notNull().default(0),
    atTime: text('at_time'),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.babyId, table.type] })],
)

export const reminderState = pgTable(
  'reminder_state',
  {
    babyId: uuid('baby_id')
      .notNull()
      .references(() => babies.id, { onDelete: 'cascade' }),
    type: text('type').notNull(),
    triggerKey: text('trigger_key').notNull(),
    firedAt: timestamp('fired_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.babyId, table.type] })],
)

export const pushSubscriptions = pgTable(
  'push_subscriptions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    endpoint: text('endpoint').notNull(),
    p256dh: text('p256dh').notNull(),
    auth: text('auth').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    failureCount: integer('failure_count').notNull().default(0),
  },
  (table) => [uniqueIndex('push_endpoint_key').on(table.endpoint)],
)

export type UserRow = typeof users.$inferSelect
export type BabyRow = typeof babies.$inferSelect
export type EventRow = typeof events.$inferSelect
export type HouseholdRow = typeof households.$inferSelect
