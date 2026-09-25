const diagnosticParameter = 'memolyPrivateMediaDiagnostic'
export const privateMediaDiagnosticHeader = 'X-Memoly-Private-Media-Diagnostic'

export function isPrivateMediaDiagnosticEnabled() {
  return typeof window !== 'undefined' && new URLSearchParams(window.location.search).get(diagnosticParameter) === '1'
}

export function privateMediaDiagnosticHeaders(): HeadersInit | undefined {
  return isPrivateMediaDiagnosticEnabled() ? { [privateMediaDiagnosticHeader]: '1' } : undefined
}

export function reportPrivateMediaDiagnostic(event: string, details: Record<string, string | number | boolean | null> = {}) {
  if (!isPrivateMediaDiagnosticEnabled()) return

  const controllerPath = navigator.serviceWorker?.controller
    ? new URL(navigator.serviceWorker.controller.scriptURL).pathname
    : null
  console.info('memoly-private-media-diagnostic', { event, controllerPath, ...details })
}
