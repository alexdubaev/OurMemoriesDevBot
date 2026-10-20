import type {} from '../src/platform/diagnostics/window'
import '../src/production.css'
document.documentElement.dataset.uiVersion = 'v2'
import { useMemo, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { AuthenticatedTransport } from '@/platform/api'
import { ApiRequestError } from '@/platform/api'
import { CommentsPanel } from '@/features/comments'
import { useCommentSummaries } from '@/features/comments/queries'
import { activatePrivateCacheIdentity, allowPrivateFamilyCache, privateFamilyAccessRevokedEvent, removePrivateFamilyCache } from '@/platform/persistence/private-cache'
import type { CommentDto, CommentPage } from '@web-app-demo/contracts'

const A = { accountId: 'account-a', familyId: '11111111-1111-4111-8111-111111111111', membershipEpoch: 1, memoryId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' }
const B = { accountId: 'account-b', familyId: '22222222-2222-4222-8222-222222222222', membershipEpoch: 1, memoryId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' }
type Gate = { kind: 'list' | 'create'; path: string; body?: string; aborted: boolean; resolve: () => void }
type Metrics = { calls: Array<{ path: string; method: string; ids?: number[] }>; gates: Gate[]; holdNext: 'list' | 'create' | null; patchMode: 'none' | 'forbidden-readable' | 'forbidden-denied' | 'version-conflict' | 'deleted-conflict' | 'delete-version-conflict'; configure: (action: string) => void; release: (kind: 'list' | 'create') => void; snapshot: () => unknown }
declare global { interface Window { __commentsState: Metrics } }

const metrics: Metrics = { calls: [], gates: [], holdNext: null, patchMode: 'none', configure: () => undefined, release: () => undefined, snapshot: () => [] }
const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } })
window.__commentsState = metrics

function fixture(body = 'Existing comment', id = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', version = 1, ordinal = 1): CommentDto {
  const time = new Date(Date.UTC(2026, 9, 1, 12, ordinal)).toISOString()
  return { id, familyId: A.familyId, memoryId: A.memoryId, author: { id: A.accountId, name: 'Тест', avatarPath: null, avatarCrop: null }, body, createdAt: time, updatedAt: time, version, capabilities: { edit: true, delete: true } }
}
function page(items = Array.from({ length: 20 }, (_, i) => fixture(`Existing comment ${i + 1}`, `cccccccc-cccc-4ccc-8ccc-${String(i + 1).padStart(12, '0')}`, 1, i)), nextCursor: string | null = null): CommentPage { return { items, nextCursor, summary: { memoryId: A.memoryId, count: items.length, capabilities: { read: true, create: true } } } }

function Harness() {
  const [scope, setScope] = useState(A)
  const [open, setOpen] = useState(false)
  const [active] = useState(true)
  const transport = useMemo<AuthenticatedTransport>(() => ({ request: (async (path: string, _schema: unknown, options?: { method?: string; body?: { memoryIds?: string[]; body?: string }; signal?: AbortSignal }) => {
    const method = options?.method ?? 'GET'
    metrics.calls.push({ path, method, ...(options?.body?.memoryIds ? { ids: options.body.memoryIds.length } : {}) })
    if ((method === 'PATCH' || method === 'DELETE') && metrics.patchMode !== 'none') {
      const mode = metrics.patchMode
      throw new ApiRequestError(mode === 'version-conflict' || mode === 'deleted-conflict' || mode === 'delete-version-conflict' ? 409 : 403, mode === 'version-conflict' || mode === 'delete-version-conflict' ? 'VERSION_CONFLICT' : mode === 'deleted-conflict' ? 'CONFLICT' : 'ROLE_FORBIDDEN', 'Synthetic mutation failure')
    }
    const list = path.includes('/comments?')
    const create = method === 'POST' && path.endsWith('/comments')
    if (list) {
      const patchMode = metrics.patchMode
      metrics.patchMode = 'none'
      if (patchMode === 'forbidden-denied') throw new ApiRequestError(403, 'ROLE_FORBIDDEN', 'Synthetic read revoked')
      const gate: Gate = { kind: 'list', path, aborted: false, resolve: () => undefined }
      if (options?.signal) options.signal.addEventListener('abort', () => { gate.aborted = true }, { once: true })
      if (metrics.holdNext === 'list') { metrics.holdNext = null; metrics.gates.push(gate); await new Promise<void>((resolve) => { gate.resolve = () => resolve() }) }
      if (path.includes('cursor=older')) return { ...page(Array.from({ length: 20 }, (_, i) => fixture(`Earlier ${i + 1}`, `dddddddd-dddd-4ddd-8ddd-${String(i + 1).padStart(12, '0')}`, 1, i)), null) }
      if (patchMode === 'deleted-conflict') return page([], null)
      if (patchMode === 'version-conflict') return page([fixture('Server updated comment', 'cccccccc-cccc-4ccc-8ccc-000000000001', 2)], null)
      if (patchMode === 'delete-version-conflict') return page([fixture('Server updated comment', 'cccccccc-cccc-4ccc-8ccc-000000000001', 2)], null)
      return page(undefined, 'older')
    }
    if (method === 'DELETE') return { deletedId: 'cccccccc-cccc-4ccc-8ccc-000000000001', summary: { memoryId: A.memoryId, count: 0, capabilities: { read: true, create: true } } }
    if (create) {
      const gate: Gate = { kind: 'create', path, body: options?.body?.body, aborted: false, resolve: () => undefined }
      if (options?.signal) options.signal.addEventListener('abort', () => { gate.aborted = true }, { once: true })
      if (metrics.holdNext === 'create') { metrics.holdNext = null; metrics.gates.push(gate); await new Promise<void>((resolve) => { gate.resolve = () => resolve() }) }
      return { comment: fixture(gate.body ?? 'Late private body', 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'), summary: { memoryId: A.memoryId, count: 2, capabilities: { read: true, create: true } } }
    }
    if (method === 'PATCH') return { comment: fixture(options?.body?.body ?? 'Saved edit', 'cccccccc-cccc-4ccc-8ccc-000000000001', 3), summary: { memoryId: A.memoryId, count: 1, capabilities: { read: true, create: true } } }
    if (path.endsWith('/comments/summaries')) return { items: (options?.body?.memoryIds ?? []).map((memoryId) => ({ memoryId, count: 1, capabilities: { read: true, create: true } })) }
    throw new Error(`Unexpected comments harness request ${method} ${path}`)
  }) as AuthenticatedTransport['request'] }), [])
  const summaries = useCommentSummaries(transport, scope.familyId, scope.accountId, scope.membershipEpoch, Array.from({ length: 60 }, (_, i) => `90000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`), active)
  metrics.configure = (action) => {
    if (action === 'family') { setOpen(false); void removePrivateFamilyCache(queryClient, scope.accountId, scope.familyId); const next = { ...B, accountId: scope.accountId }; allowPrivateFamilyCache(next.accountId, next.familyId); window.setTimeout(() => { setScope(next); setOpen(true) }, 50) }
    if (action === 'epoch') { setOpen(false); void removePrivateFamilyCache(queryClient, scope.accountId, scope.familyId); window.setTimeout(() => { setScope((current) => ({ ...current, membershipEpoch: current.membershipEpoch + 1 })); setOpen(true) }, 50) }
    if (action === 'account' || action === 'logout') { setOpen(false); window.setTimeout(() => { activatePrivateCacheIdentity(action === 'logout' ? null : B.accountId); queryClient.clear(); setScope({ ...B, accountId: action === 'logout' ? '' : B.accountId }); setOpen(action !== 'logout') }, 50) }
    if (action === 'revoke') { setOpen(false); window.dispatchEvent(new CustomEvent(privateFamilyAccessRevokedEvent, { detail: { userId: scope.accountId, familyId: scope.familyId } })); void removePrivateFamilyCache(queryClient, scope.accountId, scope.familyId) }
    if (action === 'open') setOpen(true)
  }
  metrics.snapshot = () => ({ keys: queryClient.getQueryCache().getAll().map((query) => query.queryKey), data: queryClient.getQueryCache().getAll().map((query) => query.state.data), open, scope, summaries: summaries.size })
  metrics.release = (kind) => { metrics.gates.filter((gate) => gate.kind === kind).forEach((gate) => gate.resolve(undefined)) }
  return <main><button onClick={() => setOpen(true)}>Open comments</button><output data-testid="summary-count">{summaries.size}</output>{open ? <CommentsPanel familyTimezone="UTC" hostBridge={{ onBack: () => () => undefined }} onClose={() => setOpen(false)} open scope={scope} transport={transport} returnFocusRef={{ current: null }} /> : null}</main>
}

activatePrivateCacheIdentity(A.accountId)
allowPrivateFamilyCache(A.accountId, A.familyId)
createRoot(document.getElementById('root')!).render(<QueryClientProvider client={queryClient}><Harness /></QueryClientProvider>)
