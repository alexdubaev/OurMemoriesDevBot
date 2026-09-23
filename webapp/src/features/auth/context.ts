import type {
  LoginRequest,
  PasswordResetConfirmRequest,
  PasswordResetRequest,
  RegisterRequest,
  UserDto,
  BrowserLinkStartResponse,
  BrowserLinkStatusResponse,
  MeResponse,
} from '@web-app-demo/contracts'
import { createContext } from 'react'
import type { AuthenticatedTransport } from '@/platform/api'

export type HostAuthProvider = 'max' | 'telegram'
export type ExternalIdentityProvider = NonNullable<MeResponse['externalIdentityProvider']>

export type HostAuthAttemptOptions = {
  signal?: AbortSignal
  isCurrent?: () => boolean
}

export type AuthContextValue = {
  user: UserDto | null
  externalIdentityProvider: MeResponse['externalIdentityProvider']
  /**
   * True while the session is still unknown: the cookie refresh has not answered yet, or it
   * restored an access token whose `/api/v1/auth/me` load is still pending. Guards render the
   * loading state while this is set; `user === null` means signed out only once it is false.
   */
  isBootstrapping: boolean
  isAuthenticated: boolean
  sessionError: Error | null
  retrySession: () => Promise<void>
  transport: AuthenticatedTransport
  authenticateHost: (provider: HostAuthProvider, initData: string, options?: HostAuthAttemptOptions) => Promise<void>
  authenticateTelegram: (initData: string) => Promise<void>
  authenticateMax: (initData: string) => Promise<void>
  startBrowserLink: () => Promise<BrowserLinkStartResponse>
  browserLinkStatus: (id: string) => Promise<BrowserLinkStatusResponse>
  approveBrowserLink: (id: string, initData: string) => Promise<void>
  redeemBrowserLink: (id: string) => Promise<void>
  register: (input: RegisterRequest) => Promise<void>
  login: (input: LoginRequest) => Promise<void>
  logout: () => Promise<void>
  requestPasswordReset: (input: PasswordResetRequest) => Promise<void>
  confirmPasswordReset: (input: PasswordResetConfirmRequest) => Promise<void>
}

export const AuthContext = createContext<AuthContextValue | null>(null)
