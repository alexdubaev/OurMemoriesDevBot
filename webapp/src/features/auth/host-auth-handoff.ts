import type { HostAuthProvider } from './context'

export type HostAuthHandoffState = {
  provider: HostAuthProvider
  hasInitData: boolean
  hasStartedAuth: boolean
  isAuthenticated: boolean
  isAuthBootstrapping: boolean
  isAuthPending: boolean
  isHostAvailable: boolean
}

export function shouldStartHostAuth(state: Omit<HostAuthHandoffState, 'isAuthPending'>) {
  return state.isHostAvailable
    && state.hasInitData
    && !state.isAuthBootstrapping
    && !state.isAuthenticated
    && !state.hasStartedAuth
}

export function shouldKeepHostAuthPreloader(state: HostAuthHandoffState) {
  return state.isAuthPending || shouldStartHostAuth(state)
}

export function hostAuthAttemptKey(provider: HostAuthProvider | null, initData: string | null) {
  return provider && initData ? `${provider}:${initData}` : null
}
