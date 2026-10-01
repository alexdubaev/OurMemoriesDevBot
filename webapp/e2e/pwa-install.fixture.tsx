import { createRoot } from 'react-dom/client'
import { ThemeProvider } from '../src/features/theme'
import { PwaInstallPrompt } from '../src/features/pwa-install'
import type { HostBridge } from '../src/platform/host-bridge'
import '../src/production.css'

const params = new URLSearchParams(window.location.search)
const platform = params.get('platform') ?? 'android'
const kind = params.get('kind') === 'max' ? 'max' : 'browser'
const hostBridge = {
  kind,
  metadata: () => ({ platform }),
  openExternalUrl: (url: string) => { document.body.dataset.opened = url; return true },
} as unknown as HostBridge

createRoot(document.getElementById('fixture')!).render(<ThemeProvider><PwaInstallPrompt familyId="3d45c33c-8b55-4aac-b4af-123456789abc" hostBridge={hostBridge} /></ThemeProvider>)
