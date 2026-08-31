import { readFile } from 'node:fs/promises'
import { dirname, join, normalize } from 'node:path'
import { fileURLToPath } from 'node:url'
import { serve } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import { Hono } from 'hono'
import { logger } from 'hono/logger'
import { secureHeaders } from 'hono/secure-headers'
import { sql } from './db/client.js'
import { runMigrations } from './db/migrate.js'
import { env, isProduction } from './lib/env.js'
import { startScheduler } from './lib/scheduler.js'
import { authRoutes } from './routes/auth.js'
import { babyRoutes } from './routes/babies.js'
import { exportRoutes } from './routes/export.js'
import { pushRoutes } from './routes/push.js'
import { settingsRoutes } from './routes/settings.js'
import { syncRoutes } from './routes/sync.js'

const here = dirname(fileURLToPath(import.meta.url))
const clientDir = normalize(join(here, '..', 'client'))

const app = new Hono()

app.use('*', logger())
app.use(
  '*',
  secureHeaders({
    contentSecurityPolicy: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", 'data:'],
      connectSrc: ["'self'"],
      manifestSrc: ["'self'"],
      workerSrc: ["'self'"],
      frameAncestors: ["'none'"],
    },
    crossOriginEmbedderPolicy: false,
  }),
)

app.get('/api/health', async (c) => {
  try {
    await sql`SELECT 1`
    return c.json({ ok: true, time: new Date().toISOString() })
  } catch (error) {
    return c.json({ ok: false, error: (error as Error).message }, 503)
  }
})

app.route('/api/auth', authRoutes)
app.route('/api/babies', babyRoutes)
app.route('/api/sync', syncRoutes)
app.route('/api/settings', settingsRoutes)
app.route('/api/push', pushRoutes)
app.route('/api/export', exportRoutes)

app.all('/api/*', (c) => c.json({ error: 'Ruta desconocida' }, 404))

if (isProduction) {
  app.use(
    '/*',
    serveStatic({
      root: './dist/client',
      onFound: (path, c) => {
        if (/\.[0-9a-f]{8,}\./.test(path)) {
          c.header('Cache-Control', 'public, max-age=31536000, immutable')
        } else if (path.endsWith('sw.js')) {
          c.header('Cache-Control', 'no-cache')
        }
      },
    }),
  )
  // Single-page app: any unknown path is a client route.
  app.get('*', async (c) => {
    const html = await readFile(join(clientDir, 'index.html'), 'utf8')
    return c.html(html)
  })
}

async function main(): Promise<void> {
  await runMigrations()
  startScheduler()
  serve({ fetch: app.fetch, port: env.PORT }, (info) => {
    console.log(`[valeriapp] escuchando en http://localhost:${info.port} (${env.NODE_ENV})`)
  })
}

main().catch((error) => {
  console.error('[valeriapp] arranque fallido', error)
  process.exit(1)
})

export { app }
