import { Component, useLayoutEffect, type ErrorInfo, type PropsWithChildren } from 'react'
import { Button } from '@/components/ui/button'
import { Typography } from '@/components/typography'
import { DiagnosticsReportAction } from '@/platform/diagnostics/DiagnosticsReportAction'

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
      <DiagnosticsReportAction />
      <Button className="min-h-12 w-full" onClick={() => window.location.reload()} type="button"><Typography variant="memoryButton">Повторить</Typography></Button>
    </main>
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    try {
      const diagnostics = window.__MEMOLY_DIAGNOSTICS__
      if (diagnostics?.recordReactError) diagnostics.recordReactError(error, info.componentStack ?? undefined)
      else diagnostics?.record('react-boundary', 'mounted')
    } catch {
      try { window.__MEMOLY_DIAGNOSTICS__?.record('react-boundary', 'mounted') } catch { /* diagnostics must not affect the React fallback */ }
    }
  }
}
