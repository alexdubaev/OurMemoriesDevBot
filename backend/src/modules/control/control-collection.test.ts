import { describe, expect, test } from 'bun:test'
import { assertObservedAt, collectWithDeadline, deriveLastGood, readBoundedBody } from './infrastructure/control-collection'

describe('control metric boundaries', () => {
  test('keeps a measured zero distinct from unknown and preserves last-good value after a failed attempt', () => {
    const oldAt = new Date('2026-10-24T12:00:00.000Z')
    const now = new Date('2026-10-25T12:00:00.000Z')
    const sample = deriveLastGood([
      { value: null, observedAt: null, lastAttemptAt: now, status: 'error', errorCode: 'unavailable' },
      { value: 0, observedAt: oldAt, lastAttemptAt: oldAt, status: 'ok', errorCode: null },
    ], 60, now)
    expect(sample).toMatchObject({ value: 0, status: 'stale', observedAt: oldAt.toISOString(), lastAttemptAt: now.toISOString(), errorCode: 'unavailable' })
    expect(deriveLastGood([{ value: null, observedAt: null, lastAttemptAt: now, status: 'error', errorCode: 'timeout' }], 60, now)).toMatchObject({ value: null, status: 'error' })
  })

  test('cancels timed-out collection work and rejects future observations', async () => {
    let cancelled = false
    await expect(collectWithDeadline((signal) => new Promise<never>((_, reject) => signal.addEventListener('abort', () => { cancelled = signal.aborted; reject(signal.reason) }, { once: true })), 5)).rejects.toThrow()
    expect(cancelled).toBe(true)
    expect(() => assertObservedAt(new Date('2026-10-25T12:02:00Z'), new Date('2026-10-25T12:00:00Z'))).toThrow()
    const alreadyAborted=new AbortController(); alreadyAborted.abort(new Error('cancelled'))
    let started=false
    await expect(collectWithDeadline(async()=>{started=true; return 1},100,alreadyAborted.signal)).rejects.toThrow()
    expect(started).toBe(false)
  })

  test('caps HTTP body bytes before JSON parsing while allowing the literal zero payload', async () => {
    expect(await readBoundedBody(new Response('0'), 1)).toBe('0')
    await expect(readBoundedBody(new Response('12'), 1)).rejects.toThrow()
  })
})
