import { useEffect, useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import type { BabyEvent } from '@shared/events'
import { db, type StoredEvent } from './db'
import { subscribeToSync, syncState } from './sync'

/** Every non-deleted event of a baby, straight from IndexedDB. */
export function useEvents(babyId: string | null): BabyEvent[] {
  const events = useLiveQuery(async () => {
    if (!babyId) return [] as StoredEvent[]
    return db.events.where('babyId').equals(babyId).toArray()
  }, [babyId])

  return useMemo(() => {
    const rows = (events ?? []).filter((event) => !event.deletedAt)
    return rows.sort((a, b) => (a.occurredAt < b.occurredAt ? 1 : -1))
  }, [events])
}

export function useEvent(id: string | null): BabyEvent | undefined {
  return useLiveQuery(async () => (id ? db.events.get(id) : undefined), [id])
}

export function useRunningEvents(babyId: string | null): BabyEvent[] {
  const events = useEvents(babyId)
  return useMemo(() => events.filter((event) => event.running), [events])
}

export function useSyncStatus() {
  const [state, setState] = useState(syncState)
  useEffect(() => subscribeToSync(setState), [])
  return state
}

/** Re-renders on an interval so "hace 2 h 15 min" stays true. */
export function useNow(intervalMs = 30_000): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), intervalMs)
    return () => window.clearInterval(timer)
  }, [intervalMs])
  return now
}

export function useOnline(): boolean {
  const [online, setOnline] = useState(() => navigator.onLine)
  useEffect(() => {
    const on = (): void => setOnline(true)
    const off = (): void => setOnline(false)
    window.addEventListener('online', on)
    window.addEventListener('offline', off)
    return () => {
      window.removeEventListener('online', on)
      window.removeEventListener('offline', off)
    }
  }, [])
  return online
}
