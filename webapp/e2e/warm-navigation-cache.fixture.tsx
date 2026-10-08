import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { PropsWithChildren } from 'react'

import App from '../src/App'
import { AuthContext } from '../src/features/auth/context'
import type { AuthContextValue } from '../src/features/auth/context'
import { createBrowserDevHostBridge } from '../src/platform/telegram/host-bridge'
import type { AuthenticatedTransport, HttpRequestOptions } from '../src/platform/api'
import { activatePrivateCacheIdentity, allowPrivateFamilyCache, persistPrivateQueryCache, persistentUiQueryKey, removePrivateImage, restorePrivateQueryCache } from '../src/platform/persistence/private-cache'
import '../src/production.css'

/* eslint-disable react-refresh/only-export-components -- Isolated Vite browser fixture entry. */

const userId = '11111111-1111-4111-8111-111111111111'
const familyId = '22222222-2222-4222-8222-222222222222'
const childId = '33333333-3333-4333-8333-333333333333'
const childAvatarId = '66666666-6666-4666-8666-666666666666'
const photoId = '55555555-5555-4555-8555-555555555555'
const now = '2026-10-02T00:00:00.000Z'
const family = { id: familyId, name: 'Наша семья', timezone: 'Europe/Moscow', ownerUserId: userId }
const familyResponse = {
  family,
  child: { id: childId, name: 'Миша', birthDate: null, sex: null, avatarMediaId: childAvatarId, avatarCrop: { x: 0, y: 0, width: 1, height: 1 }, version: 1, isComplete: true },
}
const home = {
  version: 1 as const,
  ownFamilyId: familyId,
  ownFamilyStatus: 'active' as const,
  canCreateOwnFamily: false,
  items: [{ familyId, name: 'Наша семья', displaySubtitle: 'Миша', childAvatarMediaId: childAvatarId, isOwner: true, role: 'full' as const, setupStatus: 'ready' as const, capabilities: { canCreateInvite: true, canManageMembers: true, canEditChild: true, canPublishNote: true, canPublishPhoto: true, canPublishVoice: true, canPublishVideo: true, canUploadChildAvatar: true }, unreadCount: null, unreadState: 'not_enabled' as const, membershipEpoch: 1 }],
  nextCursor: null,
}
const members = [{ userId, avatarPath: null, displayName: 'Анна', familyDisplayName: null, role: 'full' as const, isOwner: true, joinedAt: now, version: 1 }]
const queryClient = new QueryClient()
const identityGeneration = activatePrivateCacheIdentity(userId)
allowPrivateFamilyCache(userId, familyId)

function createTransport(generation: number): AuthenticatedTransport {
  const headers = (source?: HeadersInit) => ({ ...Object.fromEntries(new Headers(source)), 'X-Fixture-Transport-Generation': String(generation) })
  const fetchOptions = (options?: HttpRequestOptions): RequestInit => {
    const { body, rawBody, ...init } = options ?? {}
    if (body !== undefined && rawBody !== undefined) throw new TypeError('body and rawBody cannot be used together')
    const requestHeaders = new Headers(headers(options?.headers))
    if (body !== undefined && rawBody === undefined) requestHeaders.set('Content-Type', 'application/json')
    return { ...init, headers: requestHeaders, body: rawBody ?? (body === undefined ? undefined : JSON.stringify(body)) }
  }
  return {
    raw: (path, options) => fetch(path, fetchOptions(options)),
    request: async (path, schema, options) => {
      const response = await fetch(path, fetchOptions(options))
      if (!response.ok) throw new Error(`Synthetic transport returned ${response.status}`)
      const payload: unknown = await response.json()
      try {
        return schema.parse(payload)
      } catch (error) {
        console.error('Warm navigation fixture response failed contract validation', path, error)
        throw error
      }
    },
  }
}

function AuthenticatedFixture({ generation }: PropsWithChildren<{ generation: number }>) {
  const unexpectedAuthAction = async (): Promise<never> => { throw new Error('Unexpected auth action in warm navigation fixture') }
  const auth = {
    user: { id: userId, email: null, displayName: 'Анна', role: 'user' as const, theme: 'mint' as const, createdAt: now },
    externalIdentityProvider: 'max' as const,
    isBootstrapping: false,
    isAuthenticated: true,
    sessionError: null,
    transport: createTransport(generation),
    retrySession: unexpectedAuthAction,
    updateTheme: unexpectedAuthAction,
    authenticateHost: unexpectedAuthAction,
    authenticateTelegram: unexpectedAuthAction,
    authenticateMax: unexpectedAuthAction,
    startBrowserLink: unexpectedAuthAction,
    browserLinkStatus: unexpectedAuthAction,
    approveBrowserLink: unexpectedAuthAction,
    redeemBrowserLink: unexpectedAuthAction,
    register: unexpectedAuthAction,
    login: unexpectedAuthAction,
    logout: unexpectedAuthAction,
    requestPasswordReset: unexpectedAuthAction,
    confirmPasswordReset: unexpectedAuthAction,
  } satisfies AuthContextValue
  return <QueryClientProvider client={queryClient}><AuthContext.Provider value={auth}><App hostBridge={createBrowserDevHostBridge({ maxBotUsername: 'OurMemoriesDevBot' })} /></AuthContext.Provider></QueryClientProvider>
}

const root = createRoot(document.getElementById('fixture')!)
function render(generation: number) {
  root.render(<AuthenticatedFixture generation={generation} />)
}
void (async () => {
  if (localStorage.getItem('warm-navigation-fixture-persisted') === 'yes') {
    await restorePrivateQueryCache(queryClient, userId, identityGeneration)
  } else {
    queryClient.setQueryData(persistentUiQueryKey(userId), { home, family: familyResponse, members, screen: 'feed', selectedFamilyId: familyId, membershipEpoch: 1, filter: 'all' })
    await persistPrivateQueryCache(queryClient, userId, identityGeneration)
    localStorage.setItem('warm-navigation-fixture-persisted', 'yes')
  }
  render(1)
})()

declare global {
  interface Window { __warmNavRerender: (generation: number) => void; __warmNavEvictPhoto: () => Promise<void> }
}
window.__warmNavRerender = render
window.__warmNavEvictPhoto = () => removePrivateImage(userId, `/api/v1/families/${familyId}/media/${photoId}/content?variant=display`)
