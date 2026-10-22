import '../src/production.css'
import '../src/platform/diagnostics/bootstrap.js'
import { createRoot } from 'react-dom/client'
import { useEffect, useState } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AuthContext } from '@/features/auth'
import { createBrowserDevHostBridge } from '@/platform/telegram'
import { activatePrivateCacheIdentity, allowPrivateFamilyCache } from '@/platform/persistence/private-cache'
import { syncPrivateMediaAccessToken } from '@/platform/media/private-media-access'
import type { AuthenticatedTransport } from '@/platform/api'
import { StartupBoundary } from '@/features/app/StartupBoundary'

document.documentElement.dataset.uiVersion = 'v2'
document.documentElement.dataset.memolyTheme = 'sand'

type Variant = 'A' | 'B' | 'C' | 'D'
const variant = (new URLSearchParams(location.search).get('variant') ?? 'A') as Variant
const boundaryProbe = new URLSearchParams(location.search).get('boundary')
const feedModule = {
  // Variant A imports the exact production module identity. Vite query suffixes select test-only transforms for B-D.
  A: () => import('../src/features/feed/FeedPage.tsx'),
  // @ts-expect-error Vite query module is only resolved by the browser harness.
  B: () => import('../src/features/feed/FeedPage.tsx?comments-crash=B'),
  // @ts-expect-error Vite query module is only resolved by the browser harness.
  C: () => import('../src/features/feed/FeedPage.tsx?comments-crash=C'),
  // @ts-expect-error Vite query module is only resolved by the browser harness.
  D: () => import('../src/features/feed/FeedPage.tsx?comments-crash=D'),
}
const { FeedPage } = await feedModule[variant]()
const familyId = '11111111-1111-4111-8111-111111111111'
const accountId = '33333333-3333-4333-8333-333333333333'
const otherFamilyId = '22222222-2222-4222-8222-222222222222'
const otherAccountId = '44444444-4444-4444-8444-444444444444'
const feedOrder = Array.from({ length: 130 }, (_, index) => index)
const metrics = { feedCalls: 0, feedFamilies: [] as string[], summaryCalls: 0, summaryBatchSizes: [] as number[], commentCalls: 0, commentWrites: 0, pageErrors: [] as Array<{ name: string; stack: string | null; componentStack: string | null }>, variant }
declare global { interface Window { __commentsCrash: typeof metrics; __commentsCrashControl?: { toggleActive: () => void; switchScope: () => void; removeQueries: () => number; clearCache: () => number; reorderFeed: () => void; feedMemoryCount: () => number } } }
Object.assign(window, { __commentsCrash: metrics })
const recordError = (error: unknown, componentStack: string | null) => {
  const value = error instanceof Error ? error : null
  metrics.pageErrors.push({ name: value?.name ?? 'UnknownError', stack: value?.stack ?? null, componentStack })
}
window.addEventListener('error', (event) => recordError(event.error, null))
window.addEventListener('unhandledrejection', (event) => recordError(event.reason, null))
activatePrivateCacheIdentity(accountId); allowPrivateFamilyCache(accountId, familyId)
Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: undefined })
syncPrivateMediaAccessToken('synthetic-carousel-token', accountId)
const id = (index: number) => `22222222-2222-4222-8222-${String(index + 1).padStart(12, '0')}`
const mediaPath = (kind: 'photos' | 'videos', attachmentId: string) => `/api/v1/families/${familyId}/media/${kind}/${attachmentId}`
const carouselPhoto = (attachmentId: string) => ({ id: attachmentId, source: 'private_storage', kind: 'photo', width: 640, height: 360, durationMs: null, renditionStatus: 'ready', previewPath: mediaPath('photos', attachmentId), displayPath: mediaPath('photos', attachmentId), playbackPath: null, originalDownloadPath: mediaPath('photos', attachmentId), waveform: null })
const carouselVideoId = '44444444-4444-4444-8444-444444444442'
const carouselAttachments = [
  carouselPhoto('44444444-4444-4444-8444-444444444441'),
  { id: carouselVideoId, source: 'private_storage', kind: 'video', width: 640, height: 360, durationMs: 5000, renditionStatus: 'ready', previewPath: mediaPath('photos', carouselVideoId), displayPath: null, playbackPath: `${mediaPath('videos', carouselVideoId)}/content`, originalDownloadPath: `${mediaPath('videos', carouselVideoId)}/original` },
  carouselPhoto('44444444-4444-4444-8444-444444444443'),
]
const createMemory = (index: number) => ({
  id: id(index), familyId, childId: '55555555-5555-4555-8555-555555555555', author: { id: accountId, name: 'Synthetic author', avatarPath: null, avatarCrop: null },
  kind: 'media', body: `Synthetic memory ${index + 1}`, occurredAt: new Date(Date.UTC(2026, 9, 22, 12, 0, -index)).toISOString(), firstPublishedAt: '2026-10-22T12:00:00.000Z', sourcePublishedAt: null, createdAt: '2026-10-22T12:00:00.000Z', version: 1, status: 'published',
  attachments: index === 0 ? carouselAttachments : index % 5 === 0 ? [carouselPhoto(`44444444-4444-4444-8444-${String(index + 1).padStart(12, '0')}`)] : [],
  reactionCounts: {}, currentUserReaction: null, likes: { count: 0, likedByMe: false }, capabilities: { edit: true, delete: true, like: true },
})
const transport = {
  request: async (path: string, _schema?: unknown, options?: { method?: string; body?: { memoryIds?: string[]; body?: string } }) => {
    const method = options?.method ?? 'GET'
    if (path.includes('/memories?')) {
      metrics.feedCalls++
      const activeFamilyId = path.includes(otherFamilyId) ? otherFamilyId : familyId
      metrics.feedFamilies.push(activeFamilyId)
      const cursor = new URLSearchParams(path.split('?')[1]).get('cursor')
      const start = cursor ? Number(cursor) : 0
      const entries = feedOrder.slice(start, start + 20).map((index) => ({ ...createMemory(index), familyId: activeFamilyId }))
      return { items: entries, nextCursor: start + entries.length < feedOrder.length ? String(start + entries.length) : null }
    }
    if (path.endsWith('/comment-summaries')) {
      metrics.summaryCalls++
      const ids = options?.body?.memoryIds ?? []
      metrics.summaryBatchSizes.push(ids.length)
      return { items: ids.map((memoryId) => ({ memoryId, count: 2, capabilities: { read: true, create: true } })) }
    }
    if (path.includes('/comments?')) {
      metrics.commentCalls++
      const createdAt = '2026-10-22T12:00:00.000Z'
      return { items: [{ id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', familyId, memoryId: id(0), author: { id: accountId, name: 'Synthetic author', avatarPath: null, avatarCrop: null }, body: 'Synthetic comment', createdAt, updatedAt: createdAt, version: 1, capabilities: { edit: true, delete: true } }], nextCursor: null, summary: { memoryId: id(0), count: 1, capabilities: { read: true, create: true } } }
    }
    if (method === 'POST' && path.endsWith('/comments')) {
      metrics.commentWrites++
      const createdAt = new Date().toISOString()
      return { comment: { id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', familyId, memoryId: id(0), author: { id: accountId, name: 'Synthetic author', avatarPath: null, avatarCrop: null }, body: options?.body?.body ?? '', createdAt, updatedAt: createdAt, version: 1, capabilities: { edit: true, delete: true } }, summary: { memoryId: id(0), count: 2, capabilities: { read: true, create: true } } }
    }
    if (path.includes('/readiness')) return { state: 'ready', recheckable: false }
    throw new Error(`Unexpected synthetic request: ${method} ${path}`)
  },
  raw: async (_path: string, options?: { signal?: AbortSignal }) => {
    if (options?.signal?.aborted) throw new DOMException('Aborted', 'AbortError')
    const canvas = document.createElement('canvas'); canvas.width = 640; canvas.height = 360
    const context = canvas.getContext('2d')!
    context.fillStyle = '#e0b74d'; context.fillRect(0, 0, 640, 360)
    context.fillStyle = '#356d8b'; context.fillRect(512, 0, 128, 72)
    const blob = await new Promise<Blob>((resolve) => canvas.toBlob((value) => resolve(value!), 'image/png'))
    return new Response(blob, { status: 200, headers: { 'Content-Type': 'image/png' } })
  },
} as unknown as AuthenticatedTransport
const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } })
const auth = { user: { id: accountId }, transport }
export function App() {
  const [scope, setScope] = useState({ familyId, accountId, membershipEpoch: 1 })
  const [active, setActive] = useState(true)
  useEffect(() => {
    Object.assign(window, { __commentsCrashControl: {
      toggleActive: () => setActive((value) => !value),
      switchScope: () => {
        activatePrivateCacheIdentity(otherAccountId)
        allowPrivateFamilyCache(otherAccountId, otherFamilyId)
        setScope({ familyId: otherFamilyId, accountId: otherAccountId, membershipEpoch: 2 })
      },
      removeQueries: () => { queryClient.removeQueries(); return queryClient.getQueryCache().getAll().length },
      clearCache: () => { queryClient.clear(); return queryClient.getQueryCache().getAll().length },
      reorderFeed: () => {
        const key = ['session', 'feed', scope.familyId, 'all', false, scope.accountId, scope.membershipEpoch, 0]
        queryClient.setQueryData(key, (data: { pages: Array<{ items: unknown[] }> } | undefined) => data ? { ...data, pages: [...data.pages].reverse().map((page) => ({ ...page, items: [...page.items].reverse() })) } : data)
      },
      feedMemoryCount: () => queryClient.getQueriesData<{ pages: Array<{ items: unknown[] }> }>({ queryKey: ['session', 'feed', scope.familyId] }).reduce((total, [, data]) => total + (data?.pages.reduce((count, page) => count + page.items.length, 0) ?? 0), 0),
    } })
  }, [scope])
  return <div className="memoly-app-root" data-ui-version="v2"><AuthContext.Provider value={{ ...auth, user: { id: scope.accountId } } as never}><QueryClientProvider client={queryClient}><FeedPage active={active} accountId={scope.accountId} childId="55555555-5555-4555-8555-555555555555" childName="Synthetic child" childSubtitle="" childAvatarMediaId={null} childAvatarCrop={null} familyId={scope.familyId} familyName="Synthetic family" familyTimezone="UTC" filter="all" hostBridge={createBrowserDevHostBridge()} insets={{ top: 0, right: 0, bottom: 0, left: 0 }} isAppBootstrapped membershipEpoch={scope.membershipEpoch} onAccessLost={() => undefined} onAllFamilies={() => undefined} onFamily={() => undefined} onFilterChange={() => undefined} role="full" transport={transport} /></QueryClientProvider></AuthContext.Provider></div>
}
function ThrowingProbe(): never {
  const error = new TypeError('PRIVATE_REACT_FAILURE private-comment-canary')
  error.stack = `TypeError: PRIVATE_REACT_FAILURE\n    at render (${location.origin}/assets/index-Boundary123.js:7:9)`
  throw error
}
if (boundaryProbe === 'diagnostic-throws' && window.__MEMOLY_DIAGNOSTICS__) {
  window.__MEMOLY_DIAGNOSTICS__.recordReactError = () => { throw new Error('private diagnostic failure') }
}
createRoot(document.getElementById('root')!, { onCaughtError: (error, info) => recordError(error, info.componentStack ?? null), onUncaughtError: (error, info) => recordError(error, info.componentStack ?? null) }).render(
  <StartupBoundary>{boundaryProbe ? <ThrowingProbe /> : <App />}</StartupBoundary>,
)
