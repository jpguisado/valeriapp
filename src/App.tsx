import { Link, useRouter } from '@/lib/router'
import { useSession } from '@/lib/session'
import { CalendarDays, ChartColumn, House, List, Settings as SettingsIcon } from '@/components/icons'
import { Calendar } from '@/screens/Calendar'
import { History } from '@/screens/History'
import { Home } from '@/screens/Home'
import { Login } from '@/screens/Login'
import { Register } from '@/screens/Register'
import { Settings } from '@/screens/Settings'
import { Stats } from '@/screens/Stats'

const TABS = [
  { path: '/', label: 'Hoy', Glyph: House },
  { path: '/historial', label: 'Historial', Glyph: List },
  { path: '/estadisticas', label: 'Datos', Glyph: ChartColumn },
  { path: '/calendario', label: 'Mes', Glyph: CalendarDays },
  { path: '/ajustes', label: 'Ajustes', Glyph: SettingsIcon },
]

export function App() {
  const { path } = useRouter()
  const { user, loading } = useSession()

  if (loading) {
    return (
      <div className="page">
        <div className="skeleton" />
        <div className="skeleton" />
        <div className="skeleton" />
      </div>
    )
  }

  if (!user) {
    return path === '/registro' ? <Register /> : <Login />
  }

  return (
    <div className="app">
      {renderScreen(path)}

      <nav className="tabbar" aria-label="Navegación principal">
        {TABS.map((tab) => {
          const active = tab.path === '/' ? path === '/' : path.startsWith(tab.path)
          return (
            <Link key={tab.path} to={tab.path} aria-current={active ? 'page' : undefined}>
              <tab.Glyph size={21} strokeWidth={active ? 2.3 : 1.8} aria-hidden="true" />
              {tab.label}
            </Link>
          )
        })}
      </nav>
    </div>
  )
}

function renderScreen(path: string) {
  if (path.startsWith('/ajustes')) return <Settings />
  switch (path) {
    case '/historial':
      return <History />
    case '/estadisticas':
      return <Stats />
    case '/calendario':
      return <Calendar />
    default:
      return <Home />
  }
}
