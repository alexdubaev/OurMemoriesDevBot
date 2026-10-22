export {}

declare global {
  interface Window {
    __MEMOLY_DIAGNOSTICS__?: {
      record: (kind: string, phase?: string, counts?: Record<string, number>) => void
      recordReactError?: (error: unknown, componentStack?: string) => void
      updateState: (area: 'auth' | 'cache', value: Record<string, boolean>) => void
      report: () => string
    }
  }
}
