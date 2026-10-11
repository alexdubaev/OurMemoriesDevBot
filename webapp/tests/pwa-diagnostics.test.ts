import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'

const sourcePath = new URL('../src/platform/diagnostics/bootstrap.js', import.meta.url)

function startDiagnostics(storage: { getItem: (key: string) => string | null; setItem: (key: string, value: string) => void }) {
  const listeners = new Map<string, Array<(event: unknown) => void>>()
  const timers = new Map<number, () => void>()
  let clock = 100000
  let timerId = 0
  const window = {
    localStorage: storage,
    location: { pathname: '/', hash: '#private=value' },
    performance: { getEntriesByType: (type: string) => type === 'navigation' ? [{ type: 'reload' }] : [] },
    addEventListener: (name: string, listener: (event: unknown) => void) => {
      const entries = listeners.get(name) ?? []
      entries.push(listener)
      listeners.set(name, entries)
    },
    setTimeout: (callback: () => void) => { timerId += 1; timers.set(timerId, callback); return timerId },
    clearTimeout: (id: number) => { timers.delete(id) },
  }
  const document = {
    visibilityState: 'visible',
    addEventListener: () => undefined,
    querySelectorAll: () => [],
  }
  const source = (() => {
    try { return readFileSync(sourcePath, 'utf8') } catch { return '' }
  })()
  new Function('window', 'document', 'Date', source)(window, document, { now: () => clock })
  return {
    diagnostics: (window as typeof window & { __MEMOLY_DIAGNOSTICS__?: { record: (...args: unknown[]) => void; report: () => string } }).__MEMOLY_DIAGNOSTICS__,
    advance: (milliseconds: number) => {
      clock += milliseconds
      const pending = [...timers.values()]
      timers.clear()
      pending.forEach((callback) => callback())
    },
    dispatch: (name: string, event: unknown) => listeners.get(name)?.forEach((listener) => listener(event)),
  }
}

test('diagnostics rotate the previous run and discard unapproved stored fields', () => {
  const stored = JSON.stringify({
    current: { startedAt: 8, phase: 'mounted', events: [{ kind: 'error', at: 10, phase: 'mounted', message: 'family text', token: 'secret' }], counts: { images: 4, videos: 1, audio: 0, blobs: 0 }, secret: 'private' },
    previous: { startedAt: 7, phase: 'hidden', events: [], counts: {} },
  })
  const { diagnostics } = startDiagnostics({ getItem: () => stored, setItem: () => undefined })

  expect(diagnostics).toBeDefined()
  const report = JSON.parse(diagnostics!.report())
  expect(report.previous.events[0]).toEqual({ kind: 'error', at: 10, phase: 'mounted' })
  expect(report.previous.secret).toBeUndefined()
  expect(report.previous.events[0].message).toBeUndefined()
  expect(report.current.events[0].kind).toBe('app-entry')
  expect(report.current.navigation).toBe('feed')
  expect(report.current.navigationType).toBe('reload')
  expect(JSON.stringify(report)).not.toContain('private')
  expect(JSON.stringify(report)).not.toContain('secret')
})

test('diagnostics bound event history, counts, serialized storage and writes', () => {
  let writes = 0
  let saved = ''
  const harness = startDiagnostics({ getItem: () => null, setItem: (_key, value) => { writes += 1; saved = value } })
  const diagnostics = harness.diagnostics

  expect(diagnostics).toBeDefined()
  for (let index = 0; index < 100; index += 1) diagnostics!.record('scroll', 'mounted', { images: 1_000_000 })
  const report = JSON.parse(diagnostics!.report())
  expect(report.current.events.length).toBeLessThanOrEqual(24)
  expect(report.current.counts.images).toBeLessThanOrEqual(9999)
  expect(saved.length).toBeLessThanOrEqual(8192)
  expect(writes).toBe(1)
  harness.advance(2000)
  expect(writes).toBe(2)
  expect(JSON.parse(saved).current.events.at(-1).kind).toBe('scroll')
})

test('storage failures never prevent diagnostics startup or report generation', () => {
  let writes = 0
  const harness = startDiagnostics({
    getItem: () => { throw new Error('private raw exception') },
    setItem: () => { writes += 1; throw new Error('storage unavailable') },
  })
  const diagnostics = harness.diagnostics

  expect(diagnostics).toBeDefined()
  expect(() => diagnostics!.record('error', 'mounted')).not.toThrow()
  expect(diagnostics!.report()).not.toContain('private raw exception')
  harness.dispatch('error', { message: 'family note and signed media URL' })
  harness.dispatch('unhandledrejection', { reason: 'private token' })
  expect(diagnostics!.report()).not.toContain('family note')
  expect(diagnostics!.report()).not.toContain('signed media URL')
  expect(diagnostics!.report()).not.toContain('private token')
  for (let index = 0; index < 40; index += 1) diagnostics!.record('scroll')
  expect(writes).toBe(1)
  harness.advance(2000)
  expect(writes).toBe(2)
})

test('oversized stored values are ignored before they can become report content', () => {
  const { diagnostics } = startDiagnostics({ getItem: () => 'x'.repeat(20000), setItem: () => undefined })
  expect(diagnostics).toBeDefined()
  expect(diagnostics!.report()).not.toContain('x'.repeat(100))
})
