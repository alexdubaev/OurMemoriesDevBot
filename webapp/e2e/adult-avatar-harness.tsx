import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query'
import { createRoot } from 'react-dom/client'
import { AuthContext } from '../src/features/auth'
import type { AuthContextValue } from '../src/features/auth'
import { CurrentUserAvatarControls } from '../src/features/avatar/CurrentUserAvatarControls'
import type { AuthenticatedTransport } from '../src/platform/api'
import { activatePrivateCacheIdentity } from '../src/platform/persistence/private-cache'
import { sessionQueryKeys } from '../src/features/auth'
import '../src/index.css'

const userId = '11111111-1111-4111-8111-111111111111'
const avatarId = '22222222-2222-4222-8222-222222222222'
let avatar: Record<string, unknown> | null = new URLSearchParams(location.search).has('existing') ? { id: avatarId, avatarCrop: { x: 0.2, y: 0.1, width: 0.6, height: 0.6 }, contentType: 'image/png', byteSize: 80, updatedAt: '2026-10-02T10:00:00.000Z', downloadUrl: 'http://local.test/original' } : null
const calls: Array<{ path: string; options: unknown }> = []
Object.assign(window, { __adultAvatarCalls: calls })
const feedInvalidationReleases: Array<() => void> = []
Object.assign(window, { __releaseAdultFeedInvalidation: () => feedInvalidationReleases.splice(0).forEach((release) => release()) })
let finalizeFailures = 0
const canvas = document.createElement('canvas')
canvas.width = 128; canvas.height = 96
const context = canvas.getContext('2d')!
context.fillStyle = '#8ac'; context.fillRect(0, 0, 128, 96)
context.fillStyle = '#d87'; context.fillRect(20, 10, 42, 64)
const pngBytes = Uint8Array.from(atob(canvas.toDataURL('image/png').split(',')[1]!), (value) => value.charCodeAt(0))
Object.assign(window, { __adultPng: canvas.toDataURL('image/png') })
if (avatar) avatar.byteSize = pngBytes.byteLength
const transport: AuthenticatedTransport = {
  async request(path, _schema, options) {
    calls.push({ path, options })
    if (path === '/api/uploads/avatar' && options?.method === 'POST') return { upload: { uploadId: '33333333-3333-4333-8333-333333333333', method: 'PUT', url: `${location.origin}/signed-avatar`, headers: { 'Content-Type': 'image/png', 'If-None-Match': '*' }, contentLength: pngBytes.byteLength, expiresAt: new Date(Date.now() + 60_000).toISOString() }, reservationExpiresAt: new Date(Date.now() + 60_000).toISOString() } as never
    if (path.endsWith('/finalize')) {
      if (new URLSearchParams(location.search).has('retry') && finalizeFailures++ === 0) throw new Error('Synthetic finalize failure')
      avatar = { id: '44444444-4444-4444-8444-444444444444', avatarCrop: (options?.body as { avatarCrop?: unknown } | undefined)?.avatarCrop ?? null, contentType: 'image/png', byteSize: pngBytes.byteLength, updatedAt: '2026-10-03T10:00:00.000Z', downloadUrl: 'http://local.test/original' }; return { avatar } as never
    }
    if (path === '/api/uploads/avatar/crop') { avatar = { ...avatar!, avatarCrop: (options?.body as { avatarCrop: unknown }).avatarCrop, updatedAt: '2026-10-03T10:00:00.000Z' }; return { avatar } as never }
    if (path === '/api/uploads/avatar' && options?.method === 'DELETE') { avatar = null; return { avatar: null } as never }
    return { avatar } as never
  },
  async raw() { return new Response(new Blob([pngBytes], { type: 'image/png' })) },
}
const user = { id: userId, displayName: 'Adult Test', email: 'adult@example.test', role: 'user' } as never
const auth = { user, externalIdentityProvider: null, isBootstrapping: false, isAuthenticated: true, sessionError: null, retrySession: async () => undefined, transport, updateTheme: async () => undefined, authenticateHost: async () => undefined, authenticateTelegram: async () => undefined, authenticateMax: async () => undefined, startBrowserLink: async () => ({}), browserLinkStatus: async () => ({}), approveBrowserLink: async () => undefined, redeemBrowserLink: async () => undefined, register: async () => undefined, login: async () => undefined, logout: async () => undefined, requestPasswordReset: async () => undefined, confirmPasswordReset: async () => undefined } as AuthContextValue
const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
activatePrivateCacheIdentity(userId)
queryClient.setQueryData(['session', 'auth', 'me'], { user })

export function DelayedFeedInvalidation() {
  const enabled = new URLSearchParams(location.search).has('slow-invalidation')
  useQuery({
    queryKey: [...sessionQueryKeys.all, 'feed', 'avatar-test'],
    enabled,
    queryFn: () => new Promise<null>((resolve) => { feedInvalidationReleases.push(() => resolve(null)) }),
  })
  return null
}

createRoot(document.getElementById('root')!).render(<AuthContext.Provider value={auth}><QueryClientProvider client={queryClient}><DelayedFeedInvalidation /><CurrentUserAvatarControls compact displayName="Adult Test" /></QueryClientProvider></AuthContext.Provider>)
