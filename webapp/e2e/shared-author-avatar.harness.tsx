import type {} from '../src/platform/diagnostics/window'
import '../src/production.css'
if (import.meta.env.VITE_MEMOLY_UI_VERSION === 'v2') document.documentElement.dataset.uiVersion = 'v2'
import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { AuthContext } from '@/features/auth'
import { FeedPage } from '@/features/feed/FeedPage'
import { feedQueryKeys } from '@/features/feed/queries'
import type { AuthenticatedTransport } from '@/platform/api'
import { ApiRequestError } from '@/platform/api'
import { activatePrivateCacheIdentity, allowPrivateFamilyCache, privateFamilyAccessRevokedEvent } from '@/platform/persistence/private-cache'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createBrowserDevHostBridge } from '@/platform/telegram'

type ProbeConfig = { mode: 'idle' | 'feed'; userId: string; familyId: string; membershipEpoch: number; paths: [string, string, string] }
type ProbeMetrics = { requests: string[]; mutations: string[]; familyNavigations: number; created: string[]; revoked: string[]; decodes: number; holdResponses: boolean; holdDecode: boolean; responseWaiters: Array<() => void>; decodeWaiters: Array<() => void>; missing: Set<string> }
declare global { interface Window { __avatarProbe: { configure: (config: ProbeConfig) => void; releaseResponses: () => void; releaseDecode: () => void; revoke: () => void; unmount: () => void; metrics: ProbeMetrics; } } }
let activeProbeConfig: ProbeConfig = { mode: 'idle', userId: '', familyId: '', membershipEpoch: 0, paths: ['', '', ''] }

const metrics: ProbeMetrics = window.__avatarProbe?.metrics ?? {
  requests: [], mutations: [], familyNavigations: 0, created: [], revoked: [], decodes: 0, holdResponses: false, holdDecode: false,
  responseWaiters: [], decodeWaiters: [], missing: new Set(),
}
window.__avatarProbe = {
  metrics,
  configure: () => undefined,
  unmount: () => undefined,
  releaseResponses: () => { metrics.holdResponses = false; metrics.responseWaiters.splice(0).forEach((release) => release()) },
  releaseDecode: () => { metrics.holdDecode = false; metrics.decodeWaiters.splice(0).forEach((release) => release()) },
  revoke: () => window.dispatchEvent(new CustomEvent(privateFamilyAccessRevokedEvent, { detail: { userId: activeProbeConfig.userId, familyId: activeProbeConfig.familyId } })),
}

const nativeCreateObjectURL = URL.createObjectURL.bind(URL)
const nativeRevokeObjectURL = URL.revokeObjectURL.bind(URL)
URL.createObjectURL = (blob) => { const url = nativeCreateObjectURL(blob); metrics.created.push(url); return url }
URL.revokeObjectURL = (url) => { metrics.revoked.push(url); nativeRevokeObjectURL(url) }
const nativeDecode = HTMLImageElement.prototype.decode
HTMLImageElement.prototype.decode = function () {
  metrics.decodes += 1
  if (!metrics.holdDecode) return nativeDecode.call(this)
  return new Promise<void>((resolve, reject) => {
    metrics.decodeWaiters.push(() => { void nativeDecode.call(this).then(resolve, reject) })
  })
}

let updateConfig: ((config: ProbeConfig) => void) | undefined
export function Probe() {
  const [config, setConfig] = useState<ProbeConfig>({ mode: 'idle', userId: '', familyId: '', membershipEpoch: 0, paths: ['', '', ''] })
  const [revoked, setRevoked] = useState(false)
  const currentConfig = useRef(config)
  const transport = useMemo<AuthenticatedTransport>(() => ({
    request: (async (path: string) => {
      if (path.endsWith('/reaction')) { metrics.mutations.push(path); return { reactionCounts: { heart: 3 }, currentUserReaction: 'heart', likes: { count: 3, likedByMe: true } } }
      if (!path.includes('/memories?')) throw new Error('Unexpected synthetic feed request: ' + path)
      const active = currentConfig.current
      return { items: Array.from({ length: 40 }, (_, index) => syntheticMemory(active, index)), nextCursor: null }
    }) as AuthenticatedTransport['request'],
    raw: async (path, options) => {
      metrics.requests.push(path)
      if (metrics.holdResponses) await new Promise<void>((resolve) => metrics.responseWaiters.push(resolve))
      if (options?.signal?.aborted) throw new DOMException('Aborted', 'AbortError')
      if (metrics.missing.has(path)) throw new ApiRequestError(404, 'NOT_FOUND', 'Missing synthetic avatar')
      const bytes = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/F2sAAAAASUVORK5CYII='), (char) => char.charCodeAt(0))
      return new Response(new Blob([bytes], { type: 'image/png' }), { status: 200, headers: { 'Content-Type': 'image/png' } })
    },
  }), [])
  const hostBridge = useMemo(() => createBrowserDevHostBridge(), [])
  const auth = useMemo(() => ({ user: { id: config.userId }, transport }), [config.userId, transport]) as never
  const queryClient = useMemo(() => new QueryClient({ defaultOptions: { queries: { retry: false } } }), [])
  useLayoutEffect(() => {
    currentConfig.current = config
  }, [config])
  useLayoutEffect(() => {
    updateConfig = (next) => {
      const previous = activeProbeConfig
      activeProbeConfig = next
      currentConfig.current = next
      setRevoked(false)
      if (next.userId !== previous.userId) activatePrivateCacheIdentity(next.userId)
      if (next.userId !== previous.userId || next.familyId !== previous.familyId) allowPrivateFamilyCache(next.userId, next.familyId)
      setConfig(next)
      if (next.mode === 'feed') void queryClient.invalidateQueries({ queryKey: feedQueryKeys.all })
    }
    window.__avatarProbe.configure = (next) => updateConfig?.(next)
    const onRevoked = (event: Event) => {
      const detail = (event as CustomEvent<{ userId?: string; familyId?: string }>).detail
      if (detail?.userId === currentConfig.current.userId && detail.familyId === currentConfig.current.familyId) setRevoked(true)
    }
    window.addEventListener(privateFamilyAccessRevokedEvent, onRevoked)
    return () => {
      window.removeEventListener(privateFamilyAccessRevokedEvent, onRevoked)
      updateConfig = undefined
      window.__avatarProbe.configure = () => undefined
    }
  }, [queryClient])
  return <AuthContext.Provider value={auth}><QueryClientProvider client={queryClient}>
    {config.mode === 'idle' ? null : <FeedPage active={!revoked} accountId={config.userId} childId="33333333-3333-4333-8333-333333333333" childName="Synthetic child" childSubtitle="" childAvatarMediaId={null} childAvatarCrop={null} familyId={config.familyId} familyName="Synthetic family" familyTimezone="UTC" filter="all" hostBridge={hostBridge} insets={{ top: 0, right: 0, bottom: 0, left: 0 }} isAppBootstrapped membershipEpoch={config.membershipEpoch} onAccessLost={() => undefined} onAllFamilies={() => undefined} onFamily={() => { metrics.familyNavigations += 1 }} onFilterChange={() => undefined} role="full" transport={transport} />}
  </QueryClientProvider></AuthContext.Provider>
}

function syntheticMemory(config: ProbeConfig, index: number) {
  const authorIndex = index % 2
  const foreign = index === 39
  const absent = index === 38
  const memoryId = `90000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`
  return {
    id: memoryId,
    familyId: config.familyId,
    childId: '33333333-3333-4333-8333-333333333333',
    author: { id: foreign ? 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee' : authorIndex ? 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' : 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', name: foreign ? 'Foreign author' : absent ? 'No avatar author' : authorIndex ? 'Author A' : 'Author B', avatarPath: absent ? null : config.paths[foreign ? 2 : authorIndex]!, avatarCrop: { x: .25, y: .1, width: .5, height: .5 } },
    kind: index === 0 ? 'media' : 'note',
    body: `Synthetic card ${index}`,
    occurredAt: '2026-10-13T10:00:00.000Z',
    firstPublishedAt: '2026-10-13T10:00:00.000Z',
    sourcePublishedAt: null,
    createdAt: '2026-10-13T10:00:00.000Z',
    version: 1,
    status: 'published',
    attachments: index === 0 ? [1, 2].map((position) => ({
      id: `91000000-0000-4000-8000-${String(position).padStart(12, '0')}`,
      source: 'telegram',
      kind: 'video',
      width: 16,
      height: 9,
      durationMs: 1_000,
      thumbnailPath: null,
      openInTelegramPath: `/api/v1/families/${config.familyId}/memories/${memoryId}/telegram-video`,
    })) : [],
    reactionCounts: { heart: 2 },
    currentUserReaction: null,
    likes: { count: 2, likedByMe: false },
    capabilities: { edit: true, delete: true, like: true },
  }
}

const root = createRoot(document.getElementById('root')!)
window.__avatarProbe.unmount = () => root.unmount()
root.render(<Probe />)
