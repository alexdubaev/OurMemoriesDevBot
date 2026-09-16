export type BootstrapDiagnosticHostKind = 'max' | 'telegram' | 'browser' | 'unknown'
export type BootstrapDiagnosticErrorName =
  | 'Error'
  | 'EvalError'
  | 'RangeError'
  | 'ReferenceError'
  | 'SyntaxError'
  | 'TypeError'
  | 'URIError'
export type BootstrapDiagnosticErrorStage = 'index-inline' | 'main-bootstrap'

export type BootstrapDiagnosticRecorder = {
  emit(path: unknown): boolean
  markIndexInlineStart(): boolean
  markMainModuleEvaluated(): boolean
  markHostDetected(hostKind: unknown, webAppExists: unknown, initDataPresent: unknown): boolean
  markAuthStarted(): boolean
  markUncaughtError(errorName: unknown, stage: unknown): boolean
}

export type BootstrapDiagnosticFetch = (input: string, init: RequestInit) => Promise<unknown> | unknown

const allowedHostKinds = ['max', 'telegram', 'browser', 'unknown'] as const
const allowedErrorNames = ['Error', 'EvalError', 'RangeError', 'ReferenceError', 'SyntaxError', 'TypeError', 'URIError'] as const
const allowedErrorStages = ['index-inline', 'main-bootstrap'] as const
const allowedHostDetectedPaths = new Set(allowedHostKinds.flatMap((hostKind) => [
  `/__diag/host-detected/${hostKind}/webapp-false/initdata-false`,
  `/__diag/host-detected/${hostKind}/webapp-false/initdata-true`,
  `/__diag/host-detected/${hostKind}/webapp-true/initdata-false`,
  `/__diag/host-detected/${hostKind}/webapp-true/initdata-true`,
]))
const allowedUncaughtErrorPaths = new Set(allowedErrorNames.flatMap((errorName) => [
  `/__diag/uncaught-error/${errorName}/index-inline`,
  `/__diag/uncaught-error/${errorName}/main-bootstrap`,
]))
const allowedPaths = new Set([
  '/__diag/index-inline-start',
  '/__diag/main-module-evaluated',
  '/__diag/auth-started',
  ...allowedHostDetectedPaths,
  ...allowedUncaughtErrorPaths,
])

export function createBootstrapDiagnosticRecorder(
  send: BootstrapDiagnosticFetch = (input, init) => globalThis.fetch(input, init),
): BootstrapDiagnosticRecorder {
  const emit = (path: unknown) => {
    if (typeof path !== 'string' || !allowedPaths.has(path)) return false
    try {
      void Promise.resolve(send(path, {
        method: 'POST',
        credentials: 'omit',
        keepalive: true,
        body: null,
      })).catch(() => undefined)
    } catch {
      // Diagnostics must never affect application bootstrap.
    }
    return true
  }

  const markHostDetected = (hostKind: unknown, webAppExists: unknown, initDataPresent: unknown) => {
    if (typeof hostKind !== 'string' || !allowedHostKinds.includes(hostKind as BootstrapDiagnosticHostKind)) return false
    if (typeof webAppExists !== 'boolean' || typeof initDataPresent !== 'boolean') return false
    const path = `/__diag/host-detected/${hostKind}/webapp-${String(webAppExists)}/initdata-${String(initDataPresent)}`
    return allowedHostDetectedPaths.has(path) && emit(path)
  }

  const markUncaughtError = (errorName: unknown, stage: unknown) => {
    if (typeof errorName !== 'string' || !allowedErrorNames.includes(errorName as BootstrapDiagnosticErrorName)) return false
    if (typeof stage !== 'string' || !allowedErrorStages.includes(stage as BootstrapDiagnosticErrorStage)) return false
    const path = `/__diag/uncaught-error/${errorName}/${stage}`
    return allowedUncaughtErrorPaths.has(path) && emit(path)
  }

  return {
    emit,
    markIndexInlineStart: () => emit('/__diag/index-inline-start'),
    markMainModuleEvaluated: () => emit('/__diag/main-module-evaluated'),
    markHostDetected,
    markAuthStarted: () => emit('/__diag/auth-started'),
    markUncaughtError,
  }
}

export function markMainModuleEvaluated() {
  return getInstalledRecorder()?.markMainModuleEvaluated() ?? false
}

export function markHostDetected(hostKind: BootstrapDiagnosticHostKind, webAppExists: boolean, initDataPresent: boolean) {
  return getInstalledRecorder()?.markHostDetected(hostKind, webAppExists, initDataPresent) ?? false
}

export function markAuthStarted() {
  return getInstalledRecorder()?.markAuthStarted() ?? false
}

type InstalledRecorderWindow = Window & {
  __memoLyBootstrapDiagnostic?: BootstrapDiagnosticRecorder
}

function getInstalledRecorder() {
  if (typeof window === 'undefined') return null
  return (window as InstalledRecorderWindow).__memoLyBootstrapDiagnostic ?? null
}
