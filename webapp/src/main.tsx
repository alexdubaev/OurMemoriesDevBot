import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

import App from './App'
import { AuthProvider, PrivateCacheGate } from './features/auth'
import { BootPreloader, StartupBoundary } from './features/app'
import { installAppZoomPrevention } from './platform/app-zoom'
import { createHostBridge } from './platform/telegram'
import { installPwaPromptListeners } from './platform/pwa-install'
import './production.css'

installAppZoomPrevention(document)
installPwaPromptListeners(window)

const root = createRoot(document.getElementById('root')!)
const queryClient = new QueryClient()

async function renderApplication() {
  if (window.__MEMOLY_STARTUP__?.hostReady && !(await window.__MEMOLY_STARTUP__.hostReady)) return
  if (window.__MEMOLY_STARTUP__ && !window.__MEMOLY_STARTUP__.canMount()) return
  const hostBridge = createHostBridge(window, {
    maxBotUsername: import.meta.env.VITE_MAX_BOT_USERNAME,
  })
  hostBridge.ready()
  if (import.meta.env.DEV && window.location.pathname === '/__fixtures/family-max-channel') {
    const { FamilyMaxChannelFixturePage } = await import('./dev/FamilyMaxChannelFixturePage')
    if (window.__MEMOLY_STARTUP__ && !window.__MEMOLY_STARTUP__.canMount()) return
    root.render(<StrictMode><StartupBoundary><FamilyMaxChannelFixturePage /></StartupBoundary></StrictMode>)
    return
  }
  if (import.meta.env.DEV && window.location.pathname === '/__fixtures/family-hub') {
    const { FamilyHubFixturePage } = await import('./dev/FamilyHubFixturePage')
    if (window.__MEMOLY_STARTUP__ && !window.__MEMOLY_STARTUP__.canMount()) return
    root.render(<StrictMode><StartupBoundary><FamilyHubFixturePage /></StartupBoundary></StrictMode>)
    return
  }
  if (import.meta.env.DEV && window.location.pathname === '/__fixtures/design-system') {
    const { DesignSystemFixturePage } = await import('./dev/DesignSystemFixturePage')
    if (window.__MEMOLY_STARTUP__ && !window.__MEMOLY_STARTUP__.canMount()) return
    root.render(
      <StrictMode>
        <StartupBoundary><DesignSystemFixturePage /></StartupBoundary>
      </StrictMode>,
    )
    return
  }

  root.render(
    <StrictMode>
      <StartupBoundary>
        <QueryClientProvider client={queryClient}>
          <AuthProvider>
            <PrivateCacheGate fallback={<BootPreloader />}>
              <App hostBridge={hostBridge} />
            </PrivateCacheGate>
          </AuthProvider>
        </QueryClientProvider>
      </StartupBoundary>
    </StrictMode>,
  )
}

void renderApplication().catch(() => {
  console.error('[memoLy] startup_failed')
  window.__MEMOLY_STARTUP__?.fail()
})
