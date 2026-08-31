/**
 * Creates the first household, user and baby from the command line, so the
 * registration page can stay invite-only from the very first minute.
 *
 *   pnpm seed --user <usuario> --password "…" --name "<Nombre>" \
 *             --household "<Hogar>" --baby "<Bebé>" --birth AAAA-MM-DD
 */
import { parseArgs } from 'node:util'
import { sql as raw } from 'drizzle-orm'
import { db, sql } from './client.js'
import { babies, households, users } from './schema.js'
import { hashPassword, generateInviteCode } from '../lib/auth.js'
import { invites } from './schema.js'
import { runMigrations } from './migrate.js'

const { values } = parseArgs({
  options: {
    user: { type: 'string' },
    password: { type: 'string' },
    name: { type: 'string' },
    household: { type: 'string', default: 'Casa' },
    baby: { type: 'string' },
    birth: { type: 'string' },
    timezone: { type: 'string', default: 'Europe/Madrid' },
  },
})

function required(name: string, value: string | undefined): string {
  if (!value) {
    console.error(`Falta --${name}`)
    process.exit(1)
  }
  return value
}

async function main(): Promise<void> {
  await runMigrations()

  const username = required('user', values.user)
  const password = required('password', values.password)
  const displayName = values.name ?? username
  const babyName = values.baby
  const birthDate = values.birth
  if (Boolean(babyName) !== Boolean(birthDate)) {
    console.error('--baby y --birth van juntos, o ninguno de los dos')
    process.exit(1)
  }

  const existing = await db
    .select({ id: users.id })
    .from(users)
    .where(raw`lower(${users.username}) = lower(${username})`)
    .limit(1)
  if (existing.length > 0) {
    console.error(`El usuario "${username}" ya existe`)
    process.exit(1)
  }

  const [household] = await db
    .insert(households)
    .values({ name: values.household ?? 'Casa', timezone: values.timezone ?? 'Europe/Madrid' })
    .returning()
  if (!household) throw new Error('No se pudo crear el hogar')

  const [user] = await db
    .insert(users)
    .values({
      householdId: household.id,
      username,
      displayName,
      passwordHash: await hashPassword(password),
    })
    .returning()
  if (!user) throw new Error('No se pudo crear el usuario')

  const baby =
    babyName && birthDate
      ? (
          await db
            .insert(babies)
            .values({ householdId: household.id, name: babyName, birthDate })
            .returning()
        )[0]
      : null

  const code = generateInviteCode()
  await db.insert(invites).values({
    householdId: household.id,
    code,
    createdBy: user.id,
    expiresAt: new Date(Date.now() + 24 * 3_600_000),
  })

  console.log('\nHogar creado.')
  console.log(`  Usuario:  ${username}`)
  console.log(`  Bebé:     ${baby ? `${baby.name} (${baby.birthDate})` : 'ninguno todavía, se añade desde Ajustes'}`)
  console.log(`  Invitación para el segundo cuidador: ${code}  (caduca en 24 h)\n`)

  await sql.end({ timeout: 5 })
}

main().catch(async (error) => {
  console.error(error)
  await sql.end({ timeout: 5 }).catch(() => {})
  process.exit(1)
})
