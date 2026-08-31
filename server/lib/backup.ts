/**
 * Backups live inside the app process on purpose: one deployment unit, no host
 * cron to forget. A daily dump is kept on disk for 30 days; once a week the
 * newest one is emailed out, because a copy that never leaves the server does
 * not protect you from losing the server.
 */
import { spawn } from 'node:child_process'
import { createWriteStream } from 'node:fs'
import { mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { pipeline } from 'node:stream/promises'
import { createGzip } from 'node:zlib'
import { env } from './env.js'

const STATE_FILE = 'state.json'
const DUMP_HOUR = 3
const DUMP_MINUTE = 30
/** 0 = Sunday. The weekly email goes out right after Sunday's dump. */
const EMAIL_WEEKDAY = 0
const MAX_ATTACHMENT_BYTES = 15 * 1024 * 1024

interface BackupState {
  lastDumpDay?: string
  lastEmailDay?: string
}

async function readState(): Promise<BackupState> {
  try {
    return JSON.parse(await readFile(join(env.BACKUP_DIR, STATE_FILE), 'utf8')) as BackupState
  } catch {
    return {}
  }
}

async function writeState(state: BackupState): Promise<void> {
  await mkdir(env.BACKUP_DIR, { recursive: true })
  await writeFile(join(env.BACKUP_DIR, STATE_FILE), JSON.stringify(state, null, 2))
}

function localDayKey(date: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Madrid',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date)
  return parts
}

export async function createDump(now = new Date()): Promise<string> {
  await mkdir(env.BACKUP_DIR, { recursive: true })
  const name = `valeriapp-${localDayKey(now)}.sql.gz`
  const target = join(env.BACKUP_DIR, name)

  await new Promise<void>((resolve, reject) => {
    const child = spawn('pg_dump', ['--no-owner', '--no-privileges', env.DATABASE_URL], {
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stderr = ''
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString()
    })
    child.on('error', reject)

    pipeline(child.stdout, createGzip({ level: 9 }), createWriteStream(target))
      .then(() => {
        child.on('close', (code) => {
          if (code === 0) resolve()
          else reject(new Error(`pg_dump salió con código ${code}: ${stderr.trim()}`))
        })
      })
      .catch(reject)
  })

  return target
}

export async function pruneOldDumps(): Promise<number> {
  const cutoff = Date.now() - env.BACKUP_RETENTION_DAYS * 86_400_000
  let removed = 0
  for (const file of await readdir(env.BACKUP_DIR).catch(() => [])) {
    if (!file.endsWith('.sql.gz')) continue
    const path = join(env.BACKUP_DIR, file)
    const info = await stat(path)
    if (info.mtimeMs < cutoff) {
      await rm(path)
      removed += 1
    }
  }
  return removed
}

export async function emailDump(path: string, to: string): Promise<void> {
  if (!env.RESEND_API_KEY) {
    console.warn('[backup] RESEND_API_KEY sin configurar, no se envía el correo')
    return
  }
  const info = await stat(path)
  const name = path.split('/').pop() ?? 'backup.sql.gz'
  const tooBig = info.size > MAX_ATTACHMENT_BYTES
  const sizeKb = Math.round(info.size / 1024)

  const body = {
    from: env.BACKUP_EMAIL_FROM,
    to: [to],
    subject: `Valeriapp · copia de seguridad ${name}`,
    text: tooBig
      ? `La copia ${name} pesa ${sizeKb} KB y supera el límite de adjunto. Descárgala del servidor: ${path}`
      : `Copia de seguridad semanal de Valeriapp.\n\nFichero: ${name}\nTamaño: ${sizeKb} KB\n\nPara restaurar:\n  gunzip -c ${name} | psql "$DATABASE_URL"`,
    attachments: tooBig
      ? undefined
      : [{ filename: name, content: (await readFile(path)).toString('base64') }],
  }

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })
  if (!response.ok) {
    throw new Error(`Resend respondió ${response.status}: ${await response.text()}`)
  }
  console.log(`[backup] copia enviada por correo a ${to}`)
}

/** Called once a minute; does nothing except at the scheduled moments. */
export async function runBackupTick(now = new Date()): Promise<void> {
  if (!env.BACKUP_ENABLED) return

  const madrid = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Madrid',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    weekday: 'short',
  }).formatToParts(now)
  const hour = Number(madrid.find((p) => p.type === 'hour')?.value ?? -1)
  const minute = Number(madrid.find((p) => p.type === 'minute')?.value ?? -1)
  const weekday = madrid.find((p) => p.type === 'weekday')?.value
  const today = localDayKey(now)

  if (hour !== DUMP_HOUR || minute !== DUMP_MINUTE) return

  const state = await readState()
  if (state.lastDumpDay === today) return

  const path = await createDump(now)
  const pruned = await pruneOldDumps()
  state.lastDumpDay = today
  console.log(`[backup] dump creado en ${path} (${pruned} antiguos eliminados)`)

  const recipient = env.BACKUP_EMAIL_TO
  const isEmailDay = weekday === ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][EMAIL_WEEKDAY]
  if (recipient && isEmailDay && state.lastEmailDay !== today) {
    await emailDump(path, recipient)
    state.lastEmailDay = today
  }
  await writeState(state)
}
