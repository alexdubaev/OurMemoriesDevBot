import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import App from './App'
import { createTelegramHostBridge } from './platform/telegram'
import './production.css'

const hostBridge = createTelegramHostBridge(window)
hostBridge.ready()

const root = createRoot(document.getElementById('root')!)

async function renderApplication() {
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
      <App hostBridge={hostBridge} />
    </StrictMode>,
  )
}

void renderApplication()
