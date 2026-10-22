export const AVATAR_IDLE_TTL_MS = 30_000
export const AVATAR_IDLE_LIMIT_ENTRIES = 80
export const AVATAR_IDLE_LIMIT_BYTES = 10 * 1024 * 1024
export const AVATAR_IDLE_MAX_ENTRY_BYTES = 5 * 1024 * 1024

export type AvatarResource = { url: string; size: number }
export type AvatarResourceResult = { url: string | null; status: 'loading' | 'ready' | 'error'; error?: unknown }
const EMPTY_RESULT: AvatarResourceResult = Object.freeze({ url: null, status: 'loading' })

type Entry<Resource extends AvatarResource> = {
  key: string
  resource: Resource | null
  leases: number
  listeners: Set<(result: AvatarResourceResult) => void>
  controller: AbortController
  expiresAt: number | null
  timer: ReturnType<typeof setTimeout> | null
  lastUsedAt: number
  disposed: boolean
  snapshot: AvatarResourceResult
  onError?: (error: unknown) => void
}

export class AvatarResourcePool<Resource extends AvatarResource> {
  private readonly entries = new Map<string, Entry<Resource>>()
  private readonly subscribers = new Map<string, Set<() => void>>()
  private readonly revoke: (resource: Resource) => void
  private readonly now: () => number
  private readonly idleTtlMs: number
  private readonly idleLimitEntries: number
  private readonly idleLimitBytes: number
  private readonly idleMaxEntryBytes: number
  private readonly schedule: (callback: () => void, delayMs: number) => ReturnType<typeof setTimeout>
  private readonly cancel: (timer: ReturnType<typeof setTimeout>) => void

  constructor(
    revoke: (resource: Resource) => void,
    now = () => Date.now(),
    idleTtlMs = AVATAR_IDLE_TTL_MS,
    idleLimitEntries = AVATAR_IDLE_LIMIT_ENTRIES,
    idleLimitBytes = AVATAR_IDLE_LIMIT_BYTES,
    idleMaxEntryBytes = AVATAR_IDLE_MAX_ENTRY_BYTES,
    schedule: (callback: () => void, delayMs: number) => ReturnType<typeof setTimeout> = (callback, delayMs) => globalThis.setTimeout(callback, delayMs),
    cancel: (timer: ReturnType<typeof setTimeout>) => void = (timer) => globalThis.clearTimeout(timer),
  ) {
    this.revoke = revoke
    this.now = now
    this.idleTtlMs = idleTtlMs
    this.idleLimitEntries = idleLimitEntries
    this.idleLimitBytes = idleLimitBytes
    this.idleMaxEntryBytes = idleMaxEntryBytes
    this.schedule = schedule
    this.cancel = cancel
  }

  acquire(key: string, load: (signal: AbortSignal) => Promise<Resource>, listener: (result: AvatarResourceResult) => void, onError?: (error: unknown) => void) {
    this.expireIdle()
    let entry = this.entries.get(key)
    if (entry?.leases === 0 && entry.snapshot.status === 'error') {
      this.dispose(entry)
      entry = undefined
    }
    if (!entry || entry.disposed) {
      entry = {
        key,
        resource: null,
        leases: 0,
        listeners: new Set(),
        controller: new AbortController(),
        expiresAt: null,
        timer: null,
        lastUsedAt: this.now(),
        disposed: false,
        snapshot: EMPTY_RESULT,
        onError,
      }
      this.entries.set(key, entry)
      void this.load(entry, load)
    }
    this.clearIdleTimer(entry)
    entry.expiresAt = null
    entry.lastUsedAt = this.now()
    entry.leases += 1
    entry.listeners.add(listener)
    if (entry.snapshot.status !== 'loading') listener(entry.snapshot)
    let released = false
    return () => {
      if (released) return
      released = true
      entry!.listeners.delete(listener)
      entry!.leases = Math.max(0, entry!.leases - 1)
      entry!.lastUsedAt = this.now()
      if (entry!.leases === 0 && !entry!.disposed) {
        if (entry!.resource) this.markIdle(entry!)
        else this.dispose(entry!)
      }
    }
  }

  subscribe(key: string, listener: () => void) {
    let listeners = this.subscribers.get(key)
    if (!listeners) this.subscribers.set(key, listeners = new Set())
    listeners.add(listener)
    return () => {
      listeners!.delete(listener)
      if (!listeners!.size) this.subscribers.delete(key)
    }
  }

  getSnapshot(key: string) {
    return this.entries.get(key)?.snapshot ?? EMPTY_RESULT
  }

  invalidate(matches: (key: string) => boolean) {
    for (const entry of [...this.entries.values()]) {
      if (!matches(entry.key)) continue
      for (const listener of entry.listeners) listener({ url: null, status: 'loading' })
      this.dispose(entry)
    }
  }

  /** Exposed for deterministic lifecycle tests; production expiry also uses a timer. */
  expireIdle(now = this.now()) {
    for (const entry of [...this.entries.values()]) {
      if (entry.leases === 0 && entry.expiresAt !== null && entry.expiresAt <= now) this.dispose(entry)
    }
    this.enforceIdleBudget()
  }

  get size() {
    return this.entries.size
  }

  private async load(entry: Entry<Resource>, loadResource: (signal: AbortSignal) => Promise<Resource>) {
    try {
      const resource = await loadResource(entry.controller.signal)
      if (entry.disposed || entry.controller.signal.aborted || this.entries.get(entry.key) !== entry) {
        this.revoke(resource)
        return
      }
      entry.resource = resource
      this.publish(entry, { url: resource.url, status: 'ready' })
      if (entry.leases === 0) this.markIdle(entry)
    } catch (error) {
      if (entry.disposed || entry.controller.signal.aborted) return
      entry.onError?.(error)
      this.publish(entry, { url: null, status: 'error', error })
      if (entry.leases === 0) this.markIdle(entry)
    }
  }

  private markIdle(entry: Entry<Resource>) {
    entry.expiresAt = this.now() + this.idleTtlMs
    this.clearIdleTimer(entry)
    entry.timer = this.schedule(() => this.expireIdle(), this.idleTtlMs)
    this.enforceIdleBudget()
  }

  private enforceIdleBudget() {
    const idle = [...this.entries.values()].filter((entry) => entry.leases === 0 && entry.snapshot.status !== 'loading')
    let bytes = idle.reduce((total, entry) => total + (entry.resource?.size ?? 0), 0)
    idle.sort((left, right) => left.lastUsedAt - right.lastUsedAt)
    while (idle.length > this.idleLimitEntries || bytes > this.idleLimitBytes) {
      const oldest = idle.shift()
      if (!oldest) break
      bytes -= oldest.resource?.size ?? 0
      this.dispose(oldest)
    }
    for (const entry of idle) {
      if ((entry.resource?.size ?? 0) > this.idleMaxEntryBytes) this.dispose(entry)
    }
  }

  private dispose(entry: Entry<Resource>) {
    if (entry.disposed) return
    entry.disposed = true
    this.clearIdleTimer(entry)
    entry.controller.abort()
    if (this.entries.get(entry.key) === entry) this.entries.delete(entry.key)
    if (entry.resource) this.revoke(entry.resource)
    entry.resource = null
    entry.snapshot = EMPTY_RESULT
    entry.listeners.clear()
    for (const listener of this.subscribers.get(entry.key) ?? []) listener()
  }

  private publish(entry: Entry<Resource>, snapshot: AvatarResourceResult) {
    entry.snapshot = snapshot
    for (const listener of entry.listeners) listener(snapshot)
    for (const listener of this.subscribers.get(entry.key) ?? []) listener()
  }

  private clearIdleTimer(entry: Entry<Resource>) {
    if (entry.timer !== null) this.cancel(entry.timer)
    entry.timer = null
  }
}

export function isImmutableMemberAvatarPath(path: string) {
  return /^\/api\/v1\/families\/[0-9a-f-]{36}\/media\/avatars\/[0-9a-f-]{36}\/[0-9a-f-]{36}\/content$/i.test(path)
}
