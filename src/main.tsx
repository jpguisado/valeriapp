import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { registerSW } from 'virtual:pwa-register'
import { App } from './App'
import { Toaster } from './components/Toaster'
import { RouterProvider } from './lib/router'
import { SessionProvider } from './lib/session'
import './styles/global.css'

const updateSW = registerSW({
  onNeedRefresh() {
    // A baby log must never be interrupted by a modal; refresh on next launch.
    console.info('[pwa] hay una versión nueva, se aplicará al reabrir')
  },
})
void updateSW

createRoot(document.getElementById('root') as HTMLElement).render(
  <StrictMode>
    <RouterProvider>
      <SessionProvider>
        <App />
        <Toaster />
      </SessionProvider>
    </RouterProvider>
  </StrictMode>,
)
