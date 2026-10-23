import '../src/production.css'
import { createRoot } from 'react-dom/client'
import { useState } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AuthContext } from '@/features/auth'
import type { AuthContextValue } from '@/features/auth'
import App from '@/App'
import { createBrowserDevHostBridge } from '@/platform/telegram'
import { activatePrivateCacheIdentity, allowPrivateFamilyCache, cachePrivateImageResponse, persistentUiQueryKey, privateCacheIdentityGeneration, privateFamilyCacheGeneration } from '@/platform/persistence/private-cache'
import { syncPrivateMediaAccessToken } from '@/platform/media/private-media-access'
import type { AuthenticatedTransport } from '@/platform/api'
import { memolyV4ReferenceImages } from './fixtures/memoly-v4-reference-images'
import { albumFixture } from './fixtures/albums'
import type { HttpRequestOptions } from '../src/platform/api/http-client'

const userId = '33333333-3333-4333-8333-333333333333'
const familyId = '11111111-1111-4111-8111-111111111111'
const childId = '55555555-5555-4555-8555-555555555555'
const avatarMediaId = 'aaa00000-0000-4000-8000-000000000012'
const avatarPath = `/api/v1/families/${familyId}/media/${avatarMediaId}/content?variant=display`
const secondUserId = '44444444-4444-4444-8444-444444444444'
const secondFamilyId = '22222222-2222-4222-8222-222222222222'
const secondChildId = '66666666-6666-4666-8666-666666666666'
const secondAvatarMediaId = 'bbb00000-0000-4000-8000-000000000021'
const params = new URLSearchParams(location.search)
const albums = params.has('albums') ? albumFixture(familyId, childId, userId, params) : null
const welcomeClaimKey = `__selected-family-welcome-claimed:${userId}`
const user: NonNullable<AuthContextValue['user']> = { id: userId, email: null, displayName: 'Synthetic owner', role: 'user', theme: 'lavender', createdAt: '2026-10-01T00:00:00.000Z' }
const secondUser = { ...user, id: secondUserId }
const family = { id: familyId, name: 'Семья Алисы', timezone: 'Europe/Moscow', ownerUserId: userId }
const secondFamily = { id: secondFamilyId, name: 'Семья Миши', timezone: 'Europe/Moscow', ownerUserId: userId }
const child = { id: childId, name: 'Алиса', birthDate: '2024-01-17', sex: 'girl', avatarMediaId: avatarMediaId as string | null, avatarCrop: null as { x: number; y: number; width: number; height: number } | null, version: 1, isComplete: true }
const secondChild = { id: secondChildId, name: 'Миша', birthDate: '2023-08-04', sex: 'boy', avatarMediaId: secondAvatarMediaId as string | null, avatarCrop: null as { x: number; y: number; width: number; height: number } | null, version: 1, isComplete: true }
const familyResponse = { family, child: params.has('noChild') ? null : child }
const secondFamilyResponse = { family: secondFamily, child: secondChild }
const member = { userId, avatarPath: null, displayName: 'Synthetic owner', familyDisplayName: null, role: params.has('viewer') ? 'viewer' : 'full', isOwner: !params.has('viewer'), joinedAt: '2026-10-01T00:00:00.000Z', version: 1 }
const members = [member]
const home = {
  version: 1, ownFamilyId: familyId, ownFamilyStatus: 'active', canCreateOwnFamily: false,
  items: [
    { familyId, name: family.name, displaySubtitle: child.name, childAvatarMediaId: avatarMediaId, childAvatarCrop: null, isOwner: true, role: 'full', setupStatus: 'ready', capabilities: { canCreateInvite: true, canManageMembers: true, canEditChild: true, canPublishNote: true, canPublishPhoto: true, canPublishVoice: true, canPublishVideo: false, canUploadChildAvatar: true }, unreadCount: null, unreadState: 'not_enabled', membershipEpoch: 1 },
    { familyId: secondFamilyId, name: secondFamily.name, displaySubtitle: secondChild.name, childAvatarMediaId: secondAvatarMediaId, childAvatarCrop: null, isOwner: true, role: 'full', setupStatus: 'ready', capabilities: { canCreateInvite: true, canManageMembers: true, canEditChild: true, canPublishNote: true, canPublishPhoto: true, canPublishVoice: true, canPublishVideo: false, canUploadChildAvatar: true }, unreadCount: null, unreadState: 'not_enabled', membershipEpoch: 1 },
  ],
  nextCursor: null,
}
function currentHome() {
  return { ...home, items: home.items.filter((item) => !params.has('onlyOneFamily') || item.familyId === familyId).map((item) => item.familyId === familyId
    ? { ...item, childAvatarMediaId: child.avatarMediaId, childAvatarCrop: child.avatarCrop }
    : item) }
}

activatePrivateCacheIdentity(userId)
if (!params.has('hubFirst')) allowPrivateFamilyCache(userId, familyId, 1)
allowPrivateFamilyCache(secondUserId, secondFamilyId)
syncPrivateMediaAccessToken('synthetic-selected-family-token', userId)

const timeline: Array<{ stage: string; at: number; url?: string; cacheHit?: boolean; duration?: number }> = []
const rawPaths: string[] = []
const nativeIdbGet = IDBObjectStore.prototype.get
IDBObjectStore.prototype.get = function (query: IDBValidKey | IDBKeyRange) {
  const request = nativeIdbGet.call(this, query)
  if (typeof query === 'string' && query.includes(':image:')) {
    const startedAt = performance.now()
    timeline.push({ stage: 'idb:image:start', at: startedAt })
    request.addEventListener('success', () => timeline.push({ stage: 'idb:image:ready', at: performance.now(), cacheHit: request.result !== undefined, duration: performance.now() - startedAt }), { once: true })
    request.addEventListener('error', () => timeline.push({ stage: 'idb:image:error', at: performance.now(), duration: performance.now() - startedAt }), { once: true })
  }
  return request
}
const nativeCreateObjectURL = URL.createObjectURL.bind(URL)
const nativeRevokeObjectURL = URL.revokeObjectURL.bind(URL)
const liveBlobUrls = new Set<string>()
URL.createObjectURL = (blob) => { const url = nativeCreateObjectURL(blob); liveBlobUrls.add(url); return url }
URL.revokeObjectURL = (url) => { liveBlobUrls.delete(url); nativeRevokeObjectURL(url) }
const imageDecode = HTMLImageElement.prototype.decode
HTMLImageElement.prototype.decode = function () {
  const url = this.currentSrc || this.src
  timeline.push({ stage: 'decode:start', at: performance.now(), url })
  return imageDecode.call(this).then(() => { timeline.push({ stage: 'decode:ready', at: performance.now(), url }) })
}
Object.assign(window, {
  __selectedFamilyAvatarTimeline: timeline,
  __selectedFamilyRawPaths: rawPaths,
  __selectedFamilyAvatarRequests: [] as number[],
  __selectedFamilyLiveBlobCount: () => liveBlobUrls.size,
  __selectedFamilyIsBlobLive: (url: string) => liveBlobUrls.has(url),
  __selectedFamilyUpdateAvatar: (mediaId: string | null, crop: typeof child.avatarCrop) => {
    child.avatarMediaId = mediaId
    child.avatarCrop = crop
    timeline.push({ stage: 'profile:save', at: performance.now(), url: mediaId ?? undefined })
    window.dispatchEvent(new CustomEvent('member-avatar-updated', { detail: { accountId: userId } }))
  },
  __selectedFamilyRevokeAccess: () => window.dispatchEvent(new CustomEvent('memoly:private-family-access-revoked', { detail: { userId, familyId } })),
  __selectedFamilyChangeAccount: () => undefined as void,
})

const transport = {
  request: async (path: string, schema: { parse: (value: unknown) => unknown }, options?: HttpRequestOptions) => {
    if (albums) {
      try { const response = await albums.request(path, options); if (response.handled) return schema.parse(response.value) }
      catch (reason) {
        const evidence = (window as typeof window & { __albumsEvidence?: { errors?: string[] } }).__albumsEvidence
        if (evidence) { evidence.errors ??= []; evidence.errors.push(`${options?.method ?? 'GET'} ${path}: ${reason instanceof Error ? reason.message : String(reason)}`) }
        throw reason
      }
    }
    if (path.startsWith('/api/v1/me/families')) {
      const startedAt = performance.now()
      timeline.push({ stage: 'rights:data:home:start', at: startedAt })
      const homeDelay = Number(params.get('homeDelay') ?? 0)
      if (homeDelay > 0) await new Promise((resolve) => window.setTimeout(resolve, homeDelay))
      timeline.push({ stage: 'rights:data:home', at: performance.now(), duration: performance.now() - startedAt })
      return schema.parse(currentHome())
    }
    if (path === `/api/v1/families/${familyId}`) { const startedAt = performance.now(); timeline.push({ stage: 'rights:data:family:start', at: startedAt }); timeline.push({ stage: 'rights:data:family', at: performance.now(), duration: performance.now() - startedAt }); return schema.parse(familyResponse) }
    if (path === `/api/v1/families/${secondFamilyId}`) { const startedAt = performance.now(); timeline.push({ stage: 'rights:data:family:start', at: startedAt }); timeline.push({ stage: 'rights:data:family', at: performance.now(), duration: performance.now() - startedAt }); return schema.parse(secondFamilyResponse) }
    if (path === `/api/v1/families/${familyId}/members` || path === `/api/v1/families/${secondFamilyId}/members`) return schema.parse({ items: members })
    if (path === `/api/v1/families/${familyId}/invites` || path === `/api/v1/families/${secondFamilyId}/invites`) return schema.parse({ items: [] })
    if (path === `/api/v1/families/${familyId}/usage` || path === `/api/v1/families/${secondFamilyId}/usage`) return schema.parse({ usedBytes: 0, quotaBytes: null })
    if (path === `/api/v1/families/${familyId}/max-channel` || path === `/api/v1/families/${secondFamilyId}/max-channel`) return schema.parse({ state: 'unconfigured', title: null, canManage: true })
    if (path.startsWith(`/api/v1/families/${familyId}/memories`) || path.startsWith(`/api/v1/families/${secondFamilyId}/memories`)) return schema.parse({ items: params.has('channelMemory') && path.includes(familyId) ? [syntheticChannelMemory()] : [], nextCursor: null })
    if (path === '/api/v1/me/welcome/claim') {
      if (!params.has('welcomeFirst') || sessionStorage.getItem(welcomeClaimKey) === 'claimed') {
        return schema.parse({ showWelcome: false })
      }
      sessionStorage.setItem(welcomeClaimKey, 'claimed')
      return schema.parse({ showWelcome: true })
    }
    throw new Error(`Unexpected synthetic API request: ${path}`)
  },
  raw: async (path: string) => {
    rawPaths.push(path)
    const albumImage = await albums?.raw(path)
    if (albumImage) return albumImage
    if ((child.avatarMediaId && path.startsWith(`/api/v1/families/${familyId}/media/${child.avatarMediaId}/content?variant=display`)) || path.startsWith(`/api/v1/families/${secondFamilyId}/media/${secondChild.avatarMediaId}/content?variant=display`)) {
      const requests = (window as typeof window & { __selectedFamilyAvatarRequests: number[] }).__selectedFamilyAvatarRequests
      requests.push(performance.now())
      timeline.push({ stage: 'fetch:start', at: performance.now(), url: path })
      const delay = Number(params.get('avatarDelay') ?? 0)
      if (delay > 0) await new Promise((resolve) => window.setTimeout(resolve, delay))
      timeline.push({ stage: 'fetch:ready', at: performance.now(), url: path })
    }
    const response = await fetch(memolyV4ReferenceImages['portrait-girl'].dataUrl)
    return new Response(await response.blob(), { status: 200, headers: { 'Content-Type': response.headers.get('Content-Type') ?? 'image/svg+xml' } })
  },
} as unknown as AuthenticatedTransport

function syntheticChannelMemory() {
  return {
    id: '77777777-7777-4777-8777-777777777777',
    familyId,
    childId,
    author: { id: secondUserId, name: 'Synthetic channel publisher', avatarPath: null, avatarCrop: null },
    kind: 'note',
    body: 'Synthetic channel memory',
    occurredAt: '2026-10-17T10:00:00.000Z',
    firstPublishedAt: '2026-10-17T10:00:00.000Z',
    sourcePublishedAt: null,
    createdAt: '2026-10-17T10:00:00.000Z',
    version: 1,
    status: 'published',
    attachments: [],
    reactionCounts: {},
    currentUserReaction: null,
    likes: { count: 0, likedByMe: false },
    capabilities: { edit: false, delete: false, like: true },
    publicationAttribution: { kind: 'channel', name: 'Домашний канал', avatarPath: `/api/v1/families/${familyId}/media/max-channels/1234567890123456789/avatar` },
  }
}

const hostBridge = (() => {
  const base = createBrowserDevHostBridge()
  const handlers: Array<() => void> = []
  Object.assign(window, { __albumsTriggerBack: () => handlers.at(-1)?.() })
  return { ...base, onBack: (handler: () => void) => { handlers.push(handler); return () => { const index = handlers.lastIndexOf(handler); if (index >= 0) handlers.splice(index, 1) } } }
})()

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
queryClient.setQueryData(persistentUiQueryKey(userId), params.has('hubFirst')
  ? { home, family: null, members, screen: 'hub', selectedFamilyId: null, membershipEpoch: null, filter: 'all' }
  : { home, family: familyResponse, members, screen: 'feed', selectedFamilyId: familyId, membershipEpoch: 1, filter: 'all' })
queryClient.setQueryData(persistentUiQueryKey(secondUserId), { home, family: secondFamilyResponse, members, screen: 'feed', selectedFamilyId: secondFamilyId, membershipEpoch: 1, filter: 'all' })

export function SelectedFamilyAppHarness() {
  const [activeUser, setActiveUser] = useState(user)
  Object.assign(window, { __selectedFamilyChangeAccount: () => {
    activatePrivateCacheIdentity(secondUserId)
    syncPrivateMediaAccessToken('synthetic-selected-family-token-2', secondUserId)
    setActiveUser(secondUser)
  } })
  return <AuthContext.Provider value={{ user: activeUser, externalIdentityProvider: 'max', isBootstrapping: false, isAuthenticated: true, sessionError: null, retrySession: async () => undefined, transport, updateTheme: async () => undefined, authenticateHost: async () => undefined, authenticateTelegram: async () => undefined, authenticateMax: async () => undefined, startBrowserLink: async () => { throw new Error('not used') }, browserLinkStatus: async () => { throw new Error('not used') }, approveBrowserLink: async () => undefined, redeemBrowserLink: async () => undefined, register: async () => undefined, login: async () => undefined, logout: async () => undefined, requestPasswordReset: async () => undefined, confirmPasswordReset: async () => undefined }}>
    <QueryClientProvider client={queryClient}><App hostBridge={hostBridge} /></QueryClientProvider>
  </AuthContext.Provider>
}

async function render() {
  if (params.has('cached')) {
    const cachedBytes = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/F2sAAAAASUVORK5CYII='), (char) => char.charCodeAt(0))
    await cachePrivateImageResponse(userId, avatarPath, new Response(new Blob([cachedBytes], { type: 'image/png' }), { status: 200, headers: { 'Content-Type': 'image/png' } }), privateCacheIdentityGeneration(), privateFamilyCacheGeneration(userId, familyId))
  }
  createRoot(document.getElementById('root')!).render(<SelectedFamilyAppHarness />)
}
void render()
