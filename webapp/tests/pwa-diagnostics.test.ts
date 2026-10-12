import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'

const sourcePath = new URL('../src/platform/diagnostics/bootstrap.js', import.meta.url)
type DiagnosticEvent = { target?: object; message?: string; reason?: unknown }
const statusRoot = (textContent: string) => {
  const textNode = { nodeType: 3, nodeValue: textContent }
  const paragraph = { tagName: 'P', childNodes: [textNode], getAttribute: (name: string) => name === 'role' ? 'status' : null }
  return { id: 'root', children: { length: 1 }, childNodes: [paragraph], firstElementChild: paragraph, contains: (node: unknown) => node === paragraph || node === textNode }
}

function startDiagnostics(storage: { getItem: (key: string) => string | null; setItem: (key: string, value: string) => void }, workerEnabled = false) {
  const listeners = new Map<string, Array<(event: unknown) => void>>()
  const documentListeners = new Map<string, Array<(event: DiagnosticEvent) => void>>()
  const timers = new Map<number, () => void>()
  let clock = 100000
  let timerId = 0
  let scans = 0
  let loadedImages = 0
  type FakeNode = { id?: string; tagName?: string; nodeType?: number; nodeValue?: string; childNodes?: Array<FakeNode>; children?: { length: number }; firstElementChild?: FakeNode; getAttribute?: (name: string) => string | null; contains?: (node: unknown) => boolean; querySelector?: (selector: string) => FakeNode | null }
  type FakeRoot = FakeNode & { textContent?: string }
  let root: FakeRoot | null = { id: 'root', children: { length: 1 }, childNodes: [{ tagName: 'DIV', childNodes: [] }], firstElementChild: { tagName: 'DIV', childNodes: [] } }
  const mutationCallbacks: Array<(records: Array<{ target: unknown; addedNodes: FakeNode[]; removedNodes: FakeNode[] }>) => void> = []
  let rootLookups = 0
  const fakeWorkers: FakeWorker[] = []
  class FakeWorker {
    private listeners = new Map<string, Array<(event: { data: unknown }) => void>>()
    constructor() { fakeWorkers.push(this) }
    addEventListener(name: string, listener: (event: { data: unknown }) => void) {
      const entries = this.listeners.get(name) ?? []
      entries.push(listener)
      this.listeners.set(name, entries)
    }
    postMessage() {}
    terminate() {}
    emit(data: unknown) { this.listeners.get('message')?.forEach((listener) => listener({ data })) }
  }
  class FakeMutationObserver {
    constructor(callback: (records: Array<{ target: unknown; addedNodes: FakeNode[]; removedNodes: FakeNode[] }>) => void) { mutationCallbacks.push(callback) }
    observe() {}
    disconnect() {}
  }
  class FakeImage { complete = true; naturalWidth = 1; currentSrc = ''; src = '' }
  class FakeMedia { readyState = 2; currentSrc = ''; src = '' }
  const window = {
    localStorage: storage,
    performance: { timeOrigin: 100000, getEntriesByType: (type: string) => type === 'navigation' ? [{ type: 'reload' }] : [] },
    addEventListener: (name: string, listener: (event: unknown) => void) => {
      const entries = listeners.get(name) ?? []
      entries.push(listener)
      listeners.set(name, entries)
    },
    setTimeout: (callback: () => void) => { timerId += 1; timers.set(timerId, callback); return timerId },
    clearTimeout: (id: number) => { timers.delete(id) },
    setInterval: (callback: () => void) => { timerId += 1; timers.set(timerId, callback); return timerId },
    clearInterval: (id: number) => { timers.delete(id) },
    Worker: workerEnabled ? FakeWorker : undefined,
    matchMedia: () => ({ matches: false }),
    location: { pathname: '/', origin: 'https://app.test', host: 'app.test', href: 'https://app.test/', hash: '#private=value' },
  }
  const document = {
    visibilityState: 'visible',
    documentElement: {},
    getElementById: (id: string) => { if (id === 'root') rootLookups += 1; return id === 'root' ? root : null },
    addEventListener: (name: string, listener: (event: DiagnosticEvent) => void) => {
      const entries = documentListeners.get(name) ?? []
      entries.push(listener)
      documentListeners.set(name, entries)
    },
    querySelectorAll: (selector: string) => { scans += 1; return selector === 'img' ? Array.from({ length: loadedImages }, () => new FakeImage()) : [] },
  }
  const source = (() => {
    try { return readFileSync(sourcePath, 'utf8') } catch { return '' }
  })()
  new Function('window', 'document', 'Date', 'HTMLImageElement', 'HTMLMediaElement', 'MutationObserver', 'navigator', source)(window, document, { now: () => clock }, FakeImage, FakeMedia, FakeMutationObserver, { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X) AppleWebKit/605.1.15', standalone: true })
  return {
    diagnostics: (window as typeof window & { __MEMOLY_DIAGNOSTICS__?: { record: (...args: unknown[]) => void; updateState: (area: 'auth' | 'cache', value: Record<string, boolean>) => void; report: () => string } }).__MEMOLY_DIAGNOSTICS__,
    advance: (milliseconds: number) => {
      clock += milliseconds
      const pending = [...timers.values()]
      timers.clear()
      pending.forEach((callback) => callback())
    },
    tick: (milliseconds: number) => { clock += milliseconds },
    dispatch: (name: string, event: unknown) => listeners.get(name)?.forEach((listener) => listener(event)),
    dispatchDocument: (name: string, event: unknown) => documentListeners.get(name)?.forEach((listener) => listener(event)),
    setLoadedImages: (count: number) => { loadedImages = count },
    createImage: () => new FakeImage(),
    scanCount: () => scans,
    rootLookupCount: () => rootLookups,
    setRoot: (value: typeof root) => {
      const previous = root
      root = value
      mutationCallbacks.forEach((callback) => callback([{ target: document.documentElement, addedNodes: value ? [value] : [], removedNodes: previous ? [previous] : [] }]))
    },
    dispatchUnrelatedMutation: () => mutationCallbacks.forEach((callback) => callback([{ target: {}, addedNodes: [{ tagName: 'DIV' }], removedNodes: [] }])),
    setVisibility: (value: 'visible' | 'hidden') => {
      document.visibilityState = value
      documentListeners.get('visibilitychange')?.forEach((listener) => listener({}))
    },
    dispatchError: (error: unknown) => listeners.get('error')?.forEach((listener) => listener({ error })),
    dispatchWorkerMessage: (message: unknown) => fakeWorkers.at(-1)?.emit(message),
  }
}

test('diagnostics rotate the previous run and discard unapproved stored fields', () => {
  const stored = JSON.stringify({
    current: { startedAt: 8, phase: 'mounted', lastFailure: { kind: 'error', at: 11, phase: 'mounted', message: 'private', url: 'https://private' }, events: [{ kind: 'error', at: 10, phase: 'mounted', message: 'family text', token: 'secret' }], counts: { images: 4, videos: 1, audio: 0, blobs: 0 }, secret: 'private' },
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
  expect(report.previous.lastFailure).toEqual({ kind: 'error', at: 11, phase: 'mounted' })
})

test('diagnostics bound event history, counts, serialized storage and writes', () => {
  let writes = 0
  let saved = ''
  const harness = startDiagnostics({ getItem: () => null, setItem: (_key, value) => { writes += 1; saved = value } })
  const diagnostics = harness.diagnostics

  expect(diagnostics).toBeDefined()
  for (let index = 0; index < 100; index += 1) diagnostics!.record('scroll', 'mounted', { images: 1_000_000 })
  harness.advance(2000)
  const report = JSON.parse(saved)
  expect(report.current.events.length).toBeLessThanOrEqual(24)
  expect(report.current.counts.images).toBeLessThanOrEqual(9999)
  expect(saved.length).toBeLessThanOrEqual(8192)
  expect(writes).toBe(2)
  expect(report.current.events.at(-1).kind).toBe('scroll')
})

test('a startup failure survives a media-load burst and reports fresh timestamped counts', () => {
  const harness = startDiagnostics({ getItem: () => null, setItem: () => undefined })
  const diagnostics = harness.diagnostics
  expect(diagnostics).toBeDefined()

  diagnostics!.record('error', 'mounted')
  for (let index = 0; index < 100; index += 1) { harness.tick(2001); diagnostics!.record('media-load') }
  let report = JSON.parse(diagnostics!.report())
  expect(report.current.lastFailure).toEqual({ kind: 'error', at: 100000, phase: 'mounted' })
  expect(report.current.events.length).toBeLessThanOrEqual(24)
  expect(report.current.events.some((event: { kind: string }) => event.kind === 'error')).toBe(false)
  expect(report.current.countsSampledAt).toBeGreaterThan(0)
  expect(report.current.counts.images).toBe(0)
  expect(harness.scanCount()).toBe(3)
  harness.setLoadedImages(7)
  report = JSON.parse(diagnostics!.report())
  expect(report.current.counts.images).toBe(7)
  expect(report.current.countsSampledAt).toBeGreaterThan(0)
  const scansBeforeBurst = harness.scanCount()
  for (let index = 0; index < 100; index += 1) harness.dispatchDocument('load', { target: harness.createImage() })
  expect(harness.scanCount()).toBe(scansBeforeBurst)
  harness.advance(2000)
  expect(harness.scanCount()).toBe(scansBeforeBurst + 3)
})

test('consecutive media-load events coalesce and retain the latest timestamp', () => {
  const harness = startDiagnostics({ getItem: () => null, setItem: () => undefined })
  const diagnostics = harness.diagnostics
  expect(diagnostics).toBeDefined()

  harness.tick(500)
  diagnostics!.record('media-load')
  harness.tick(500)
  diagnostics!.record('media-load')
  harness.tick(500)
  diagnostics!.record('media-load')

  const mediaLoads = JSON.parse(diagnostics!.report()).current.events.filter((event: { kind: string }) => event.kind === 'media-load')
  expect(mediaLoads).toHaveLength(1)
  expect(mediaLoads[0].at).toBe(101500)
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

test('mounted screen watch ignores initial preloader and ordinary valid root replacement', () => {
  const harness = startDiagnostics({ getItem: () => null, setItem: () => undefined })
  const diagnostics = harness.diagnostics!
  harness.setRoot(statusRoot('Загрузка memoLy…'))
  expect(JSON.parse(diagnostics.report()).incident).toBeNull()
  harness.setRoot(statusRoot('Лента'))
  diagnostics.record('mounted', 'mounted')
  harness.setRoot(statusRoot('Семья'))
  const report = JSON.parse(diagnostics.report())
  expect(report.current.rootState).toBe('present')
  expect(report.current.events.some((event: { kind: string }) => event.kind === 'root-replaced')).toBe(true)
  expect(report.incident).toBeNull()
  const lookupsBeforeUnrelatedMutation = harness.rootLookupCount()
  harness.dispatchUnrelatedMutation()
  expect(harness.rootLookupCount()).toBe(lookupsBeforeUnrelatedMutation)
})

test('mounted literal loading screen pins incident immediately and preserves it across launches', () => {
  let saved: string | null = null
  const storage = { getItem: () => saved, setItem: (_key: string, value: string) => { saved = value } }
  const harness = startDiagnostics(storage)
  const diagnostics = harness.diagnostics!
  diagnostics.record('mounted', 'mounted')
  harness.setRoot(statusRoot('Загрузка memoLy…'))
  const first = JSON.parse(saved!)
  expect(first.incident).toMatchObject({ kind: 'screen-loss', rootState: 'startup-placeholder' })
  expect(first.current.lastFailure.kind).toBe('screen-loss')
  expect(JSON.parse(startDiagnostics(storage).diagnostics!.report()).incident.kind).toBe('screen-loss')
  expect(JSON.parse(startDiagnostics(storage).diagnostics!.report()).incident.kind).toBe('screen-loss')
})

test('inferred unclosed incident refreshes to each latest eligible run but confirmed screen loss stays pinned', () => {
  let saved: string | null = JSON.stringify({ current: { startedAt: 90000, phase: 'mounted', state: 'active', build: 'index-legacy1.js', navigationType: 'reload', rootState: 'present', lastObservedAt: 99000, environment: { os: 'ios', osVersion: '16.1', webkitVersion: '605.1', standalone: true }, events: [] } })
  const storage = { getItem: () => saved, setItem: (_key: string, value: string) => { saved = value } }

  const firstLaunch = startDiagnostics(storage)
  firstLaunch.diagnostics!.record('mounted', 'mounted')
  const firstRun = JSON.parse(saved!).current
  expect(JSON.parse(saved!).incident).toMatchObject({ kind: 'previous-run-unclosed', build: 'index-legacy1.js' })

  const secondLaunch = startDiagnostics(storage)
  secondLaunch.diagnostics!.record('mounted', 'mounted')
  const secondRun = JSON.parse(saved!).current
  expect(JSON.parse(saved!).incident).toMatchObject({ kind: 'previous-run-unclosed', runId: firstRun.runId, navigationType: firstRun.navigationType, lastObservedAt: firstRun.lastObservedAt, environment: firstRun.environment })

  const thirdLaunch = startDiagnostics(storage)
  thirdLaunch.diagnostics!.record('mounted', 'mounted')
  const thirdRun = JSON.parse(saved!).current
  expect(JSON.parse(saved!).incident).toMatchObject({ kind: 'previous-run-unclosed', runId: secondRun.runId, lastObservedAt: secondRun.lastObservedAt })
  expect(JSON.parse(saved!).incident.runId).not.toBe(thirdRun.runId)

  const confirmed = JSON.parse(saved!)
  confirmed.incident = { ...confirmed.incident, kind: 'screen-loss', rootState: 'startup-placeholder' }
  saved = JSON.stringify(confirmed)
  const fourthLaunch = startDiagnostics(storage)
  fourthLaunch.diagnostics!.record('mounted', 'mounted')
  expect(JSON.parse(saved!).incident).toMatchObject({ kind: 'screen-loss', runId: secondRun.runId, rootState: 'startup-placeholder' })

  const normal = JSON.parse(saved!)
  normal.current.state = 'pagehide'
  saved = JSON.stringify(normal)
  const fifthLaunch = startDiagnostics(storage)
  fifthLaunch.diagnostics!.record('mounted', 'mounted')
  expect(JSON.parse(saved!).incident.kind).toBe('screen-loss')
  expect(thirdRun.runId).toBeDefined()
})

test('inferred evidence survives pagehide and same-source fallback without refreshing', () => {
  let saved: string | null = JSON.stringify({ current: { startedAt: 90000, runId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', phase: 'mounted', state: 'active', build: 'index-source1.js', rootState: 'present', events: [] } })
  const storage = { getItem: () => saved, setItem: (_key: string, value: string) => { saved = value } }
  const firstLaunch = startDiagnostics(storage)
  firstLaunch.diagnostics!.record('mounted', 'mounted')
  const first = JSON.parse(saved!)
  expect(first.incident.kind).toBe('previous-run-unclosed')

  first.current.state = 'pagehide'
  saved = JSON.stringify(first)
  startDiagnostics(storage).diagnostics!.record('mounted', 'mounted')
  const afterPagehide = JSON.parse(saved!)
  expect(afterPagehide.incident).toMatchObject({ kind: 'previous-run-unclosed', runId: first.incident.runId, sourceStartedAt: first.incident.sourceStartedAt })

  const fallback = JSON.parse(saved!)
  fallback.current = null
  fallback.previous = { ...fallback.previous, phase: 'mounted', state: 'active', startedAt: first.incident.sourceStartedAt, runId: first.incident.runId }
  saved = JSON.stringify(fallback)
  startDiagnostics(storage).diagnostics!.record('mounted', 'mounted')
  expect(JSON.parse(saved!).incident).toMatchObject({ kind: 'previous-run-unclosed', runId: first.incident.runId, at: first.incident.at })
})

test('mounted root removal pins loss while hidden mutations wait until visible', () => {
  let saved = ''
  const harness = startDiagnostics({ getItem: () => null, setItem: (_key, value) => { saved = value } })
  const diagnostics = harness.diagnostics!
  diagnostics.record('mounted', 'mounted')
  harness.setVisibility('hidden')
  harness.setRoot(null)
  expect(JSON.parse(diagnostics.report()).incident).toBeNull()
  harness.setVisibility('visible')
  expect(JSON.parse(saved).incident).toMatchObject({ kind: 'screen-loss', rootState: 'missing' })
  const emptyHarness = startDiagnostics({ getItem: () => null, setItem: (_key, value) => { saved = value } })
  emptyHarness.diagnostics!.record('mounted', 'mounted')
  emptyHarness.setRoot({ id: 'root', children: { length: 0 }, childNodes: [] })
  expect(JSON.parse(saved).incident).toMatchObject({ kind: 'screen-loss', rootState: 'empty' })
})

test('mounted snapshot flushes immediately and visible heartbeat persists freshness without DOM scans', () => {
  let saved = ''
  const harness = startDiagnostics({ getItem: () => null, setItem: (_key, value) => { saved = value } })
  harness.diagnostics!.record('mounted', 'mounted')
  const mounted = JSON.parse(saved).current
  expect(mounted.phase).toBe('mounted')
  expect(mounted.rootState).toBe('present')
  const scansBeforeHeartbeat = harness.scanCount()
  harness.advance(5000)
  const heartbeat = JSON.parse(saved).current
  expect(heartbeat.lastObservedAt).toBeGreaterThan(mounted.lastObservedAt)
  expect(harness.scanCount()).toBe(scansBeforeHeartbeat)
})

test('global app loading is observed without pinning screen loss and lifecycle lineage is retained', () => {
  let saved = ''
  const harness = startDiagnostics({ getItem: () => null, setItem: (_key, value) => { saved = value } })
  const loadingRoot = {
    id: 'root',
    children: { length: 1 },
    childNodes: [{ tagName: 'MAIN', childNodes: [] }],
    firstElementChild: { tagName: 'MAIN', childNodes: [] },
    querySelector: (selector: string) => selector === '[data-slot="app-loading"]' ? { tagName: 'MAIN' } : null,
  }
  harness.setRoot(loadingRoot)
  harness.diagnostics!.record('mounted', 'mounted')
  let report = JSON.parse(harness.diagnostics!.report())
  expect(report.current.rootState).toBe('app-loading')
  expect(report.current.lastHealthyAt).toBe(0)
  expect(report.incident).toBeNull()
  expect(report.current.events.map((event: { kind: string }) => event.kind)).toContain('app-loading')

  harness.setRoot({ id: 'root', children: { length: 1 }, childNodes: [{ tagName: 'DIV', childNodes: [] }], firstElementChild: { tagName: 'DIV', childNodes: [] } })
  report = JSON.parse(harness.diagnostics!.report())
  expect(report.current.rootState).toBe('present')
  expect(report.current.lastHealthyAt).toBeGreaterThan(0)
  expect(report.current.events.map((event: { kind: string }) => event.kind)).toContain('app-working')
  expect(report.witness.status).toBe('unavailable')
  expect(report.current.documentTimeOrigin).toBe(100000)

  harness.dispatch('pagehide', { persisted: true })
  harness.dispatch('pageshow', { persisted: true })
  report = JSON.parse(harness.diagnostics!.report())
  expect(report.current.pagehidePersisted).toBe(true)
  expect(report.current.pageshowPersisted).toBe(true)
  expect(report.current.runId).toMatch(/^[a-f0-9-]{8,40}$/)
  expect(saved.length).toBeLessThanOrEqual(8192)
})

test('oversized numeric environment versions are dropped and pinned incident remains under storage cap', () => {
  let saved = ''
  const malformedButBounded = JSON.stringify({
    current: { startedAt: 1000, phase: 'mounted', state: 'active', navigationType: 'reload', environment: { os: 'ios', osVersion: '9'.repeat(7000), webkitVersion: '1.2' }, events: [] },
  })
  expect(malformedButBounded.length).toBeLessThanOrEqual(8192)
  const harness = startDiagnostics({ getItem: () => malformedButBounded, setItem: (_key, value) => { saved = value } })
  harness.diagnostics!.record('mounted', 'mounted')
  harness.setRoot(statusRoot('Загрузка memoLy…'))
  const snapshot = JSON.parse(saved)
  expect(saved.length).toBeLessThanOrEqual(8192)
  expect(snapshot.incident.kind).toBe('screen-loss')
  expect(snapshot.previous.environment.osVersion).toBeNull()
  expect(harness.diagnostics!.report().length).toBeLessThanOrEqual(8192)
})

test('error and environment report only safe allowlisted fields', () => {
  const harness = startDiagnostics({ getItem: () => null, setItem: () => undefined })
  harness.dispatchError({ name: 'PrivateFamilyError', message: 'family name token=secret', stack: 'at x (https://app.test/assets/index-abcdef.js:12:3)\nat y (https://third.test/assets/index-zyxwvu.js:4:5)' })
  const report = harness.diagnostics!.report()
  expect(report).toContain('"os":"ios"')
  expect(report).toContain('"osVersion":"17.2"')
  expect(report).toContain('"standalone":true')
  expect(report).toContain('"asset":"index-abcdef.js"')
  expect(report).not.toContain('PrivateFamilyError')
  expect(report).not.toContain('family name')
  expect(report).not.toContain('third.test')
  expect(report).not.toContain('index-zyxwvu.js')
  expect(report).not.toContain('secret')
})

test('auth and cache state keep only the latest boolean transition', () => {
  const harness = startDiagnostics({ getItem: () => null, setItem: () => undefined })
  const diagnostics = harness.diagnostics!
  diagnostics.updateState('auth', { bootstrapping: true, authenticated: false, token: true })
  diagnostics.updateState('auth', { bootstrapping: false, authenticated: true })
  diagnostics.updateState('cache', { hydrated: true, familyName: true })
  const current = JSON.parse(diagnostics.report()).current
  expect(current.auth).toMatchObject({ bootstrapping: false, authenticated: true })
  expect(current.cache.hydrated).toBe(true)
  expect(JSON.stringify(current)).not.toContain('token')
  expect(JSON.stringify(current)).not.toContain('familyName')
  expect(current.events.map((event: { kind: string }) => event.kind)).toContain('auth-restoring')
  expect(current.events.map((event: { kind: string }) => event.kind)).toContain('auth-signed-in')
  expect(current.events.map((event: { kind: string }) => event.kind)).toContain('cache-ready')
})

test('two bounded worker records and pinned incident stay within the UTF-8 report limit', () => {
  const oldRunId = '11111111-1111-4111-8111-111111111111'
  const storage = {
    getItem: () => JSON.stringify({
      current: { startedAt: 90000, runId: oldRunId, phase: 'mounted', state: 'active', rootState: 'present', events: [] },
      incident: { kind: 'screen-loss', at: 99000, runId: oldRunId, rootState: 'empty', context: Array.from({ length: 6 }, (_, index) => ({ kind: 'media-load', at: 99000 + index, phase: 'mounted' })) },
    }),
    setItem: () => undefined,
  }
  const harness = startDiagnostics(storage, true)
  const diagnostics = harness.diagnostics!
  const initial = JSON.parse(diagnostics.report())
  const currentRunId = initial.current.runId
  const events = Array.from({ length: 6 }, (_, index) => ({ kind: 'media-load', at: 100000 + index, phase: 'mounted' }))
  const makeRecord = (runId: string) => {
    const sample = { runId, sentAt: 101000, documentTimeOrigin: 100000, phase: 'mounted', state: 'active', visibility: 'visible', lastObservedAt: 100999, lastHealthyAt: 100998, rootState: 'present', auth: { bootstrapping: true, authenticated: true, at: 100900 }, cache: { hydrated: true, at: 100901 }, events, pagehidePersisted: false, pageshowPersisted: false }
    return {
      runId,
      updatedAt: 101000,
      lastAckAt: 100950,
      sample,
      evidence: { kind: 'main-response-gap', runId, probeSeq: 12, sentAt: 100940, deadlineAt: 100950, evidenceAt: 100960, lastAckAt: 100930, visibilityAtLastAck: 'visible', sample },
      monitorGap: { fromAt: 100900, observedAt: 100950, elapsedMs: 50000, visibilityAtLastAck: 'visible' },
      storageReason: null,
      storage: { backend: 'opfs-sync', lastFlushAt: 101001, lastReadBackAt: 101002, gapReadBackAt: 101002 },
      status: 'ready',
    }
  }

  harness.dispatchWorkerMessage({ type: 'ready', status: 'ready', records: [makeRecord(currentRunId), makeRecord(oldRunId), makeRecord('22222222-2222-4222-8222-222222222222')] })
  const serialized = diagnostics.report()
  const report = JSON.parse(serialized)
  expect(new TextEncoder().encode(serialized).byteLength).toBeLessThanOrEqual(8192)
  expect(report.witness.records.map((record: { runId: string }) => record.runId).sort()).toEqual([currentRunId, oldRunId].sort())
  expect(report.witness.records.every((record: { evidence: { kind: string } }) => record.evidence.kind === 'main-response-gap')).toBe(true)
  expect(report.witness.records.every((record: { storage: { backend: string; gapReadBackAt: number } }) => record.storage.backend === 'opfs-sync' && record.storage.gapReadBackAt > 0)).toBe(true)
  expect(report.incident.kind).toBe('screen-loss')
})
