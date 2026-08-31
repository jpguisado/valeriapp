import { useState } from 'react'
import { api, ApiError } from '@/lib/api'
import { Link } from '@/lib/router'
import { useSession, type SessionUser } from '@/lib/session'
import { Baby } from 'lucide-react'

export function Login() {
  const { signedIn } = useSession()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(event: React.FormEvent): Promise<void> {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const response = await api.post<{ user: SessionUser }>('/api/auth/login', { username, password })
      await signedIn(response.user)
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
          <h1>Valeriapp</h1>
          <p className="small faint">El día a día de tu bebé.</p>
        </div>
        <label className="field">
          Usuario
          <input
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoComplete="username"
            autoCapitalize="none"
            required
          />
        </label>
        <label className="field">
          Contraseña
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            required
          />
        </label>
        {error && <p className="error-text">{error}</p>}
        <button className="btn primary block" disabled={busy}>
          {busy ? 'Entrando…' : 'Entrar'}
        </button>
        <p className="small center dim">
          ¿Tienes un código de invitación? <Link to="/registro">Crea tu cuenta</Link>
        </p>
      </form>
    </main>
  )
}
