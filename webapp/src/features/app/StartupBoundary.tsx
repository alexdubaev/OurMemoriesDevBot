import { Component, useLayoutEffect, type PropsWithChildren } from 'react'
import { Button } from '@/components/ui/button'
import { Typography } from '@/components/typography'

declare global {
  interface Window {
    __MEMOLY_STARTUP__?: {
      hostReady?: Promise<boolean>
      fail: () => void
      canMount: () => boolean
      mounted: () => void
    }
  }
}

export function StartupBoundary({ children }: PropsWithChildren) {
  useLayoutEffect(() => window.__MEMOLY_STARTUP__?.mounted(), [])
  return <StartupErrorBoundary>{children}</StartupErrorBoundary>
}

class StartupErrorBoundary extends Component<PropsWithChildren, { failed: boolean }> {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  render() {
    if (!this.state.failed) return this.props.children
    return <main className="mx-auto grid min-h-screen min-h-dvh max-w-md content-center gap-5 px-7 py-10 text-center" role="alert">
      <Typography variant="memoryScreen">Не удалось открыть приложение</Typography>
      <Typography tone="muted" variant="memoryBody">Проверьте соединение и попробуйте ещё раз.</Typography>
      <Button className="min-h-12 w-full" onClick={() => window.location.reload()} type="button"><Typography variant="memoryButton">Повторить</Typography></Button>
    </main>
  }
}
