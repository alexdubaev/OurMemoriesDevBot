import { useQueryClient } from '@tanstack/react-query'
import type {
  LoginRequest,
  PasswordResetConfirmRequest,
  PasswordResetRequest,
  RegisterRequest,
} from '@web-app-demo/contracts'
import {
  type PropsWithChildren,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'

import { AuthApi } from './api'
import {
  clearAuthenticatedSession,
  confirmPasswordResetAndClearSession,
  authQueryKeys,
  useCurrentUserQuery,
  useLoginMutation,
  useLogoutMutation,
  useRegisterMutation,
} from './queries'
import { AuthContext, type AuthContextValue, type HostAuthAttemptOptions, type HostAuthProvider } from './context'
import { bootstrapAuthSession } from './bootstrap'
import { subscribeToBrowserSessionChanges } from './session-coordinator'
import { syncPrivateMediaAccessToken } from '@/platform/media/private-media-access'
import { updateProfileResponseSchema, type MemolyTheme } from '@web-app-demo/contracts'

export function AuthProvider({ children }: PropsWithChildren) {
  const queryClient = useQueryClient()
  const [accessToken, setAccessTokenState] = useState<string | null>(null)
  const [isRestoringSession, setIsRestoringSession] = useState(true)
  const [bootstrapError, setBootstrapError] = useState<Error | null>(null)
  const [bootstrapAttempt, setBootstrapAttempt] = useState(0)
  const bootstrapGeneration = useRef(0)

  useEffect(() => {
    syncPrivateMediaAccessToken(null, null)
  }, [])

  const setAccessToken = useCallback(
    (nextAccessToken: string | null) => {
      setAccessTokenState(nextAccessToken)
      syncPrivateMediaAccessToken(nextAccessToken, null)
    },
    [],
  )
  const clearLocalSession = useCallback(async () => {
    await clearAuthenticatedSession(queryClient, setAccessToken)
  }, [queryClient, setAccessToken])
  const handleAuthExpired = useCallback(async () => {
    await clearLocalSession()
  }, [clearLocalSession])

  useEffect(
    () =>
      subscribeToBrowserSessionChanges((sessionEvent) => {
        const generation = ++bootstrapGeneration.current
        const shouldBootstrap = sessionEvent.state === 'authenticated'
        setBootstrapError(null)
        setIsRestoringSession(shouldBootstrap)
        void clearLocalSession()
          .catch(() => undefined)
          .then(() => {
            if (bootstrapGeneration.current !== generation) return
            if (shouldBootstrap) {
              setBootstrapAttempt((attempt) => attempt + 1)
            } else {
              setIsRestoringSession(false)
            }
          })
      }),
    [clearLocalSession],
  )

  const api = useMemo(
    () =>
      new AuthApi({
        getAccessToken: () => accessToken,
        setAccessToken,
        onAuthExpired: handleAuthExpired,
      }),
    [accessToken, handleAuthExpired, setAccessToken],
  )

  useEffect(() => {
    let isMounted = true
    const generation = ++bootstrapGeneration.current
    const shouldApply = () => isMounted && bootstrapGeneration.current === generation
    const bootstrapApi = new AuthApi({
      getAccessToken: () => null,
      setAccessToken,
      onAuthExpired: handleAuthExpired,
    })

    bootstrapAuthSession({
      api: bootstrapApi,
      shouldApply,
      setAccessToken,
    })
      .catch((error: unknown) => {
        if (shouldApply()) {
          setBootstrapError(toError(error))
        }
      })
      .finally(() => {
        if (shouldApply()) {
          setIsRestoringSession(false)
        }
      })

    return () => {
      isMounted = false
    }
  }, [bootstrapAttempt, handleAuthExpired, setAccessToken])

  const meQuery = useCurrentUserQuery({
    api,
    enabled: !isRestoringSession && Boolean(accessToken),
  })

  useEffect(() => {
    syncPrivateMediaAccessToken(accessToken, meQuery.data?.user.id ?? null)
  }, [accessToken, meQuery.data?.user.id])
  const { mutateAsync: registerAsync } = useRegisterMutation({ api, setAccessToken })
  const { mutateAsync: loginAsync } = useLoginMutation({ api, setAccessToken })
  const { mutateAsync: logoutAsync } = useLogoutMutation({ api, setAccessToken })

  const register = useCallback(
    async (input: RegisterRequest) => {
      await registerAsync(input)
    },
    [registerAsync],
  )

  const login = useCallback(
    async (input: LoginRequest) => {
      await loginAsync(input)
    },
    [loginAsync],
  )

  const logout = useCallback(async () => {
    await logoutAsync()
  }, [logoutAsync])

  const updateTheme = useCallback(async (theme: MemolyTheme) => {
    const response = await api.requestAuthenticated('/api/users/me', updateProfileResponseSchema, {
      method: 'PATCH',
      body: { theme },
    })
    queryClient.setQueryData(authQueryKeys.me(), (current) => current
      ? { ...current, user: response.user }
      : current)
  }, [api, queryClient])

  const authenticateHost = useCallback(async (provider: HostAuthProvider, initData: string, options: HostAuthAttemptOptions = {}) => {
    const result = await (provider === 'max'
      ? api.authenticateMax(initData, options)
      : api.authenticateTelegram(initData, options))
    options.signal?.throwIfAborted()
    if (options.isCurrent?.() === false) return
    setBootstrapError(null)
    setAccessToken(result.data.accessToken)
    queryClient.setQueryData(authQueryKeys.me(), {
      user: result.data.user,
      externalIdentityProvider: provider,
    })
  }, [api, queryClient, setAccessToken])

  const authenticateTelegram = useCallback((initData: string) => authenticateHost('telegram', initData), [authenticateHost])
  const authenticateMax = useCallback((initData: string) => authenticateHost('max', initData), [authenticateHost])

  const startBrowserLink = useCallback(() => api.startBrowserLink(), [api])
  const browserLinkStatus = useCallback((id: string) => api.browserLinkStatus(id), [api])
  const approveBrowserLink = useCallback((id: string, initData: string) => api.approveBrowserLink(id, initData).then(() => undefined), [api])
  const redeemBrowserLink = useCallback(async (id: string) => {
    const data = await api.redeemBrowserLink(id)
    queryClient.setQueryData(authQueryKeys.me(), { user: data.user, externalIdentityProvider: 'max' })
  }, [api, queryClient])

  const requestPasswordReset = useCallback(
    async (input: PasswordResetRequest) => {
      await api.requestPasswordReset(input)
    },
    [api],
  )

  const confirmPasswordReset = useCallback(
    async (input: PasswordResetConfirmRequest) => {
      await confirmPasswordResetAndClearSession({
        api,
        input,
        queryClient,
        setAccessToken,
      })
    },
    [api, queryClient, setAccessToken],
  )

  const retrySession = useCallback(async () => {
    if (accessToken) {
      await meQuery.refetch()
      return
    }

    setIsRestoringSession(true)
    setBootstrapError(null)
    setBootstrapAttempt((attempt) => attempt + 1)
  }, [accessToken, meQuery])

  // The session is unknown until the cookie refresh has answered and, when it restored an access
  // token, until the first `/api/v1/auth/me` load has settled. Reporting "signed out" in between would
  // send a signed-in user through the login redirect on every reload.
  const isBootstrapping = isRestoringSession || (Boolean(accessToken) && meQuery.isPending)
  const sessionError = bootstrapError ?? (accessToken ? toOptionalError(meQuery.error) : null)
  const transport = useMemo(
    () => ({
      request: api.requestAuthenticated.bind(api),
      raw: api.rawAuthenticated.bind(api),
    }),
    [api],
  )

  const value = useMemo<AuthContextValue>(
    () => ({
      user: meQuery.data?.user ?? null,
      externalIdentityProvider: meQuery.data?.externalIdentityProvider,
      isBootstrapping,
      isAuthenticated: Boolean(meQuery.data?.user),
      sessionError,
      retrySession,
      transport,
      updateTheme,
      authenticateHost,
      authenticateTelegram,
      authenticateMax,
      startBrowserLink,
      browserLinkStatus,
      approveBrowserLink,
      redeemBrowserLink,
      register,
      login,
      logout,
      requestPasswordReset,
      confirmPasswordReset,
    }),
    [approveBrowserLink, authenticateHost, authenticateMax, authenticateTelegram, browserLinkStatus, confirmPasswordReset, isBootstrapping, login, logout, meQuery.data?.externalIdentityProvider, meQuery.data?.user, redeemBrowserLink, register, requestPasswordReset, retrySession, sessionError, startBrowserLink, transport, updateTheme],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

function toOptionalError(error: unknown) {
  return error === null || error === undefined ? null : toError(error)
}

function toError(error: unknown) {
  return error instanceof Error ? error : new Error('Unknown session error')
}
