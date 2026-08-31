import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'

/**
 * A ~60-line History API router. The app has six screens; pulling in a routing
 * library to describe six strings would be the wrong trade.
 */
interface RouterValue {
  path: string
  navigate: (to: string, options?: { replace?: boolean }) => void
  back: () => void
}

const RouterContext = createContext<RouterValue | null>(null)

export function RouterProvider({ children }: { children: ReactNode }) {
  const [path, setPath] = useState(() => window.location.pathname)

  useEffect(() => {
    const onPop = (): void => setPath(window.location.pathname)
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  const navigate = useCallback((to: string, options?: { replace?: boolean }) => {
    if (to === window.location.pathname) return
    if (options?.replace) window.history.replaceState({}, '', to)
    else window.history.pushState({}, '', to)
    setPath(to)
    window.scrollTo(0, 0)
  }, [])

  const value = useMemo<RouterValue>(
    () => ({ path, navigate, back: () => window.history.back() }),
    [path, navigate],
  )

  return <RouterContext.Provider value={value}>{children}</RouterContext.Provider>
}

export function useRouter(): RouterValue {
  const value = useContext(RouterContext)
  if (!value) throw new Error('useRouter fuera de RouterProvider')
  return value
}

export function Link({
  to,
  children,
  className,
  'aria-current': ariaCurrent,
  ...rest
}: { to: string; children: ReactNode; className?: string } & Omit<
  React.AnchorHTMLAttributes<HTMLAnchorElement>,
  'href'
>) {
  const { path, navigate } = useRouter()
  return (
    <a
      href={to}
      className={className}
      aria-current={ariaCurrent ?? (path === to ? 'page' : undefined)}
      onClick={(event) => {
        if (event.metaKey || event.ctrlKey || event.shiftKey) return
        event.preventDefault()
        navigate(to)
      }}
      {...rest}
    >
      {children}
    </a>
  )
}
