import { useState } from 'react'
import { api, ApiError } from '@/lib/api'
import { Link, useRouter } from '@/lib/router'
import { useSession, type SessionUser } from '@/lib/session'
import { Baby } from 'lucide-react'

/** Public page, useless without a single-use household code that expires in 24h. */
export function Register() {
  const { signedIn } = useSession()
  const { navigate } = useRouter()
  const [form, setForm] = useState({ displayName: '', username: '', password: '', inviteCode: '' })
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const set = (key: keyof typeof form) => (event: React.ChangeEvent<HTMLInputElement>) =>
    setForm((prev) => ({ ...prev, [key]: event.target.value }))

  async function submit(event: React.FormEvent): Promise<void> {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const response = await api.post<{ user: SessionUser }>('/api/auth/register', {
        ...form,
        inviteCode: form.inviteCode.trim().toUpperCase(),
      })
      await signedIn(response.user)
      navigate('/')
    } catch (problem) {
      setError(problem instanceof ApiError ? problem.message : 'No se pudo conectar')
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="centered-form">
      <form onSubmit={submit}>
        <div className="brand">
          <span className="mark">
            <Baby size={30} strokeWidth={1.7} aria-hidden="true" />
          </span>
          <h1>Crear cuenta</h1>
        </div>
        <label className="field">
          Código de invitación
          <input
            type="text"
            value={form.inviteCode}
            onChange={set('inviteCode')}
            placeholder="ABC-123"
            autoCapitalize="characters"
            required
          />
        </label>
        <label className="field">
          Tu nombre
          <input type="text" value={form.displayName} onChange={set('displayName')} required />
        </label>
        <label className="field">
          Usuario
          <input
            type="text"
            value={form.username}
            onChange={set('username')}
            autoComplete="username"
            autoCapitalize="none"
            required
          />
        </label>
        <label className="field">
          Contraseña
          <input
            type="password"
            value={form.password}
            onChange={set('password')}
            autoComplete="new-password"
            minLength={8}
            required
          />
        </label>
        {error && <p className="error-text">{error}</p>}
        <button className="btn primary block" disabled={busy}>
          {busy ? 'Creando…' : 'Crear cuenta'}
        </button>
        <p className="small center dim">
          <Link to="/entrar">Volver a entrar</Link>
        </p>
      </form>
    </main>
  )
}
