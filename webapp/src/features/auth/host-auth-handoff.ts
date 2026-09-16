import type { HostAuthProvider } from './context'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { AuthContextValue, HostAuthAttemptOptions } from './context'
import { markAuthStarted } from '../../platform/bootstrap-diagnostic'

export type HostAuthHandoffState = {
  provider: HostAuthProvider
  hasInitData: boolean
  hasStartedAuth: boolean
  hasPreviousAuthAttempt?: boolean
  isAuthenticated: boolean
  isAuthBootstrapping: boolean
  isAuthPending: boolean
  isHostAvailable: boolean
}

export function shouldStartHostAuth(state: Omit<HostAuthHandoffState, 'isAuthPending'>) {
  return state.isHostAvailable
    && state.hasInitData
    && !state.isAuthBootstrapping
    && (!state.isAuthenticated || state.hasPreviousAuthAttempt === true)
    && !state.hasStartedAuth
}

export function shouldKeepHostAuthPreloader(state: HostAuthHandoffState) {
  return state.isAuthPending || shouldStartHostAuth(state)
}

export function hostAuthAttemptKey(provider: HostAuthProvider | null, initData: string | null) {
  return provider && initData ? `${provider}:${initData}` : null
}

type HostAuthHandoffOptions = {
  auth: Pick<AuthContextValue, 'authenticateHost' | 'isAuthenticated' | 'isBootstrapping'> | null
  provider: HostAuthProvider | null
  initData: string | null
  isHostAvailable: boolean
}

export function useHostAuthHandoff({ auth, provider, initData, isHostAvailable }: HostAuthHandoffOptions) {
  const attemptedKey = useRef<string | null>(null)
  const activeAttempt = useRef<{ key: string; controller: AbortController } | null>(null)
  const committedAttemptKey = useRef<string | null>(null)
  const [hostAuthError, setHostAuthError] = useState<Error | null>(null)
  const [hasStartedHostAuth, setHasStartedHostAuth] = useState(false)
  const [startedHostAuthKey, setStartedHostAuthKey] = useState<string | null>(null)
  const [isHostAuthPending, setIsHostAuthPending] = useState(false)
  const authAttemptKey = hostAuthAttemptKey(provider, initData)
  const hostAuthState = useMemo(() => auth && provider ? {
    provider,
    hasStartedAuth: startedHostAuthKey === authAttemptKey,
    hasPreviousAuthAttempt: hasStartedHostAuth,
    hasInitData: Boolean(initData),
    isAuthenticated: auth.isAuthenticated,
    isAuthBootstrapping: auth.isBootstrapping,
    isAuthPending: isHostAuthPending,
    isHostAvailable,
  } : null, [auth, authAttemptKey, hasStartedHostAuth, initData, isHostAuthPending, isHostAvailable, provider, startedHostAuthKey])

  const invalidateAttempt = () => {
    activeAttempt.current?.controller.abort()
    activeAttempt.current = null
    attemptedKey.current = null
  }

  useLayoutEffect(() => {
    if (committedAttemptKey.current !== authAttemptKey) {
      committedAttemptKey.current = authAttemptKey
      invalidateAttempt()
      setHostAuthError(null)
      setIsHostAuthPending(false)
    }

    return invalidateAttempt
  }, [authAttemptKey])

  useEffect(() => {
    if (!auth || !provider || !initData || !hostAuthState || !shouldStartHostAuth(hostAuthState)) return
    if (!authAttemptKey || attemptedKey.current === authAttemptKey) return

    const key = authAttemptKey
    const controller = new AbortController()
    const attempt = { key, controller }
    attemptedKey.current = key
    activeAttempt.current = attempt
    setHostAuthError(null)

    queueMicrotask(() => {
      if (activeAttempt.current !== attempt || controller.signal.aborted) return
      setStartedHostAuthKey(key)
      setHasStartedHostAuth(true)
      setIsHostAuthPending(true)
      const options: HostAuthAttemptOptions = {
        signal: controller.signal,
        isCurrent: () => activeAttempt.current === attempt && !controller.signal.aborted,
      }
      if (provider === 'max') markAuthStarted()
      void auth.authenticateHost(provider, initData, options)
        .catch((error: unknown) => {
          if (activeAttempt.current !== attempt) return
          setHostAuthError(error instanceof Error ? error : new Error('Не удалось войти.'))
        })
        .finally(() => {
          if (activeAttempt.current !== attempt) return
          activeAttempt.current = null
          setIsHostAuthPending(false)
        })
    })
  }, [auth, authAttemptKey, hostAuthState, initData, provider])

  const resetHostAuth = useCallback(() => {
    invalidateAttempt()
    attemptedKey.current = null
    setHostAuthError(null)
    setHasStartedHostAuth(false)
    setStartedHostAuthKey(null)
    setIsHostAuthPending(false)
  }, [])

  return { authAttemptKey, hostAuthError, hasStartedHostAuth, isHostAuthPending, resetHostAuth, startedHostAuthKey }
}
