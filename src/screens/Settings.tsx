import { useEffect, useState, type ReactNode } from 'react'
import { Baby, Bell, ChevronRight, Download, KeyRound, Ruler, Users } from 'lucide-react'
import {
  REMINDER_DESCRIPTIONS,
  REMINDER_LABELS,
  REMINDER_TYPES,
  defaultSettings,
  type ReminderSettings,
  type ReminderType,
} from '@shared/reminders'
import { ageInMonths, deviceTimezone, isValidTimezone } from '@shared/time'
import { PageHeader } from '@/components/PageHeader'
import { Check, ChevronLeft, LogOut, Plus, RefreshCw } from '@/components/icons'
import { api } from '@/lib/api'
import { babyAge, birthLabel } from '@/lib/format'
import { useSyncStatus } from '@/lib/hooks'
import { disablePush, enablePush, permission, pushSupported, requiresInstall } from '@/lib/push'
import { useRouter } from '@/lib/router'
import { useSession } from '@/lib/session'
import { hapticsEnabled, hapticsSupported, setHapticsEnabled, vibrate } from '@/lib/haptics'
import { sync } from '@/lib/sync'

/** Settings is a grouped list that drills down, not one long scroll of forms. */
export function Settings() {
  const { path } = useRouter()
  const section = path.replace(/^\/ajustes\/?/, '')

  switch (section) {
    case 'bebes':
      return <BabiesScreen />
    case 'recordatorios':
      return <RemindersScreen />
    case 'notificaciones':
      return <NotificationsScreen />
    case 'hogar':
      return <HouseholdScreen />
    case 'datos':
      return <DataScreen />
    case 'cuenta':
      return <AccountScreen />
    default:
      return <SettingsIndex />
  }
}

function SettingsIndex() {
  const { babies, activeBabyId, members, user } = useSession()
  const baby = babies.find((candidate) => candidate.id === activeBabyId) ?? babies[0]
  const pushState = permission()

  return (
    <div className="page">
      <PageHeader title="Ajustes" />

      {baby && (
        <div className="profile-card">
          <span className="avatar">
            <Baby size={30} strokeWidth={1.7} aria-hidden="true" />
          </span>
          <div className="col" style={{ gap: 2 }}>
            <h2>{baby.name}</h2>
            <p className="small dim">
              {babyAge(baby.birthDate)} · nació el {birthLabel(baby.birthDate)}
            </p>
          </div>
        </div>
      )}

      <p className="section-label">Bebé</p>
      <div className="list-group">
        <Row
          to="/ajustes/bebes"
          icon={<Baby size={19} />}
          label={babies.length > 1 ? 'Bebés' : 'Perfil'}
          value={babies.map((item) => item.name).join(', ') || 'Añadir'}
        />
        <Row
          to="/ajustes/recordatorios"
          icon={<Bell size={19} />}
          label="Recordatorios"
          value={baby ? baby.name : '—'}
        />
      </div>

      <p className="section-label">Aplicación</p>
      <div className="list-group">
        <Row
          to="/ajustes/notificaciones"
          icon={<Bell size={19} />}
          label="Notificaciones"
          value={pushState === 'granted' ? 'Activadas' : 'Desactivadas'}
        />
        <Row
          to="/ajustes/hogar"
          icon={<Users size={19} />}
          label="Hogar"
          value={`${members.length} ${members.length === 1 ? 'persona' : 'personas'}`}
        />
        <Row to="/ajustes/datos" icon={<Download size={19} />} label="Datos" value="Exportar" />
      </div>

      <p className="section-label">Cuenta</p>
      <div className="list-group">
        <Row
          to="/ajustes/cuenta"
          icon={<KeyRound size={19} />}
          label="Cuenta"
          value={user?.displayName ?? ''}
        />
      </div>

      <p className="tiny faint center" style={{ marginTop: 8 }}>
        Valeriapp · v1.0
      </p>
    </div>
  )
}

function Row({
  to,
  icon,
  label,
  value,
}: {
  to: string
  icon: ReactNode
  label: string
  value?: string
}) {
  const { navigate } = useRouter()
  return (
    <button className="list-row" onClick={() => navigate(to)}>
      <span className="bullet">{icon}</span>
      <span className="label">{label}</span>
      {value && <span className="value">{value}</span>}
      <ChevronRight size={18} className="faint" aria-hidden="true" />
    </button>
  )
}

function SubScreen({
  title,
  subtitle,
  children,
}: {
  title: string
  subtitle?: string
  children: ReactNode
}) {
  const { navigate } = useRouter()
  return (
    <div className="page">
      <div className="row" style={{ paddingTop: 'calc(10px + var(--safe-top))' }}>
        <button className="btn ghost icon" onClick={() => navigate('/ajustes')} aria-label="Volver">
          <ChevronLeft size={20} />
        </button>
      </div>
      <PageHeader title={title} subtitle={subtitle} />
      {children}
    </div>
  )
}

function BabiesScreen() {
  const { babies, refresh } = useSession()
  const [name, setName] = useState('')
  const [birthDate, setBirthDate] = useState('')
  const [sex, setSex] = useState<'female' | 'male' | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function add(): Promise<void> {
    setBusy(true)
    setError(null)
    try {
      await api.post('/api/babies', { name: name.trim(), birthDate, sex })
      setName('')
      setBirthDate('')
      setSex(null)
      await sync()
      await refresh()
    } catch (problem) {
      setError((problem as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <SubScreen title="Bebés" subtitle="Quién aparece en la app.">
      {babies.map((baby) => (
        <div key={baby.id} className="card col">
          <div className="row between">
            <span className="row" style={{ gap: 12 }}>
              <span className="bullet sm">
                <Baby size={18} />
              </span>
              <span className="col" style={{ gap: 0 }}>
                <strong>{baby.name}</strong>
                <span className="tiny faint">{babyAge(baby.birthDate)}</span>
              </span>
            </span>
          </div>
          <div className="row wrap">
            {(['female', 'male'] as const).map((option) => (
              <button
                key={option}
                className="chip"
                aria-pressed={baby.sex === option}
                onClick={async () => {
                  await api.patch(`/api/babies/${baby.id}`, { sex: option })
                  await sync()
                  await refresh()
                }}
              >
                {option === 'female' ? 'Niña' : 'Niño'}
              </button>
            ))}
          </div>
        </div>
      ))}

      <div className="card col">
        <h3>Añadir bebé</h3>
        <label className="field">
          Nombre
          <input type="text" value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="field">
          Fecha de nacimiento
          <input type="date" value={birthDate} onChange={(e) => setBirthDate(e.target.value)} />
        </label>
        <div className="col" style={{ gap: 6 }}>
          <span className="tiny dim">Sexo</span>
          <div className="row wrap">
            <button className="chip" aria-pressed={sex === 'female'} onClick={() => setSex('female')}>
              Niña
            </button>
            <button className="chip" aria-pressed={sex === 'male'} onClick={() => setSex('male')}>
              Niño
            </button>
          </div>
          <span className="tiny faint">
            Las curvas de crecimiento de la OMS son distintas para cada uno. Sin este dato,
            la gráfica de peso se dibuja sin la banda de referencia.
          </span>
        </div>
        {error && <p className="error-text">{error}</p>}
        <button className="btn primary" disabled={busy || !name || !birthDate} onClick={() => void add()}>
          <Plus size={17} /> Añadir
        </button>
      </div>
    </SubScreen>
  )
}

function RemindersScreen() {
  const { babies, activeBabyId } = useSession()
  const baby = babies.find((candidate) => candidate.id === activeBabyId) ?? babies[0]
  const [settings, setSettings] = useState<ReminderSettings | null>(null)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    if (!baby) return
    api
      .get<{ reminders?: Record<string, ReminderSettings> }>('/api/sync/snapshot')
      .then((response) =>
        setSettings(response.reminders?.[baby.id] ?? defaultSettings(ageInMonths(baby.birthDate))),
      )
      .catch(() => setSettings(defaultSettings(ageInMonths(baby.birthDate))))
  }, [baby?.id])

  if (!baby) return <SubScreen title="Recordatorios">{null}</SubScreen>
  if (!settings) return <SubScreen title="Recordatorios"><div className="skeleton" /></SubScreen>

  function update(type: ReminderType, patch: Partial<ReminderSettings[ReminderType]>): void {
    setSettings((current) => (current ? { ...current, [type]: { ...current[type], ...patch } } : current))
    setSaved(false)
  }

  async function save(): Promise<void> {
    if (!settings || !baby) return
    await api.put(
      `/api/settings/reminders/${baby.id}`,
      REMINDER_TYPES.map((type) => ({
        type,
        enabled: settings[type].enabled,
        thresholdMinutes: settings[type].thresholdMinutes,
        atTime: settings[type].atTime,
      })),
    )
    setSaved(true)
  }

  return (
    <SubScreen title="Recordatorios" subtitle={baby.name}>
      {REMINDER_TYPES.map((type) => (
        <div key={type} className="card col" style={{ gap: 6 }}>
          <label className="switch">
            <span className="col" style={{ gap: 1 }}>
              <span className="strong">{REMINDER_LABELS[type]}</span>
              <span className="tiny faint">{REMINDER_DESCRIPTIONS[type]}</span>
            </span>
            <input
              type="checkbox"
              checked={settings[type].enabled}
              onChange={(e) => update(type, { enabled: e.target.checked })}
            />
          </label>
          {settings[type].enabled && type !== 'breast_alternation' && type !== 'daily_summary' && (
            <label className="field">
              Avisar tras (minutos)
              <input
                type="number"
                inputMode="numeric"
                min={15}
                step={15}
                value={settings[type].thresholdMinutes}
                onChange={(e) => update(type, { thresholdMinutes: Number(e.target.value) })}
              />
            </label>
          )}
          {settings[type].enabled && type === 'daily_summary' && (
            <label className="field">
              Hora
              <input
                type="time"
                value={settings[type].atTime ?? '22:00'}
                onChange={(e) => update(type, { atTime: e.target.value })}
              />
            </label>
          )}
        </div>
      ))}

      <button className="btn primary block" onClick={() => void save()}>
        {saved ? (
          <>
            <Check size={17} /> Guardado
          </>
        ) : (
          'Guardar recordatorios'
        )}
      </button>
      <p className="tiny faint">
        Los avisos llegan a todos los móviles del hogar, también de madrugada, y se cancelan solos en
        los demás cuando alguien registra el evento.
      </p>
    </SubScreen>
  )
}

function NotificationsScreen() {
  const { vapidPublicKey } = useSession()
  const [state, setState] = useState(() => permission())
  const [message, setMessage] = useState<string | null>(null)
  const [haptics, setHaptics] = useState(() => hapticsEnabled())

  async function enable(): Promise<void> {
    const result = await enablePush(vapidPublicKey)
    setState(permission())
    setMessage(
      result === 'ok'
        ? 'Notificaciones activadas en este dispositivo.'
        : result === 'denied'
          ? 'Has bloqueado las notificaciones en los ajustes del navegador.'
          : 'Este navegador no admite notificaciones.',
    )
  }

  return (
    <SubScreen title="Notificaciones" subtitle="Se configuran en cada dispositivo.">
      {requiresInstall() && (
        <p className="banner">
          En iPhone hay que añadir la app a la pantalla de inicio para recibir avisos: botón Compartir →
          “Añadir a inicio”.
        </p>
      )}

      <div className="card col">
        <label className="switch">
          <span className="col" style={{ gap: 1 }}>
            <span className="strong">Vibración al registrar</span>
            <span className="tiny faint">
              {hapticsSupported()
                ? 'Un toque corto al iniciar y al parar.'
                : 'Este navegador no vibra; el aviso en pantalla sigue funcionando.'}
            </span>
          </span>
          <input
            type="checkbox"
            checked={haptics}
            disabled={!hapticsSupported()}
            onChange={(e) => {
              setHaptics(e.target.checked)
              setHapticsEnabled(e.target.checked)
              if (e.target.checked) vibrate('record')
            }}
          />
        </label>
      </div>

      <div className="card col">
        {state === 'granted' ? (
          <>
            <p className="small">Activadas en este dispositivo.</p>
            <button className="btn ghost" onClick={() => void api.post('/api/push/test')}>
              <Bell size={17} /> Enviar notificación de prueba
            </button>
            <button
              className="btn ghost"
              onClick={async () => {
                await disablePush()
                setState(permission())
              }}
            >
              Desactivar en este dispositivo
            </button>
          </>
        ) : (
          <button className="btn primary" onClick={() => void enable()} disabled={!pushSupported()}>
            <Bell size={17} /> Activar notificaciones
          </button>
        )}
        {message && <p className="tiny faint">{message}</p>}
      </div>
    </SubScreen>
  )
}

function HouseholdScreen() {
  const { household, members, refresh } = useSession()
  const [timezoneMode, setTimezoneMode] = useState(household?.timezoneMode ?? 'device')
  const [timezone, setTimezone] = useState(household?.timezone ?? 'Europe/Madrid')
  const [backupEmail, setBackupEmail] = useState(household?.backupEmail ?? '')
  const [settleMinutes, setSettleMinutes] = useState(household?.settleMinutes ?? 25)
  const [invite, setInvite] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    setTimezoneMode(household?.timezoneMode ?? 'device')
    setTimezone(household?.timezone ?? 'Europe/Madrid')
    setBackupEmail(household?.backupEmail ?? '')
    setSettleMinutes(household?.settleMinutes ?? 25)
  }, [
    household?.id,
    household?.timezoneMode,
    household?.timezone,
    household?.backupEmail,
    household?.settleMinutes,
  ])

  async function save(): Promise<void> {
    await api.patch('/api/settings/household', {
      timezoneMode,
      timezone,
      backupEmail,
      settleMinutes,
    })
    setSaved(true)
    await sync()
    await refresh()
  }

  return (
    <SubScreen title="Hogar" subtitle={members.map((member) => member.displayName).join(', ')}>
      <div className="card col">
        <h3>Invitar</h3>
        <button
          className="btn ghost"
          onClick={async () => {
            const response = await api.post<{ invite: { code: string } }>('/api/auth/invites')
            setInvite(response.invite.code)
          }}
        >
          <KeyRound size={17} /> Generar código de invitación
        </button>
        {invite && (
          <p className="banner">
            Código <strong className="mono">{invite}</strong> · un solo uso, caduca en 24 horas.
          </p>
        )}
      </div>

      <div className="card col">
        <h3>Modo «A dormir»</h3>
        <p className="tiny faint">
          Con el modo activo se considera que duerme salvo lo que anotes. Cada evento que
          la despierta corta el sueño y lo reanuda pasados estos minutos de rutina —
          biberón, gases, volver a la cuna.
        </p>
        <label className="field">
          Minutos de rutina tras cada evento
          <input
            type="number"
            inputMode="numeric"
            min={0}
            max={180}
            step={5}
            value={settleMinutes}
            onChange={(e) => setSettleMinutes(Number(e.target.value))}
          />
          <span className="tiny faint">
            Lo comparten los dos móviles: si cada uno usara un número distinto, los tramos
            de sueño no coincidirían.
          </span>
        </label>
      </div>

      <div className="card col">
        <h3>Zona horaria</h3>
        <div className="row wrap">
          <button
            className="chip"
            aria-pressed={timezoneMode === 'device'}
            onClick={() => setTimezoneMode('device')}
          >
            Seguir al dispositivo
          </button>
          <button
            className="chip"
            aria-pressed={timezoneMode === 'fixed'}
            onClick={() => setTimezoneMode('fixed')}
          >
            Zona fija
          </button>
        </div>
        <label className="field">
          Zona horaria del hogar
          <input type="text" value={timezone} onChange={(e) => setTimezone(e.target.value)} />
          <span className="tiny faint">
            {isValidTimezone(timezone) ? `Este dispositivo está en ${deviceTimezone()}.` : 'Zona desconocida.'}
          </span>
        </label>
        <label className="field">
          Correo para las copias de seguridad
          <input type="email" value={backupEmail} onChange={(e) => setBackupEmail(e.target.value)} />
        </label>
        <button className="btn primary" onClick={() => void save()} disabled={!isValidTimezone(timezone)}>
          {saved ? (
            <>
              <Check size={17} /> Guardado
            </>
          ) : (
            'Guardar'
          )}
        </button>
      </div>
    </SubScreen>
  )
}

function DataScreen() {
  return (
    <SubScreen title="Datos" subtitle="Todo lo registrado es tuyo.">
      <div className="card col">
        <p className="small dim">
          Descarga un JSON fiel y reimportable más una tabla CSV por tipo de evento.
        </p>
        <a className="btn ghost" href="/api/export" download>
          <Download size={17} /> Exportar todo (.zip)
        </a>
        <p className="tiny faint">
          Además, el servidor guarda una copia diaria y envía la del domingo por correo.
        </p>
      </div>
      <div className="list-group">
        <div className="list-row">
          <span className="bullet">
            <Ruler size={19} />
          </span>
          <span className="label">Unidades</span>
          <span className="value">ml · kg · ºC</span>
        </div>
      </div>
    </SubScreen>
  )
}

function AccountScreen() {
  const session = useSession()
  const status = useSyncStatus()
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function submit(event: React.FormEvent): Promise<void> {
    event.preventDefault()
    setError(null)
    setMessage(null)
    try {
      await api.post('/api/auth/password', { currentPassword, newPassword })
      setCurrentPassword('')
      setNewPassword('')
      setMessage('Contraseña actualizada.')
    } catch (problem) {
      setError((problem as Error).message)
    }
  }

  return (
    <SubScreen
      title="Cuenta"
      subtitle={session.user ? `${session.user.displayName} · ${session.user.username}` : undefined}
    >
      <form className="card col" onSubmit={submit}>
        <h3>Contraseña</h3>
        <label className="field">
          Contraseña actual
          <input
            type="password"
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            autoComplete="current-password"
            required
          />
        </label>
        <label className="field">
          Contraseña nueva
          <input
            type="password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            autoComplete="new-password"
            minLength={8}
            required
          />
        </label>
        {error && <p className="error-text">{error}</p>}
        {message && <p className="small">{message}</p>}
        <button className="btn primary">Cambiar contraseña</button>
      </form>

      <div className="card col">
        <h3>Sincronización</h3>
        <p className="tiny faint">
          Última:{' '}
          {status.lastSyncAt ? new Date(status.lastSyncAt).toLocaleString('es-ES') : 'nunca'}
          {status.pending > 0 ? ` · ${status.pending} pendientes` : ''}
        </p>
        <button className="btn ghost" onClick={() => void sync()}>
          <RefreshCw size={17} /> Sincronizar ahora
        </button>
        <button className="btn danger" onClick={() => void session.logout()}>
          <LogOut size={17} /> Cerrar sesión
        </button>
      </div>
    </SubScreen>
  )
}
