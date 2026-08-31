import { EVENT_LABELS, type BabyEvent } from '@shared/events'
import { dayKeyOf, zonedParts, type DayKey } from '@shared/time'

export function pad(value: number): string {
  return String(value).padStart(2, '0')
}

export function clock(instant: string | number | Date, tz: string): string {
  const parts = zonedParts(instant, tz)
  return `${pad(parts.hour)}:${pad(parts.minute)}`
}

const WEEKDAYS = ['lun', 'mar', 'mié', 'jue', 'vie', 'sáb', 'dom']
const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']
const MONTHS_LONG = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
]

export function dayLabel(dayKey: DayKey, tz: string, now: number = Date.now()): string {
  const today = dayKeyOf(now, tz)
  if (dayKey === today) return 'Hoy'
  const yesterday = dayKeyOf(now - 86_400_000, tz)
  if (dayKey === yesterday) return 'Ayer'
  const [year, month, day] = dayKey.split('-').map(Number)
  const weekday = WEEKDAYS[(new Date(Date.UTC(year ?? 0, (month ?? 1) - 1, day ?? 1)).getUTCDay() + 6) % 7]
  const label = `${weekday} ${day} ${MONTHS[(month ?? 1) - 1]}`
  return today.slice(0, 4) === dayKey.slice(0, 4) ? label : `${label} ${year}`
}

const WEEKDAYS_LONG = [
  'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo',
]

/** "Domingo, 30 de agosto" — the line above the baby's name. */
export function longDate(instant: string | number | Date, tz: string): string {
  const parts = zonedParts(instant, tz)
  return `${WEEKDAYS_LONG[parts.weekday - 1]}, ${parts.day} de ${MONTHS_LONG[parts.month - 1]}`
}

/** "4 de agosto" — how a birth date reads in a sentence. */
export function birthLabel(dayKey: DayKey, now: number = Date.now()): string {
  const [year, month, day] = dayKey.split('-').map(Number)
  const thisYear = new Date(now).getFullYear()
  const base = `${day} de ${MONTHS_LONG[(month ?? 1) - 1]}`
  return year === thisYear ? base : `${base} de ${year}`
}

/** "25 – 31 de agosto", o "28 ago – 3 sep" cuando la ventana cruza de mes. */
export function rangeLabel(from: DayKey, to: DayKey): string {
  const [fromYear, fromMonth, fromDay] = from.split('-').map(Number)
  const [toYear, toMonth, toDay] = to.split('-').map(Number)
  if (fromYear === toYear && fromMonth === toMonth) {
    return `${fromDay} – ${toDay} de ${MONTHS_LONG[(fromMonth ?? 1) - 1]}`
  }
  if (fromYear === toYear) {
    return `${fromDay} ${MONTHS[(fromMonth ?? 1) - 1]} – ${toDay} ${MONTHS[(toMonth ?? 1) - 1]}`
  }
  return `${fromDay} ${MONTHS[(fromMonth ?? 1) - 1]} ${fromYear} – ${toDay} ${MONTHS[(toMonth ?? 1) - 1]} ${toYear}`
}

export function monthLabel(dayKey: DayKey): string {
  const [year, month] = dayKey.split('-').map(Number)
  return `${MONTHS_LONG[(month ?? 1) - 1]} de ${year}`
}

/** "hace 2 h 15 min" — the single most-read string in the whole app. */
export function ago(instant: string | number | Date, now: number = Date.now()): string {
  const ms = now - new Date(instant).getTime()
  if (ms < 0) return 'en el futuro'
  const minutes = Math.floor(ms / 60_000)
  if (minutes < 1) return 'ahora mismo'
  if (minutes < 60) return `hace ${minutes} min`
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  if (hours < 24) return rest ? `hace ${hours} h ${rest} min` : `hace ${hours} h`
  const days = Math.floor(hours / 24)
  return days === 1 ? 'hace 1 día' : `hace ${days} días`
}

export function duration(seconds: number | null): string {
  if (seconds === null) return ''
  const total = Math.round(seconds / 60)
  const hours = Math.floor(total / 60)
  const minutes = total % 60
  if (hours === 0) return `${minutes} min`
  return minutes ? `${hours} h ${minutes} min` : `${hours} h`
}

/**
 * Readout for a timer that is running right now: seconds while the session is
 * short, so it visibly moves, and minutes once it is long, where a ticking
 * second is noise and a redraw every second is wasted battery.
 */
export function liveDuration(seconds: number): string {
  if (seconds >= 3600) return duration(seconds)
  const total = Math.max(0, Math.floor(seconds))
  return `${Math.floor(total / 60)}:${pad(total % 60)}`
}

export function hours(seconds: number): string {
  const value = seconds / 3600
  return `${value.toFixed(1).replace('.', ',')} h`
}

export function grams(value: number | null): string {
  if (value === null) return '—'
  return `${(value / 1000).toFixed(3).replace('.', ',')} kg`
}

export function cm(value: number | null): string {
  if (value === null) return '—'
  return `${value.toFixed(1).replace('.', ',')} cm`
}

export function celsius(value: number | null): string {
  if (value === null) return '—'
  return `${value.toFixed(1).replace('.', ',')} ºC`
}

export function number(value: number, decimals = 1): string {
  return value.toFixed(decimals).replace('.', ',')
}

export function ml(value: number): string {
  return `${Math.round(value)} ml`
}

export function eventTitle(event: BabyEvent): string {
  return EVENT_LABELS[event.type]
}

export function babyAge(birthDate: DayKey, now: number = Date.now()): string {
  const birth = new Date(`${birthDate}T00:00:00Z`).getTime()
  const days = Math.max(0, Math.floor((now - birth) / 86_400_000))
  if (days < 14) return days === 1 ? '1 día' : `${days} días`
  if (days < 60) {
    const weeks = Math.floor(days / 7)
    return `${weeks} semanas`
  }
  const months = Math.floor(days / 30.4375)
  if (months < 24) return `${months} meses`
  const years = Math.floor(months / 12)
  const rest = months % 12
  return rest ? `${years} años y ${rest} meses` : `${years} años`
}
