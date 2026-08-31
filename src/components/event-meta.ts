import type { EventType } from '@shared/events'

export const EVENT_ACCENTS: Record<EventType, string> = {
  breast: 'var(--breast)',
  bottle: 'var(--bottle)',
  pump: 'var(--pump)',
  sleep: 'var(--sleep)',
  wakeup: 'var(--wakeup)',
  diaper: 'var(--diaper)',
  temperature: 'var(--temperature)',
  weight: 'var(--measure)',
  height: 'var(--measure)',
  head: 'var(--measure)',
  medication: 'var(--medication)',
  note: 'var(--note)',
}

/**
 * Order of the picker. Fixed on purpose: a grid that reorders itself destroys
 * the muscle memory that makes it fast at four in the morning.
 */
export const PICKER_ORDER: EventType[] = [
  'breast',
  'bottle',
  'diaper',
  'sleep',
  'wakeup',
  'pump',
  'medication',
  'temperature',
  'weight',
  'height',
  'head',
  'note',
]

export const MEASUREMENT_TYPES: EventType[] = ['weight', 'height', 'head']
