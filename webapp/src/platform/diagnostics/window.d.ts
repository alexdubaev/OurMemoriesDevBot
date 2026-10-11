export {}

declare global {
  interface Window {
    __MEMOLY_DIAGNOSTICS__?: {
      record: (kind: string, phase?: string, counts?: Record<string, number>) => void
      report: () => string
    }
  }
}
