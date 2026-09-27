import type { AuthenticatedTransport } from '@/platform/api'
import { ApiRequestError } from '@/platform/api'

export const SEEN_BATCH_LIMIT = 50
const MAX_PENDING_PER_SCOPE = 200
const MAX_CONFIRMED_PER_SCOPE = 1_000
const FLUSH_DELAY_MS = 120
const RETRY_DELAYS_MS = [2_000, 5_000, 10_000, 30_000] as const

export type SeenScope = { accountId: string; familyId: string; membershipEpoch: number }
type ScopeState = {
  scope: SeenScope
  pending: Set<string>
  confirmed: Set<string>
  inFlight: Set<string>
  timer: ReturnType<typeof setTimeout> | null
  busy: boolean
  cancelled: boolean
  failures: number
  isolateMissing: boolean
}

export class SeenBatchQueue {
  private states = new Map<string, ScopeState>()
  private disposed = false
  private readonly accountId: string
  private readonly transport: Pick<AuthenticatedTransport, 'raw'>
  private readonly onAcknowledged: (scope: SeenScope, ids: string[]) => void
  private readonly onRejected: (scope: SeenScope, reason: 'epoch' | 'missing') => void

  constructor(
    accountId: string,
    transport: Pick<AuthenticatedTransport, 'raw'>,
    onAcknowledged: (scope: SeenScope, ids: string[]) => void,
    onRejected: (scope: SeenScope, reason: 'epoch' | 'missing') => void,
  ) {
    this.accountId = accountId
    this.transport = transport
    this.onAcknowledged = onAcknowledged
    this.onRejected = onRejected
  }

  enqueue(scope: SeenScope, id: string) {
    if (this.disposed || scope.accountId !== this.accountId) return
    const key = scopeKey(scope)
    let state = this.states.get(key)
    if (!state) {
      state = { scope: { ...scope }, pending: new Set(), confirmed: new Set(), inFlight: new Set(), timer: null, busy: false, cancelled: false, failures: 0, isolateMissing: false }
      this.states.set(key, state)
    }
    if (state.cancelled || state.pending.has(id) || state.inFlight.has(id) || state.confirmed.has(id)) return
    if (state.pending.size >= MAX_PENDING_PER_SCOPE) return
    state.pending.add(id)
    this.schedule(state, FLUSH_DELAY_MS)
  }

  resume() {
    if (this.disposed) return
    for (const state of this.states.values()) {
      if (state.timer) { clearTimeout(state.timer); state.timer = null }
      if (state.pending.size > 0) this.schedule(state, 0)
    }
  }

  cancelScope(scope: SeenScope) {
    const key = scopeKey(scope)
    const state = this.states.get(key)
    if (!state) return
    state.cancelled = true
    if (state.timer) clearTimeout(state.timer)
    state.pending.clear()
    state.inFlight.clear()
    this.states.delete(key)
  }

  cancelFamily(familyId: string) {
    for (const [, state] of this.states) {
      if (state.scope.familyId !== familyId) continue
      this.cancelScope(state.scope)
    }
  }

  dispose() {
    this.disposed = true
    for (const state of this.states.values()) {
      state.cancelled = true
      if (state.timer) clearTimeout(state.timer)
      state.pending.clear()
      state.inFlight.clear()
    }
    this.states.clear()
  }

  private schedule(state: ScopeState, delay: number) {
    if (state.cancelled || state.busy || state.timer || this.disposed || state.pending.size === 0) return
    state.timer = setTimeout(() => { state.timer = null; void this.flush(state) }, delay)
  }

  private async flush(state: ScopeState) {
    if (state.cancelled || this.disposed || state.busy || state.pending.size === 0) return
    if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return
    state.busy = true
    const ids = [...state.pending].slice(0, state.isolateMissing ? 1 : SEEN_BATCH_LIMIT)
    ids.forEach((id) => { state.pending.delete(id); state.inFlight.add(id) })
    try {
      await this.transport.raw(`/api/v1/families/${encodeURIComponent(state.scope.familyId)}/memories/seen`, {
        method: 'POST',
        body: { memoryIds: ids, expectedMembershipEpoch: state.scope.membershipEpoch },
      })
      if (state.cancelled || this.disposed) return
      state.failures = 0
      for (const id of ids) {
        state.inFlight.delete(id)
        state.confirmed.add(id)
        if (state.confirmed.size > MAX_CONFIRMED_PER_SCOPE) state.confirmed.delete(state.confirmed.values().next().value!)
      }
      this.onAcknowledged(state.scope, ids)
    } catch (error) {
      if (state.cancelled || this.disposed) return
      ids.forEach((id) => state.inFlight.delete(id))
      if (error instanceof ApiRequestError && error.status === 409 && error.code === 'VERSION_CONFLICT') {
        this.cancelScope(state.scope)
        this.onRejected(state.scope, 'epoch')
        return
      }
      if (error instanceof ApiRequestError && [403, 404].includes(error.status)) {
        // B4 rejects an entire batch if one memory was deleted. Isolate it so valid IDs survive.
        if (error.status === 404 && ids.length > 1) {
          ids.forEach((id) => state.pending.add(id))
          state.isolateMissing = true
          state.failures = 1
        }
        this.onRejected(state.scope, 'missing')
        return
      }
      ids.forEach((id) => state.pending.add(id))
      state.failures += 1
    } finally {
      state.busy = false
      if (state.pending.size === 0) state.isolateMissing = false
      if (!state.cancelled && !this.disposed && state.pending.size > 0) {
        const delay = state.failures === 0 ? FLUSH_DELAY_MS : RETRY_DELAYS_MS[Math.min(state.failures - 1, RETRY_DELAYS_MS.length - 1)]
        this.schedule(state, delay)
      }
    }
  }
}

function scopeKey(scope: SeenScope) {
  return `${scope.accountId}:${scope.familyId}:${scope.membershipEpoch}`
}
