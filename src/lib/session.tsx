import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { TimezoneSetting } from '@shared/time'
import { api } from './api'
import { clearLocalData } from './db'
import { loadSnapshot, startSyncLoop, sync } from './sync'
import type { HouseholdSnapshot } from './db'

export interface SessionUser {
  id: string
  householdId: string
  username: string
  displayName: string
}

interface SessionValue {
  user: SessionUser | null
  household: HouseholdSnapshot['household']
  babies: HouseholdSnapshot['babies']
  members: HouseholdSnapshot['members']
  loading: boolean
  vapidPublicKey: string
  timezone: TimezoneSetting
  activeBabyId: string | null
  setActiveBabyId: (id: string) => void
  refresh: () => Promise<void>
  logout: () => Promise<void>
  signedIn: (user: SessionUser) => Promise<void>
}

const SessionContext = createContext<SessionValue | null>(null)
const ACTIVE_BABY_KEY = 'valeriapp.activeBaby'

export function SessionProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<SessionUser | null>(null)
  const [snapshot, setSnapshot] = useState<HouseholdSnapshot | null>(null)
  const [vapidPublicKey, setVapidPublicKey] = useState('')
  const [loading, setLoading] = useState(true)
  const [activeBabyId, setActiveBaby] = useState<string | null>(
    () => localStorage.getItem(ACTIVE_BABY_KEY),
  )

  const refresh = useCallback(async () => {
    try {
      const me = await api.get<{ user: SessionUser; vapidPublicKey: string }>('/api/auth/me')
      setUser(me.user)
      setVapidPublicKey(me.vapidPublicKey)
      await sync()
    } catch {
      // Offline or logged out: fall back to whatever is cached locally.
    } finally {
      setSnapshot(await loadSnapshot())
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  useEffect(() => {
    if (!user) return
    const stop = startSyncLoop()
    const timer = window.setInterval(async () => setSnapshot(await loadSnapshot()), 5_000)
    return () => {
      stop()
      window.clearInterval(timer)
    }
  }, [user])

  const babies = snapshot?.babies ?? []

  useEffect(() => {
    if (babies.length === 0) return
    if (activeBabyId && babies.some((baby) => baby.id === activeBabyId)) return
    const first = babies[0]
    if (first) {
      setActiveBaby(first.id)
      localStorage.setItem(ACTIVE_BABY_KEY, first.id)
    }
  }, [babies, activeBabyId])

  const value = useMemo<SessionValue>(() => {
    const household = snapshot?.household ?? null
    return {
      user,
      household,
      babies,
      members: snapshot?.members ?? [],
      loading,
      vapidPublicKey,
      timezone: {
        mode: household?.timezoneMode ?? 'device',
        fixed: household?.timezone ?? 'Europe/Madrid',
      },
      activeBabyId,
      setActiveBabyId: (id: string) => {
        setActiveBaby(id)
        localStorage.setItem(ACTIVE_BABY_KEY, id)
      },
      refresh,
      logout: async () => {
        await api.post('/api/auth/logout').catch(() => {})
        await clearLocalData()
        setUser(null)
        setSnapshot(null)
        localStorage.removeItem(ACTIVE_BABY_KEY)
      },
      signedIn: async (nextUser: SessionUser) => {
        setUser(nextUser)
        await sync()
        setSnapshot(await loadSnapshot())
      },
    }
  }, [user, snapshot, loading, vapidPublicKey, activeBabyId, babies, refresh])

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
}

export function useSession(): SessionValue {
  const value = useContext(SessionContext)
  if (!value) throw new Error('useSession fuera de SessionProvider')
  return value
}
