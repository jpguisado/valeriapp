import { useSyncStatus } from '@/lib/hooks'
import { sync } from '@/lib/sync'
import { RefreshCw, WifiOff } from './icons'

/** Small, honest indicator: what is pending and whether the clock is off. */
export function SyncBadge() {
  const state = useSyncStatus()
  const skewMinutes = Math.round(Math.abs(state.clockSkewMs) / 60_000)

  const label =
    state.status === 'offline'
      ? state.pending > 0
        ? `Sin conexión · ${state.pending} por enviar`
        : 'Sin conexión'
      : state.status === 'syncing'
        ? 'Sincronizando…'
        : state.status === 'error'
          ? 'Error al sincronizar'
          : state.pending > 0
            ? `${state.pending} por enviar`
            : null

  if (!label && skewMinutes < 5) return null

  const offline = state.status === 'offline'

  return (
    <button className="badge" onClick={() => void sync()} title="Sincronizar ahora">
      {offline ? <WifiOff size={13} /> : <RefreshCw size={13} />}
      {label ?? `Reloj desfasado ${skewMinutes} min`}
    </button>
  )
}
