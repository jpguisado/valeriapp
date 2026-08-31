import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { env } from '../lib/env.js'
import * as schema from './schema.js'

/**
 * One small pool: this server runs beside Postgres on a 1 GB box, so we keep
 * the connection count deliberately low.
 */
export const sql = postgres(env.DATABASE_URL, {
  max: 6,
  idle_timeout: 30,
  connect_timeout: 10,
  onnotice: () => {},
})

export const db = drizzle(sql, { schema })
export { schema }
