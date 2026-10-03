import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AuthContext } from '../src/features/auth/context'
import type { AuthContextValue } from '../src/features/auth/context'
import type { AuthenticatedTransport } from '../src/platform/api'
import { FeedPage } from '../src/features/feed/FeedPage'
import { feedQueryKeys } from '../src/features/feed/queries'
import { activatePrivateCacheIdentity, allowPrivateFamilyCache } from '../src/platform/persistence/private-cache'
import { syncPrivateMediaAccessToken } from '../src/platform/media/private-media-access'
import type { MemoryDto, MediaDto } from '@web-app-demo/contracts'
import '../src/production.css'

const userId = '11111111-1111-4111-8111-111111111111'
const familyId = '22222222-2222-4222-8222-222222222222'
const childId = '33333333-3333-4333-8333-333333333333'
const authorId = '44444444-4444-4444-8444-444444444444'
const now = '2026-10-03T10:00:00.000Z'
const path = (id: string, variant: string) => `/api/v1/families/${familyId}/media/${id}/content?variant=${variant}`

function video(id: string): MediaDto {
  return { id, source: 'private_storage', kind: 'video', width: 320, height: 180, durationMs: 2_400, renditionStatus: 'ready', previewPath: path(id, 'preview'), displayPath: null, playbackPath: path(id, 'playback'), originalDownloadPath: path(id, 'original'), waveform: null }
}

function photo(id: string): MediaDto {
  return { id, source: 'private_storage', kind: 'photo', width: 320, height: 180, durationMs: null, renditionStatus: 'ready', previewPath: path(id, 'preview'), displayPath: path(id, 'display'), playbackPath: null, originalDownloadPath: path(id, 'original'), waveform: null }
}

function memory(id: string, kind: MemoryDto['kind'], attachments: MediaDto[], minute: number): MemoryDto {
  return { id, familyId, childId, author: { id: authorId, name: 'Анна', avatarPath: null, avatarCrop: null }, kind, body: `Synthetic ${id}`, occurredAt: `2026-10-03T10:${String(minute).padStart(2, '0')}:00.000Z`, firstPublishedAt: null, sourcePublishedAt: null, createdAt: now, version: 1, status: 'published', attachments, reactionCounts: {}, currentUserReaction: null, likes: { count: 0, likedByMe: false }, capabilities: { edit: true, delete: true, like: true } }
}

const videoA = video('55555555-5555-4555-8555-555555555551')
const videoB = video('55555555-5555-4555-8555-555555555552')
const videoC = video('55555555-5555-4555-8555-555555555553')
const videoD = video('55555555-5555-4555-8555-555555555554')
const photoA = photo('66666666-6666-4666-8666-666666666661')
const memories = [
  memory('77777777-7777-4777-8777-777777777771', 'video', [videoA], 1),
  memory('77777777-7777-4777-8777-777777777772', 'media', [photoA, videoA], 2),
  memory('77777777-7777-4777-8777-777777777773', 'media', [videoA, videoB, videoC, videoD], 3),
  memory('77777777-7777-4777-8777-777777777774', 'media', [videoA, videoB], 4),
]

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 60_000 } } })
const generation = activatePrivateCacheIdentity(userId)
allowPrivateFamilyCache(userId, familyId)
syncPrivateMediaAccessToken('synthetic-private-media-token', userId)
const seededMemories = new URLSearchParams(window.location.search).has('poster-processing')
  ? memories.map((item) => ({ ...item, attachments: item.attachments.map((attachment) => attachment.kind === 'video' ? { ...attachment, previewPath: null, displayPath: null } : attachment) }))
  : memories
queryClient.setQueryData(feedQueryKeys.list(familyId, 'all', false, userId, 1, 0), { pages: [{ items: seededMemories, nextCursor: null }], pageParams: [null] })

const transport: AuthenticatedTransport = {
  raw: (url, options) => fetch(url, options),
  request: async (url, schema, options) => {
    const { body, ...init } = options ?? {}
    const response = await fetch(url, { ...init, body: body === undefined ? undefined : JSON.stringify(body) })
    if (!response.ok) throw new Error(`Synthetic fixture request failed: ${response.status}`)
    return schema.parse(await response.json())
  },
}

const auth = { user: { id: userId, email: null, displayName: 'Анна', role: 'user', theme: 'mint', createdAt: now }, externalIdentityProvider: 'max', isBootstrapping: false, isAuthenticated: true, sessionError: null, transport, retrySession: async () => undefined, updateTheme: async () => undefined, authenticateHost: async () => undefined, authenticateTelegram: async () => undefined, authenticateMax: async () => undefined, startBrowserLink: async () => ({}), browserLinkStatus: async () => ({}), approveBrowserLink: async () => undefined, redeemBrowserLink: async () => undefined, register: async () => undefined, login: async () => undefined, logout: async () => undefined, requestPasswordReset: async () => undefined, confirmPasswordReset: async () => undefined } as unknown as AuthContextValue
const hostBridge = { isAvailable: true, initData: () => null, inviteToken: () => null, metadata: () => null, ready: () => undefined, close: () => undefined, back: () => undefined, onBack: () => () => undefined, openBot: () => undefined, openTelegramVideo: () => false, openInvite: () => undefined, getInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }) }
const root = createRoot(document.getElementById('fixture')!)
root.render(<QueryClientProvider client={queryClient}><AuthContext.Provider value={auth}><FeedPage accountId={userId} active childId={childId} childName="Миша" childSubtitle="2 года" familyId={familyId} familyName="Наша семья" familyTimezone="Europe/Moscow" filter="all" hostBridge={hostBridge} insets={{ top: 0, right: 0, bottom: 0, left: 0 }} membershipEpoch={1} onFamily={() => undefined} onAllFamilies={() => undefined} onFilterChange={() => undefined} onAccessLost={() => undefined} role="full" transport={transport} /></AuthContext.Provider></QueryClientProvider>)

void generation
