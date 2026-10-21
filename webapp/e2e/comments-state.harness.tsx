import type {} from '../src/platform/diagnostics/window'
import '../src/production.css'
document.documentElement.dataset.uiVersion = 'v2'
import { useCallback, useLayoutEffect, useMemo, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { AuthenticatedTransport } from '@/platform/api'
import { ApiRequestError } from '@/platform/api'
import { CommentsPanel } from '@/features/comments'
import { commentsQueryKeys, useCommentSummaries } from '@/features/comments/queries'
import { activatePrivateCacheIdentity, allowPrivateFamilyCache, privateFamilyAccessRevokedEvent, removePrivateFamilyCache } from '@/platform/persistence/private-cache'
import type { CommentDto, CommentPage } from '@web-app-demo/contracts'
import type { MemoryDto, MemoryReaction } from '@web-app-demo/contracts'
import { MemoryCardPresentation } from '@/features/feed/presentation/MemoryCardPresentation'

const A = { accountId: 'account-a', familyId: '11111111-1111-4111-8111-111111111111', membershipEpoch: 1, memoryId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' }
const B = { accountId: 'account-b', familyId: '22222222-2222-4222-8222-222222222222', membershipEpoch: 1, memoryId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' }
type Gate = { kind: 'list' | 'create' | 'summary'; path: string; body?: string; aborted: boolean; completed: boolean; resolve: () => void }
type CapabilityMode = 'owner' | 'moderator' | 'viewer'
let capabilityMode: CapabilityMode = 'owner'
let hostBack: (() => void) | null = null
type Metrics = { calls: Array<{ path: string; method: string; ids?: number }>; gates: Gate[]; holdNext: 'list' | 'create' | 'summary' | null; patchMode: 'none' | 'forbidden-readable' | 'forbidden-denied' | 'version-conflict' | 'deleted-conflict' | 'delete-version-conflict'; denyFamily: boolean; currentBody: string | null; createdCount: number; deleted: boolean; configure: (action: string) => void; release: (kind: Gate['kind']) => void; snapshot: () => { keys: Array<readonly unknown[]>; data: unknown[]; entries: Array<{ key: readonly unknown[]; data: unknown }>; open: boolean; scope: { accountId: string; familyId: string; membershipEpoch: number; memoryId: string }; summaries: number; targetSummaryCount: number | undefined } }
const metrics: Metrics = { calls: [], gates: [], holdNext: null, patchMode: 'none', denyFamily: false, currentBody: null, createdCount: 0, deleted: false, configure: () => undefined, release: () => undefined, snapshot: () => ({ keys: [], data: [], entries: [], open: false, scope: A, summaries: 0, targetSummaryCount: undefined }) }
const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } })
;(window as unknown as { __commentsState: Metrics }).__commentsState = metrics

function fixture(body = 'Existing comment', id = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', version = 1, ordinal = 1): CommentDto {
  const time = new Date(Date.UTC(2026, 9, 1, 12, ordinal)).toISOString()
  return { id, familyId: A.familyId, memoryId: A.memoryId, author: { id: A.accountId, name: 'Тест', avatarPath: null, avatarCrop: null }, body, createdAt: time, updatedAt: time, version, capabilities: { edit: true, delete: true } }
}
function page(items = Array.from({ length: 20 }, (_, i) => fixture(`Existing comment ${i + 1}`, `cccccccc-cccc-4ccc-8ccc-${String(i + 1).padStart(12, '0')}`, 1, i)), nextCursor: string | null = null, summaryCount = items.length): CommentPage {
  const capabilities = capabilityMode === 'owner' ? { edit: true, delete: true } : capabilityMode === 'moderator' ? { edit: false, delete: true } : { edit: false, delete: false }
  const ordered = items.map((item) => ({ ...item, capabilities })).sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt) || right.id.localeCompare(left.id))
  return { items: ordered, nextCursor, summary: { memoryId: A.memoryId, count: summaryCount, capabilities: { read: true, create: true } } }
}

export function Harness() {
  const [scope, setScope] = useState(A)
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(true)
  const transport = useMemo<AuthenticatedTransport>(() => ({ raw: async () => new Response('', { status: 404 }), request: (async (path: string, _schema: unknown, options?: { method?: string; body?: { memoryIds?: string[]; body?: string }; signal?: AbortSignal }) => {
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
      if (patchMode === 'forbidden-denied') { metrics.denyFamily = true; throw new ApiRequestError(403, 'ROLE_FORBIDDEN', 'Synthetic read revoked') }
      const gate: Gate = { kind: 'list', path, aborted: false, completed: false, resolve: () => undefined }
      if (options?.signal) options.signal.addEventListener('abort', () => { gate.aborted = true }, { once: true })
      const held = metrics.holdNext === 'list'
      if (held) { metrics.holdNext = null; metrics.gates.push(gate); await new Promise<void>((resolve) => { gate.resolve = () => resolve() }) }
      if (held) { gate.completed = true; return page([fixture('late-old-context-private')], null) }
      if (path.includes('cursor=older')) return { ...page(Array.from({ length: 20 }, (_, i) => { const item = fixture(`Earlier ${i + 1}`, `dddddddd-dddd-4ddd-8ddd-${String(i + 1).padStart(12, '0')}`, 1, i); item.createdAt = new Date(Date.UTC(2026, 8, 30, 12, i)).toISOString(); item.updatedAt = item.createdAt; return item }), null) }
      if (patchMode === 'deleted-conflict') return page([], null)
      if (patchMode === 'version-conflict' || patchMode === 'delete-version-conflict') return page(Array.from({ length: 20 }, (_, i) => fixture(i === 0 ? 'Server updated comment' : `Existing comment ${i + 1}`, `cccccccc-cccc-4ccc-8ccc-${String(i + 1).padStart(12, '0')}`, i === 0 ? 2 : 1, i)), 'older')
      const newScope = path.includes(B.familyId) || path.includes(B.memoryId)
      const currentItems = Array.from({ length: metrics.deleted ? 19 : 20 }, (_, i) => {
        const ordinal = i + (metrics.deleted ? 1 : 0)
        return fixture(ordinal === 0 && metrics.currentBody ? metrics.currentBody : `Existing comment ${ordinal + 1}`, `cccccccc-cccc-4ccc-8ccc-${String(ordinal + 1).padStart(12, '0')}`, ordinal === 0 && metrics.currentBody ? 3 : 1, ordinal)
      })
      return page(metrics.deleted || metrics.currentBody ? currentItems : newScope ? [fixture('Fresh scope comment', 'ffffffff-ffff-4fff-8fff-ffffffffffff')] : undefined, metrics.deleted || metrics.currentBody ? 'older' : newScope ? null : 'older', 20 + metrics.createdCount - (metrics.deleted ? 1 : 0))
    }
    if (method === 'DELETE') { metrics.deleted = true; return { deletedId: 'cccccccc-cccc-4ccc-8ccc-000000000001', summary: { memoryId: A.memoryId, count: 19 + metrics.createdCount, capabilities: { read: true, create: true } } } }
    if (create) {
      const gate: Gate = { kind: 'create', path, body: options?.body?.body, aborted: false, completed: false, resolve: () => undefined }
      if (options?.signal) options.signal.addEventListener('abort', () => { gate.aborted = true }, { once: true })
      if (metrics.holdNext === 'create') { metrics.holdNext = null; metrics.gates.push(gate); await new Promise<void>((resolve) => { gate.resolve = () => resolve() }); gate.completed = true }
      if (!gate.aborted) { metrics.currentBody = gate.body ?? 'Late private body'; metrics.createdCount += 1 }
      return { comment: fixture(gate.body ?? 'Late private body', 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'), summary: { memoryId: A.memoryId, count: 20 + metrics.createdCount, capabilities: { read: true, create: true } } }
    }
    if (method === 'PATCH') { metrics.currentBody = options?.body?.body ?? 'Saved edit'; return { comment: fixture(metrics.currentBody, 'cccccccc-cccc-4ccc-8ccc-000000000001', 3), summary: { memoryId: A.memoryId, count: 20 + metrics.createdCount - (metrics.deleted ? 1 : 0), capabilities: { read: true, create: true } } } }
    if (path.endsWith('/comment-summaries')) {
      if (metrics.denyFamily) throw new ApiRequestError(403, 'ROLE_FORBIDDEN', 'Synthetic summary read revoked')
      const gate: Gate = { kind: 'summary', path, aborted: false, completed: false, resolve: () => undefined }
      const summaries = (options?.body?.memoryIds ?? []).map((memoryId) => ({ memoryId, count: memoryId === A.memoryId ? 20 + metrics.createdCount - (metrics.deleted ? 1 : 0) : 1, capabilities: { read: true, create: true } }))
      if (options?.signal) options.signal.addEventListener('abort', () => { gate.aborted = true }, { once: true })
      if (metrics.holdNext === 'summary') { metrics.holdNext = null; metrics.gates.push(gate); await new Promise<void>((resolve) => { gate.resolve = () => resolve() }); gate.completed = true }
      return { items: summaries }
    }
    throw new Error(`Unexpected comments harness request ${method} ${path}`)
  }) as AuthenticatedTransport['request'] }), [])
  const summaries = useCommentSummaries(transport, scope.familyId, scope.accountId, scope.membershipEpoch, [A.memoryId, ...Array.from({ length: 59 }, (_, i) => `90000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`)], active)
  const configure = useCallback((action: string) => {
    if (action === 'host-back') { hostBack?.(); return }
    if (action === 'summary-race') {
      metrics.holdNext = 'summary'
      void queryClient.invalidateQueries({ queryKey: [...commentsQueryKeys.all, A.familyId, A.accountId, A.membershipEpoch, 'summaries'] })
      return
    }
    if (action === 'owner' || action === 'moderator' || action === 'viewer') { capabilityMode = action; return }
    if (action === 'family') { setOpen(false); void removePrivateFamilyCache(queryClient, scope.accountId, scope.familyId); const next = { ...B, accountId: scope.accountId }; allowPrivateFamilyCache(next.accountId, next.familyId); window.setTimeout(() => { setScope(next); setOpen(true) }, 50) }
    if (action === 'epoch') { setOpen(false); void removePrivateFamilyCache(queryClient, scope.accountId, scope.familyId); allowPrivateFamilyCache(scope.accountId, scope.familyId); window.setTimeout(() => { setScope((current) => ({ ...current, membershipEpoch: current.membershipEpoch + 1 })); setOpen(true) }, 50) }
    if (action === 'account' || action === 'logout') { setOpen(false); window.setTimeout(() => { activatePrivateCacheIdentity(action === 'logout' ? null : B.accountId); queryClient.clear(); setScope({ ...B, accountId: action === 'logout' ? '' : B.accountId }); setOpen(action !== 'logout') }, 50) }
    if (action === 'revoke') { setOpen(false); setActive(false); metrics.denyFamily = true; window.dispatchEvent(new CustomEvent(privateFamilyAccessRevokedEvent, { detail: { userId: scope.accountId, familyId: scope.familyId } })); void removePrivateFamilyCache(queryClient, scope.accountId, scope.familyId) }
    if (action === 'open') setOpen(true)
  }, [scope])
  const snapshot = useCallback(() => {
    const entries = queryClient.getQueryCache().getAll().map((query) => ({ key: query.queryKey, data: query.state.data }))
    const targetSummary = entries.flatMap(({ key, data }) => key[0] === 'session' && key[1] === 'comments' && key[5] === 'summaries' && Array.isArray(data) ? data as Array<{ memoryId: string; count: number }> : []).find((item) => item.memoryId === A.memoryId)
    return { keys: entries.map((entry) => entry.key), data: entries.map((entry) => entry.data), entries, open, scope, summaries: summaries.size, targetSummaryCount: targetSummary?.count }
  }, [open, scope, summaries.size])
  const release = useCallback((kind: Gate['kind']) => { metrics.gates.filter((gate) => gate.kind === kind).forEach((gate) => gate.resolve()) }, [])
  useLayoutEffect(() => {
    metrics.configure = configure
    metrics.snapshot = snapshot
    metrics.release = release
  }, [configure, snapshot, release])
  return <main><button onClick={() => setOpen(true)}>Open comments</button><output data-testid="summary-count">{summaries.size}</output>{open ? <CommentsPanel familyTimezone="UTC" hostBridge={{ onBack: (callback) => { hostBack = callback; return () => { if (hostBack === callback) hostBack = null } } }} onClose={() => setOpen(false)} open scope={scope} transport={transport} returnFocusRef={{ current: null }} /> : null}</main>
}

export function CardGallery() {
  const types: MemoryDto['kind'][] = ['note', 'photo', 'video', 'voice', 'media']
  const reactions: Partial<Record<MemoryReaction, number>> = { heart: 123, love: 99, laugh: 81, touched: 32, wow: 24, clap: 11 }
  return <div className="memoly-app-root" data-ui-version="v2"><div data-memoly-feed>{types.map((kind, index) => <MemoryCardPresentation actions={<span />} authorInitials="T" authorName={index === 4 ? 'MAX channel attribution' : 'Synthetic author'} authorKind={index === 4 ? 'channel' : 'user'} body={`Synthetic ${kind} memory`} kind={kind} memoryId={`card-${kind}`} media={<div aria-hidden="true" className="card-fixture-media" />} onOpen={() => undefined} onReaction={() => undefined} occurredTime="12:00" reactionCounts={index === 1 ? reactions : {}} currentUserReaction={index === 1 ? 'heart' : null} commentCount={index === 0 ? 0 : index === 1 ? 12 : undefined} onComments={() => { document.body.dataset.lastCommentsTarget = `card-${kind}` }} key={kind} />)}</div></div>
}

activatePrivateCacheIdentity(A.accountId)
allowPrivateFamilyCache(A.accountId, A.familyId)
createRoot(document.getElementById('root')!).render(<QueryClientProvider client={queryClient}>{location.pathname.endsWith('/comments-cards.harness.html') ? <CardGallery /> : <Harness />}</QueryClientProvider>)
