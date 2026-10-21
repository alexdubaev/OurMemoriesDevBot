import { describe, expect, it } from 'bun:test'

import { AvatarResourcePool, isImmutableMemberAvatarPath } from '../src/platform/media/avatar-resource-pool'

const familyId = '11111111-1111-4111-8111-111111111111'
const memberId = '22222222-2222-4222-8222-222222222222'
const avatarId = '33333333-3333-4333-8333-333333333333'
const path = `/api/v1/families/${familyId}/media/avatars/${memberId}/${avatarId}/content`

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

function createPool(options: { ttl?: number; entries?: number; bytes?: number; perEntry?: number } = {}) {
  const revoked: string[] = []
  const scheduled: Array<() => void> = []
  const pool = new AvatarResourcePool<{ url: string; size: number }>(
    (resource) => revoked.push(resource.url),
    () => 100,
    options.ttl ?? 30,
    options.entries ?? 80,
    options.bytes ?? 10,
    options.perEntry ?? 10,
    (callback) => { scheduled.push(callback); return 1 as ReturnType<typeof setTimeout> },
    () => undefined,
  )
  return { pool, revoked, scheduled }
}

describe('member avatar resource lifecycle', () => {
  it('limits the shared pool to immutable member-avatar paths', () => {
    expect(isImmutableMemberAvatarPath(path)).toBe(true)
    expect(isImmutableMemberAvatarPath(`${path}?v=2`)).toBe(false)
    expect(isImmutableMemberAvatarPath(`/api/v1/families/${familyId}/media/max-channels/42/avatar`)).toBe(false)
    expect(isImmutableMemberAvatarPath('/api/uploads/avatar/content?avatar=abc')).toBe(false)
  })

  it('shares one in-flight load and reuses a warm URL across leases until the last release', async () => {
    const { pool, revoked } = createPool()
    const pending = deferred<{ url: string; size: number }>()
    let loads = 0
    const results: Array<string | null> = []
    const load = () => { loads += 1; return pending.promise }
    const releaseFeed = pool.acquire(`scope:${path}`, load, (result) => results.push(result.url))
    const releaseComments = pool.acquire(`scope:${path}`, load, (result) => results.push(result.url))
    expect(loads).toBe(1)
    pending.resolve({ url: 'blob:avatar-v1', size: 4 })
    await Promise.resolve()
    await Promise.resolve()
    expect(results).toEqual(['blob:avatar-v1', 'blob:avatar-v1'])
    releaseFeed()
    expect(revoked).toEqual([])

    const reopened: Array<string | null> = []
    const releaseReopened = pool.acquire(`scope:${path}`, load, (result) => reopened.push(result.url))
    expect(reopened).toEqual(['blob:avatar-v1'])
    expect(loads).toBe(1)
    releaseComments()
    expect(revoked).toEqual([])
    releaseReopened()
    pool.expireIdle(131)
    expect(revoked).toEqual(['blob:avatar-v1'])
  })

  it('keeps an over-budget image visible to live leases and revokes it only after release', async () => {
    const { pool, revoked } = createPool({ perEntry: 5 })
    const visible: Array<string | null> = []
    const release = pool.acquire('large-avatar', async () => ({ url: 'blob:large', size: 6 }), (result) => visible.push(result.url))
    await Promise.resolve()
    await Promise.resolve()
    expect(visible).toEqual(['blob:large'])
    expect(revoked).toEqual([])
    release()
    expect(revoked).toEqual(['blob:large'])
  })

  it('enforces idle LRU byte limits without evicting a live resource', async () => {
    const { pool, revoked } = createPool({ entries: 1, bytes: 5 })
    const releaseOld = pool.acquire('old', async () => ({ url: 'blob:old', size: 4 }), () => undefined)
    await Promise.resolve()
    await Promise.resolve()
    releaseOld()
    const releaseLive = pool.acquire('live', async () => ({ url: 'blob:live', size: 4 }), () => undefined)
    await Promise.resolve()
    await Promise.resolve()
    expect(revoked).toEqual([])
    expect(pool.size).toBe(2)
    releaseLive()
    expect(revoked).toEqual(['blob:old'])
    pool.expireIdle(131)
    expect(revoked).toEqual(['blob:old', 'blob:live'])
  })

  it('aborts and revokes synchronously on scope invalidation and drops late results', async () => {
    const { pool, revoked } = createPool()
    const pending = deferred<{ url: string; size: number }>()
    let signal: AbortSignal | undefined
    const results: Array<string | null> = []
    pool.acquire(`user:family:${path}`, (loadSignal) => { signal = loadSignal; return pending.promise }, (result) => results.push(result.url))
    pool.invalidate((key) => key.startsWith('user:family:'))
    expect(signal?.aborted).toBe(true)
    expect(results).toEqual([null])
    pending.resolve({ url: 'blob:late', size: 4 })
    await Promise.resolve()
    await Promise.resolve()
    expect(results).toEqual([null])
    expect(revoked).toEqual(['blob:late'])
  })

  it('disposes unfinished loads on last release so abandoned pending entries cannot accumulate', async () => {
    const { pool, revoked, scheduled } = createPool()
    const pendingLoads: Array<ReturnType<typeof deferred<{ url: string; size: number }>>> = []
    const signals: AbortSignal[] = []
    for (let index = 0; index < 10; index += 1) {
      const pending = deferred<{ url: string; size: number }>()
      pendingLoads.push(pending)
      const release = pool.acquire(`pending-${index}`, (signal) => {
        signals.push(signal)
        return pending.promise
      }, () => undefined)
      release()
      expect(pool.size).toBe(0)
    }
    expect(signals.every((signal) => signal.aborted)).toBe(true)
    expect(scheduled).toHaveLength(0)
    pendingLoads.forEach((pending, index) => pending.resolve({ url: `blob:late-${index}`, size: 1 }))
    await Promise.resolve()
    await Promise.resolve()
    expect(pool.size).toBe(0)
    expect(revoked).toHaveLength(10)
  })

  it('keeps avatar versions in separate entries while crop remains presentation-only', async () => {
    const { pool } = createPool()
    const first = path
    const second = path.replace(avatarId, '44444444-4444-4444-8444-444444444444')
    let loads = 0
    const load = async () => ({ url: `blob:${++loads}`, size: 1 })
    const releaseFirst = pool.acquire(`scope:${first}`, load, () => undefined)
    const releaseCroppedUse = pool.acquire(`scope:${first}`, load, () => undefined)
    const releaseNewVersion = pool.acquire(`scope:${second}`, load, () => undefined)
    await Promise.resolve()
    await Promise.resolve()
    expect(loads).toBe(2)
    releaseFirst()
    releaseCroppedUse()
    releaseNewVersion()
  })
})
