import { zonedParts } from '@shared/time'

function pad(value: number): string {
  return String(value).padStart(2, '0')
}

/** ISO instant → value for <input type="datetime-local"> in a given zone. */
export function isoToLocalInput(iso: string, tz: string): string {
  const p = zonedParts(iso, tz)
  return `${p.year}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}`
}

/**
 * The reverse. The browser gives us a wall-clock time with no zone, which we
 * interpret in the device's own zone — the same zone we stamp on the event.
 */
export function localInputToIso(value: string): string {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString()
}

export function nowLocalInput(): string {
  const now = new Date()
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}`
}

export function isoToDateInput(iso: string, tz: string): string {
  return zonedParts(iso, tz).dayKey
}
