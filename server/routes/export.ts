import { Hono } from 'hono'
import { eq } from 'drizzle-orm'
import {
  EVENT_LABELS,
  EVENT_TYPES,
  breastSplit,
  durationSeconds,
  firstSideOf,
  type BabyEvent,
  type EventType,
} from '../../shared/events.js'
import { dayKeyOf, zoneFor, zonedParts } from '../../shared/time.js'
import { db } from '../db/client.js'
import { babies, households, users } from '../db/schema.js'
import { allEventsOfHousehold } from '../lib/events-service.js'
import { requireAuth, type AppEnv } from '../lib/http.js'
import { createZip, toCsv } from '../lib/zip.js'

export const exportRoutes = new Hono<AppEnv>()

exportRoutes.use('*', requireAuth)

/**
 * Everything the household has, as JSON (re-importable) and CSV (openable),
 * zipped. This is the escape hatch that keeps the data yours.
 */
exportRoutes.get('/', async (c) => {
  const householdId = c.get('user').householdId
  const [household] = await db.select().from(households).where(eq(households.id, householdId)).limit(1)
  const babyRows = await db.select().from(babies).where(eq(babies.householdId, householdId))
  const memberRows = await db
    .select({ id: users.id, username: users.username, displayName: users.displayName })
    .from(users)
    .where(eq(users.householdId, householdId))
  const events = await allEventsOfHousehold(householdId)

  const babyNames = new Map(babyRows.map((baby) => [baby.id, baby.name]))
  const memberNames = new Map(memberRows.map((member) => [member.id, member.displayName]))
  const timezone = {
    mode: (household?.timezoneMode ?? 'device') as 'device' | 'fixed',
    fixed: household?.timezone ?? 'Europe/Madrid',
  }

  const entries = [
    {
      name: 'valeriapp.json',
      content: JSON.stringify(
        { exportedAt: new Date().toISOString(), household, babies: babyRows, members: memberRows, events },
        null,
        2,
      ),
    },
    {
      name: 'csv/eventos.csv',
      content: toCsv(
        events.map((event) => flatten(event, babyNames, memberNames, timezone)),
        COMMON_COLUMNS,
      ),
    },
    { name: 'csv/bebes.csv', content: toCsv(babyRows, ['id', 'name', 'birthDate', 'archived']) },
    { name: 'LEEME.txt', content: readme(events.length, babyRows.length) },
  ]

  for (const type of EVENT_TYPES) {
    const rows = events
      .filter((event) => event.type === type && !event.deletedAt)
      .map((event) => ({
        ...flatten(event, babyNames, memberNames, timezone),
        ...payloadColumns(event),
      }))
    if (rows.length === 0) continue
    entries.push({
      name: `csv/${type}.csv`,
      content: toCsv(rows, [...COMMON_COLUMNS, ...(PAYLOAD_COLUMNS[type] ?? [])]),
    })
  }

  const zip = createZip(entries)
  const stamp = dayKeyOf(Date.now(), timezone.fixed)
  c.header('Content-Type', 'application/zip')
  c.header('Content-Disposition', `attachment; filename="valeriapp-${stamp}.zip"`)
  return c.body(new Uint8Array(zip))
})

const COMMON_COLUMNS = [
  'id',
  'bebe',
  'tipo',
  'fecha',
  'hora_local',
  'fin_local',
  'duracion_min',
  'zona',
  'estimado',
  'registrado_por',
  'nota',
  'borrado',
]

const PAYLOAD_COLUMNS: Partial<Record<EventType, string[]>> = {
  breast: ['lado', 'empezo_por', 'minutos_izq', 'minutos_der'],
  bottle: ['ml', 'tipo_leche'],
  pump: ['lado', 'ml'],
  sleep: ['lugar'],
  diaper: ['contenido', 'consistencia', 'color', 'escape'],
  temperature: ['celsius', 'metodo'],
  weight: ['gramos'],
  height: ['cm'],
  head: ['cm'],
  medication: ['medicamento', 'dosis'],
}

function flatten(
  event: BabyEvent,
  babyNames: Map<string, string>,
  memberNames: Map<string, string>,
  timezone: { mode: 'device' | 'fixed'; fixed: string },
): Record<string, unknown> {
  const tz = zoneFor(event.tz, timezone)
  const start = zonedParts(event.occurredAt, tz)
  const end = event.endedAt ? zonedParts(event.endedAt, tz) : null
  const seconds = durationSeconds(event)
  return {
    id: event.id,
    bebe: babyNames.get(event.babyId) ?? event.babyId,
    tipo: EVENT_LABELS[event.type],
    fecha: start.dayKey,
    hora_local: `${pad(start.hour)}:${pad(start.minute)}`,
    fin_local: end ? `${pad(end.hour)}:${pad(end.minute)}` : '',
    duracion_min: seconds === null ? '' : Math.round(seconds / 60),
    zona: tz,
    estimado: event.estimated ? 'sí' : '',
    registrado_por: memberNames.get(event.createdBy) ?? '',
    nota: event.note ?? '',
    borrado: event.deletedAt ? 'sí' : '',
  }
}

function payloadColumns(event: BabyEvent): Record<string, unknown> {
  const p = event.payload as Record<string, unknown>
  switch (event.type) {
    case 'breast': {
      const split = breastSplit(event)
      const first = firstSideOf(event)
      return {
        lado: p.side,
        empezo_por: first === 'left' ? 'izquierdo' : first === 'right' ? 'derecho' : '',
        minutos_izq: Math.round(split.leftSeconds / 60),
        minutos_der: Math.round(split.rightSeconds / 60),
      }
    }
    case 'bottle':
      return { ml: p.ml, tipo_leche: p.kind }
    case 'pump':
      return { lado: p.side, ml: p.ml }
    case 'sleep':
      return { lugar: p.place ?? '' }
    case 'diaper':
      return {
        contenido: p.kind,
        consistencia: p.consistency ?? '',
        color: p.color ?? '',
        escape: p.leak ? 'sí' : '',
      }
    case 'temperature':
      return { celsius: p.celsius, metodo: p.method }
    case 'weight':
      return { gramos: p.grams }
    case 'height':
    case 'head':
      return { cm: p.cm }
    case 'medication':
      return { medicamento: p.name, dosis: p.dose ?? '' }
    default:
      return {}
  }
}

function pad(value: number): string {
  return String(value).padStart(2, '0')
}

function readme(eventCount: number, babyCount: number): string {
  return [
    'Valeriapp — exportación completa',
    '',
    `Generada el ${new Date().toISOString()}`,
    `${eventCount} eventos, ${babyCount} bebé(s).`,
    '',
    'valeriapp.json  Copia fiel de todo, reimportable.',
    'csv/            Una tabla por tipo de evento, para abrir en Excel.',
    '',
    'Las horas locales están expresadas en la zona en la que se registró',
    'cada evento (columna "zona").',
  ].join('\n')
}
