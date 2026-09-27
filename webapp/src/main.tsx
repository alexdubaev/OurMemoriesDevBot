import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

import App from './App'
import { AuthProvider } from './features/auth'
import { createHostBridge } from './platform/telegram'
import './production.css'

const hostBridge = createHostBridge(window, {
  maxBotUsername: import.meta.env.VITE_MAX_BOT_USERNAME,
})
hostBridge.ready()

const root = createRoot(document.getElementById('root')!)
const queryClient = new QueryClient()

async function renderApplication() {
  if (import.meta.env.DEV && window.location.pathname === '/__fixtures/family-hub') {
    const { FamilyHubFixturePage } = await import('./dev/FamilyHubFixturePage')
    root.render(<StrictMode><FamilyHubFixturePage /></StrictMode>)
    return
  }
  if (import.meta.env.DEV && window.location.pathname === '/__fixtures/design-system') {
    const { DesignSystemFixturePage } = await import('./dev/DesignSystemFixturePage')
    root.render(
      <StrictMode>
        <DesignSystemFixturePage />
      </StrictMode>,
    )
    return
  }

  root.render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <App hostBridge={hostBridge} />
        </AuthProvider>
      </QueryClientProvider>
    </StrictMode>,
  )
}

void renderApplication()
