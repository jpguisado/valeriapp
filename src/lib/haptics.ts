/**
 * Vibration patterns, one per kind of action.
 *
 * Android honours these; on iPhone support is inconsistent (and since iOS 18.4
 * it needs a real click, with the permission expiring a second later). So this
 * is always a bonus on top of the visible toast, never the only feedback —
 * and it fails silently when the browser will not play along.
 */
export type Haptic = 'start' | 'stop' | 'record' | 'toggle' | 'delete' | 'error'

const PATTERNS: Record<Haptic, number | number[]> = {
  start: 15,
  stop: [20, 60, 20],
  record: 12,
  toggle: 12,
  delete: [30, 40, 30],
  error: [60, 40, 60],
}

const SETTING_KEY = 'valeriapp.haptics'

export function hapticsEnabled(): boolean {
  try {
    return localStorage.getItem(SETTING_KEY) !== 'off'
  } catch {
    return true
  }
}

export function setHapticsEnabled(enabled: boolean): void {
  try {
    localStorage.setItem(SETTING_KEY, enabled ? 'on' : 'off')
  } catch {
    // A private window that refuses storage is not a reason to fail.
  }
}

export function hapticsSupported(): boolean {
  return typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function'
}

export function vibrate(kind: Haptic): void {
  if (!hapticsSupported() || !hapticsEnabled()) return
  try {
    navigator.vibrate(PATTERNS[kind])
  } catch {
    // Some browsers throw instead of returning false. Never worth surfacing.
  }
}
