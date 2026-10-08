import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AuthContext } from '../src/features/auth/context'
import type { AuthContextValue } from '../src/features/auth/context'
import type { AuthenticatedTransport, HttpRequestOptions } from '../src/platform/api'
import { FeedPage, MaxVideoPreview } from '../src/features/feed/FeedPage'
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
const syntheticAccessToken = 'synthetic-private-media-token'
const path = (id: string, variant: string) => `/api/v1/families/${familyId}/media/${id}/content?variant=${variant}`

function video(id: string, portrait = false): MediaDto {
  return { id, source: 'private_storage', kind: 'video', width: portrait ? 180 : 320, height: portrait ? 320 : 180, durationMs: 30_000, renditionStatus: 'ready', previewPath: path(id, 'preview'), displayPath: null, playbackPath: path(id, 'playback'), originalDownloadPath: path(id, 'original'), waveform: null }
}

function photo(id: string): MediaDto {
  return { id, source: 'private_storage', kind: 'photo', width: 320, height: 180, durationMs: null, renditionStatus: 'ready', previewPath: path(id, 'preview'), displayPath: path(id, 'display'), playbackPath: null, originalDownloadPath: path(id, 'original'), waveform: null }
}

function memory(id: string, kind: MemoryDto['kind'], attachments: MediaDto[], minute: number): MemoryDto {
  return { id, familyId, childId, author: { id: authorId, name: 'Анна', avatarPath: null, avatarCrop: null }, kind, body: `Synthetic ${id}`, occurredAt: `2026-10-03T10:${String(minute).padStart(2, '0')}:00.000Z`, firstPublishedAt: null, sourcePublishedAt: null, createdAt: now, version: 1, status: 'published', attachments, reactionCounts: {}, currentUserReaction: null, likes: { count: 0, likedByMe: false }, capabilities: { edit: true, delete: true, like: true } }
}

const videoA = video('55555555-5555-4555-8555-555555555551')
const videoB = { ...video('55555555-5555-4555-8555-555555555552'), width: 180, height: 320 }
const videoC = video('55555555-5555-4555-8555-555555555553')
const videoD = video('55555555-5555-4555-8555-555555555554')
const videoPortrait = video('55555555-5555-4555-8555-555555555555', true)
const photoA = photo('66666666-6666-4666-8666-666666666661')
const memories = [
  memory('77777777-7777-4777-8777-777777777771', 'video', [videoA], 1),
  memory('77777777-7777-4777-8777-777777777772', 'media', [photoA, videoPortrait], 2),
  memory('77777777-7777-4777-8777-777777777773', 'media', [videoA, videoB, videoC, videoD], 3),
  memory('77777777-7777-4777-8777-777777777774', 'media', [videoA, videoB], 4),
  memory('77777777-7777-4777-8777-777777777775', 'video', [videoPortrait], 5),
]

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 60_000 } } })
const generation = activatePrivateCacheIdentity(userId)
allowPrivateFamilyCache(userId, familyId)
syncPrivateMediaAccessToken(syntheticAccessToken, userId)
const fixtureSearch = new URLSearchParams(window.location.search)
const seededMemories = fixtureSearch.has('playback-failed')
  ? memories.map((item) => ({ ...item, attachments: item.attachments.map((attachment) => attachment.kind === 'video'
    ? { ...attachment, renditionStatus: 'failed' as const, previewPath: null, displayPath: null, playbackPath: null }
    : attachment) }))
  : fixtureSearch.has('poster-processing')
    ? memories.map((item) => ({ ...item, attachments: item.attachments.map((attachment) => attachment.kind === 'video' ? { ...attachment, previewPath: null, displayPath: null } : attachment) }))
    : memories
queryClient.setQueryData(feedQueryKeys.list(familyId, 'all', false, userId, 1, 0), { pages: [{ items: seededMemories, nextCursor: null }], pageParams: [null] })

function fetchOptions(options?: HttpRequestOptions): RequestInit {
  const { body, rawBody, ...init } = options ?? {}
  if (body !== undefined && rawBody !== undefined) throw new TypeError('body and rawBody cannot be used together')
  const headers = new Headers(init.headers)
  headers.set('Authorization', `Bearer ${syntheticAccessToken}`)
  if (body !== undefined && rawBody === undefined) headers.set('Content-Type', 'application/json')
  return { ...init, credentials: init.credentials ?? 'include', headers, body: rawBody ?? (body === undefined ? undefined : JSON.stringify(body)) }
}

const transport: AuthenticatedTransport = {
  raw: (url, options) => fetch(url, fetchOptions(options)),
  request: async (url, schema, options) => {
    const response = await fetch(url, fetchOptions(options))
    if (!response.ok) throw new Error(`Synthetic fixture request failed: ${response.status}`)
    return schema.parse(await response.json())
  },
}

const unexpectedAuthAction = async (): Promise<never> => { throw new Error('Unexpected auth action in video fixture') }
const auth = { user: { id: userId, email: null, displayName: 'Анна', role: 'user', theme: 'mint', createdAt: now }, externalIdentityProvider: 'max', isBootstrapping: false, isAuthenticated: true, sessionError: null, transport, retrySession: unexpectedAuthAction, updateTheme: unexpectedAuthAction, authenticateHost: unexpectedAuthAction, authenticateTelegram: unexpectedAuthAction, authenticateMax: unexpectedAuthAction, startBrowserLink: unexpectedAuthAction, browserLinkStatus: unexpectedAuthAction, approveBrowserLink: unexpectedAuthAction, redeemBrowserLink: unexpectedAuthAction, register: unexpectedAuthAction, login: unexpectedAuthAction, logout: unexpectedAuthAction, requestPasswordReset: unexpectedAuthAction, confirmPasswordReset: unexpectedAuthAction } satisfies AuthContextValue
const hostBridge = { kind: 'browser', isAvailable: true, initData: () => null, rawAuthData: () => null, inviteToken: () => null, inviteLink: () => null, metadata: () => null, ready: () => undefined, close: () => undefined, back: () => undefined, onBack: () => () => undefined, openBot: () => undefined, openTelegramVideo: () => false, openInvite: () => undefined, getInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }) } satisfies import('../src/platform/host-bridge').HostBridge
const root = createRoot(document.getElementById('fixture')!)
root.render(<QueryClientProvider client={queryClient}><AuthContext.Provider value={auth}><FeedPage accountId={userId} active childId={childId} childName="Миша" childSubtitle="2 года" familyId={familyId} familyName="Наша семья" familyTimezone="Europe/Moscow" filter="all" hostBridge={hostBridge} insets={{ top: 0, right: 0, bottom: 0, left: 0 }} membershipEpoch={1} onFamily={() => undefined} onAllFamilies={() => undefined} onFilterChange={() => undefined} onAccessLost={() => undefined} role="full" transport={transport} /><section data-memoly-feed data-testid="max-video-direct-fixture"><MaxVideoPreview durationMs={30_000} height={320} onOpen={() => undefined} poster={`${path(videoPortrait.id, 'preview')}`} src={path(videoPortrait.id, 'playback')} width={180} /></section></AuthContext.Provider></QueryClientProvider>)

void generation
