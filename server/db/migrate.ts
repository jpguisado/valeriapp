/**
 * Tiny forward-only migrator: applies every drizzle/*.sql not yet recorded in
 * schema_migrations, each inside its own transaction. Hand-written SQL keeps
 * sequences, partial indexes and expression indexes exactly as intended.
 */
import { readdir, readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import postgres from 'postgres'
import { env } from '../lib/env.js'

/**
 * Resolved from the working directory (the repo root in development, /app in
 * the container) rather than from this file, so it survives bundling into
 * different output paths.
 */
const migrationsDir = process.env.MIGRATIONS_DIR ?? resolve(process.cwd(), 'drizzle')

export async function runMigrations(): Promise<string[]> {
  const sql = postgres(env.DATABASE_URL, { max: 1, onnotice: () => {} })
  const applied: string[] = []
  try {
    await sql`CREATE TABLE IF NOT EXISTS schema_migrations (
      name       text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )`
    const done = new Set(
      (await sql<{ name: string }[]>`SELECT name FROM schema_migrations`).map((row) => row.name),
    )
    // Sólo `0001_lo_que_sea.sql`: así no se cuela basura del sistema de
    // ficheros (los `._` que macOS mete en los tar, por ejemplo) en el
    // protocolo de Postgres.
    const files = (await readdir(migrationsDir)).filter((f) => /^\d+_.*\.sql$/.test(f)).sort()

    for (const file of files) {
      if (done.has(file)) continue
      const statements = await readFile(join(migrationsDir, file), 'utf8')
      await sql.begin(async (tx) => {
        await tx.unsafe(statements)
        await tx`INSERT INTO schema_migrations (name) VALUES (${file})`
      })
      applied.push(file)
      console.log(`[migrate] applied ${file}`)
    }
    if (applied.length === 0) console.log('[migrate] nothing to apply')
  } finally {
    await sql.end({ timeout: 5 })
  }
  return applied
}

const invokedDirectly = process.argv[1]?.includes('migrate')
if (invokedDirectly) {
  runMigrations().catch((error) => {
    console.error('[migrate] failed', error)
    process.exit(1)
  })
}
