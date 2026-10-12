import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { createContext, runInContext } from 'node:vm'

const workerSource = readFileSync(new URL('../public/pwa-runtime-witness-v1.js', import.meta.url), 'utf8')
const journalBytes = 16_384
const slotBytes = 8_192

type Store = { bytes: Uint8Array; size: number; locked: boolean; shortWrite: number; openCount: number; asyncFlush: boolean; directoryGate?: Promise<void>; directoryCalls: number; clock?: { mono: number; wall: number }; monitor?: () => void }
type WitnessRecord = { runId: string; status?: string; storageReason?: string | null; evidence?: { kind?: string } | null; monitorGap?: { elapsedMs?: number } | null; updatedAt?: number }
type WorkerMessage = { type: string; status?: string; reason?: string | null; runId?: string; seq?: number; record?: WitnessRecord; records?: WitnessRecord[] }
type WorkerSelf = { onmessage?: (event: { data: unknown }) => void; postMessage: (message: WorkerMessage) => void }
type WorkerHarness = { messages: WorkerMessage[]; send: (message: unknown) => void; store: Store; waitReady: () => Promise<void>; waitRecord: (runId: string, status?: string) => Promise<WitnessRecord>; advance: (ms: number) => void; tick: () => void; waitMessage: (type: string) => Promise<WorkerMessage> }

function harnessFor(store: Store): WorkerHarness {
  const messages: WorkerMessage[] = []
  const access = {
    getSize: () => store.size,
    truncate(size: number) {
      const next = new Uint8Array(size)
      next.set(store.bytes.subarray(0, Math.min(store.bytes.length, size)))
      store.bytes = next
      store.size = size
    },
    read(buffer: Uint8Array, options: { at: number }) {
      const count = Math.min(buffer.length, Math.max(0, store.size - options.at))
      buffer.set(store.bytes.subarray(options.at, options.at + count), 0)
      return count
    },
    write(buffer: Uint8Array, options: { at: number }) {
      const count = store.shortWrite > 0 ? Math.min(buffer.length, store.shortWrite) : buffer.length
      store.shortWrite = 0
      store.bytes.set(buffer.subarray(0, count), options.at)
      return count
    },
    flush() { return store.asyncFlush ? Promise.resolve() : undefined },
    close() { store.locked = false },
  }
  const file = { async createSyncAccessHandle() {
    if (store.locked) throw new DOMException('locked', 'NoModificationAllowedError')
    store.locked = true
    store.openCount += 1
    return access
  } }
  const root = { async getFileHandle() { return file } }
  const self: WorkerSelf = { postMessage(message) { messages.push(message) } }
  const nativeDate = Date
  class WorkerDate extends nativeDate { static now() { return store.clock?.wall ?? nativeDate.now() } }
  const context = createContext({
    self,
    navigator: { storage: { async getDirectory() { store.directoryCalls += 1; if (store.directoryGate) await store.directoryGate; return root } } },
    TextEncoder,
    TextDecoder,
    setInterval: (callback: () => void) => { store.monitor = callback; return 1 },
    clearInterval,
    setTimeout,
    clearTimeout,
    performance: { now: () => store.clock?.mono ?? performance.now() },
    Date: WorkerDate,
    console,
  })
  runInContext(workerSource, context)
  const send = (message: unknown) => self.onmessage?.({ data: message })
  const waitFor = async (predicate: () => boolean) => {
    const deadline = Date.now() + 1500
    while (!predicate() && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 5))
    expect(predicate()).toBe(true)
  }
  const waitMessage = async (type: string) => { await waitFor(() => messages.some((message) => message.type === type)); return messages.filter((message) => message.type === type).at(-1)! }
  const waitChallenge = async (runId: string) => { await waitFor(() => messages.some((message) => message.type === 'challenge' && message.runId === runId)); return messages.filter((message) => message.type === 'challenge' && message.runId === runId).at(-1)! }
  return {
    messages,
    send,
    store,
    advance: (ms) => { if (store.clock) { store.clock.mono += ms; store.clock.wall += ms } },
    tick: () => store.monitor?.(),
    waitMessage,
    waitChallenge,
    waitReady: () => waitFor(() => messages.some((message) => message.type === 'ready')),
    waitRecord: async (runId, status) => {
      await waitFor(() => messages.some((message) => message.type === 'record' && message.record?.runId === runId && (!status || message.record?.status === status)))
      return messages.filter((message) => message.type === 'record' && message.record?.runId === runId).at(-1)!.record
    },
  }
}

function sample(runId: string, state: 'pagehide' | 'active', visibility: 'hidden' | 'visible') {
  const now = Date.now()
  return { runId, sentAt: now, documentTimeOrigin: now - 100, phase: 'mounted', state, visibility, lastObservedAt: now, lastHealthyAt: now, rootState: 'present', auth: null, cache: null, events: [], pagehidePersisted: false, pageshowPersisted: null }
}

function validSlots(store: Store) {
  let valid = 0
  for (let slot = 0; slot < 2; slot += 1) {
    const raw = new TextDecoder().decode(store.bytes.subarray(slot * slotBytes, (slot + 1) * slotBytes)).split('\0', 1)[0]
    try {
      const envelope = JSON.parse(raw)
      if (envelope.magic === 'MWJ1' && envelope.version === 1 && envelope.payload && Number.isSafeInteger(envelope.generation)) valid += 1
    } catch { /* unused or torn slot */ }
  }
  return valid
}

test('runtime witness journal keeps the last valid snapshot after a short write', async () => {
  const store: Store = { bytes: new Uint8Array(0), size: 0, locked: false, shortWrite: 0, openCount: 0, asyncFlush: false, directoryCalls: 0 }
  const runId = '11111111-1111-4111-8111-111111111111'
  const first = harnessFor(store)
  await first.waitReady()
  first.send({ type: 'sample', sample: sample(runId, 'active', 'visible') })
  await first.waitChallenge(runId)
  first.send({ type: 'sample', sample: sample(runId, 'pagehide', 'hidden') })
  await first.waitRecord(runId, 'ready')
  expect(store.size).toBe(journalBytes)
  expect(validSlots(store)).toBe(2)

  const writer = harnessFor(store)
  await writer.waitReady()
  store.shortWrite = 32
  writer.send({ type: 'sample', sample: sample(runId, 'active', 'visible') })
  await writer.waitChallenge(runId)
  writer.send({ type: 'sample', sample: sample(runId, 'pagehide', 'hidden') })
  const failed = await writer.waitRecord(runId, 'storage-unavailable')
  expect(failed.storageReason).toBe('journal-write-failed')
  expect(validSlots(store)).toBe(2)

  const recovery = harnessFor(store)
  await recovery.waitReady()
  const recoveredReady = recovery.messages.find((message) => message.type === 'ready')
  expect(recoveredReady.records).toHaveLength(1)
  expect(recoveredReady.records[0]).toMatchObject({ runId, status: 'ready' })
  expect(validSlots(store)).toBe(2)
})

test('runtime witness journal bounds storage to 16 KiB and the newest two runs', async () => {
  const store: Store = { bytes: new Uint8Array(0), size: 0, locked: false, shortWrite: 0, openCount: 0, asyncFlush: false, directoryCalls: 0 }
  const harness = harnessFor(store)
  await harness.waitReady()
  const runIds = [
    '11111111-1111-4111-8111-111111111111',
    '22222222-2222-4222-8222-222222222222',
    '33333333-3333-4333-8333-333333333333',
  ]
  for (let index = 0; index < runIds.length; index += 1) {
    if (index > 0) {
      harness.send({ type: 'sample', sample: sample(runIds[index], 'active', 'visible') })
      await harness.waitChallenge(runIds[index])
      const expectedOpenCount = index + 2
      const deadline = Date.now() + 1000
      while (store.openCount < expectedOpenCount && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 5))
      expect(store.openCount).toBe(expectedOpenCount)
    }
    if (index === 0) {
      harness.send({ type: 'sample', sample: sample(runIds[index], 'active', 'visible') })
      await harness.waitChallenge(runIds[index])
    }
    harness.send({ type: 'sample', sample: sample(runIds[index], 'pagehide', 'hidden') })
    await harness.waitRecord(runIds[index], 'ready')
    const closeDeadline = Date.now() + 1000
    while (store.locked && Date.now() < closeDeadline) await new Promise((resolve) => setTimeout(resolve, 5))
    expect(store.locked).toBe(false)
  }
  expect(store.size).toBe(journalBytes)
  expect(validSlots(store)).toBe(2)
  const newest = harness.messages.filter((message) => message.type === 'record').at(-1)!.record
  const latestSlot = [0, 1].map((slot) => {
    const raw = new TextDecoder().decode(store.bytes.subarray(slot * slotBytes, (slot + 1) * slotBytes)).split('\0', 1)[0]
    return JSON.parse(raw)
  }).sort((a, b) => b.generation - a.generation)[0]
  const storedIds = JSON.parse(latestSlot.payload).records.map((record: { runId: string }) => record.runId)
  expect(storedIds).toEqual([runIds[2], runIds[1]])
  expect(newest.runId).toBe(runIds[2])
})


test('runtime witness rejects Promise-returning access-handle methods as unavailable', async () => {
  const store: Store = { bytes: new Uint8Array(0), size: 0, locked: false, shortWrite: 0, openCount: 0, asyncFlush: true, directoryCalls: 0 }
  const worker = harnessFor(store)
  await worker.waitReady()
  const ready = worker.messages.find((message) => message.type === 'ready')
  expect(ready).toMatchObject({ status: 'storage-unavailable', reason: 'storage-sync-method-unavailable' })
  expect(store.locked).toBe(false)
})


function timedStore(): Store {
  return { bytes: new Uint8Array(0), size: 0, locked: false, shortWrite: 0, openCount: 0, asyncFlush: false, directoryCalls: 0, clock: { mono: 0, wall: 100_000 } }
}

async function startTimedProbe(harness: WorkerHarness, runId: string) {
  await harness.waitReady()
  harness.send({ type: 'sample', sample: sample(runId, 'active', 'visible') })
  const challenge = await harness.waitChallenge(runId)
  harness.send({ type: 'ack', seq: challenge.seq, runId, sample: sample(runId, 'active', 'visible') })
  for (let i = 0; i < 6; i += 1) { harness.advance(1000); harness.tick() }
  return harness.waitMessage('probe')
}

test('runtime witness confirms an overdue probe ACK before a due monitor callback', async () => {
  const store = timedStore()
  const harness = harnessFor(store)
  const runId = '44444444-4444-4444-8444-444444444444'
  const probe = await startTimedProbe(harness, runId)
  for (let i = 0; i < 9; i += 1) { harness.advance(1000); harness.tick() }
  harness.advance(1000)
  harness.send({ type: 'ack', seq: probe.seq, runId, sample: sample(runId, 'active', 'visible') })
  const deadline = Date.now() + 1000
  while (!harness.messages.some((message) => message.type === 'record' && message.record?.runId === runId && message.record.evidence?.kind === 'main-response-gap') && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 5))
  const record = harness.messages.filter((message) => message.type === 'record' && message.record?.runId === runId).at(-1)!.record
  expect(record.evidence).toMatchObject({ kind: 'main-response-gap', runId })
})

test('runtime witness treats a suspended worker as a neutral monitor gap on a late ACK', async () => {
  const store = timedStore()
  const harness = harnessFor(store)
  const runId = '55555555-5555-4555-8555-555555555555'
  const probe = await startTimedProbe(harness, runId)
  harness.advance(15_001)
  harness.send({ type: 'ack', seq: probe.seq, runId, sample: sample(runId, 'active', 'visible') })
  const deadline = Date.now() + 1000
  while (!harness.messages.some((message) => message.type === 'record' && message.record?.runId === runId && message.record.monitorGap) && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 5))
  const record = harness.messages.filter((message) => message.type === 'record' && message.record?.runId === runId).at(-1)!.record
  expect(record.evidence).toBeNull()
  expect(record.monitorGap?.elapsedMs).toBeGreaterThanOrEqual(15_000)
  expect(harness.messages.some((message) => message.type === 'challenge' && message.seq > probe.seq)).toBe(true)
})

test('runtime witness cancels an opening journal on hide and recovers with a fresh visible challenge', async () => {
  let release!: () => void
  const directoryGate = new Promise<void>((resolve) => { release = resolve })
  const store: Store = { bytes: new Uint8Array(0), size: 0, locked: false, shortWrite: 0, openCount: 0, asyncFlush: false, directoryCalls: 0, directoryGate }
  const harness = harnessFor(store)
  const runId = '66666666-6666-4666-8666-666666666666'
  const deadline = Date.now() + 1000
  while (store.directoryCalls === 0 && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 5))
  expect(store.directoryCalls).toBe(1)
  harness.send({ type: 'sample', sample: sample(runId, 'pagehide', 'hidden') })
  release()
  await harness.waitReady()
  expect(store.locked).toBe(false)
  expect(harness.messages.find((message) => message.type === 'ready')).toMatchObject({ status: 'awaiting-fresh-ack', reason: 'storage-open-cancelled' })
  harness.send({ type: 'sample', sample: sample(runId, 'active', 'visible') })
  await harness.waitChallenge(runId)
  expect(store.locked).toBe(true)
  expect(store.openCount).toBe(1)
})



test('runtime witness records a neutral gap when an overdue monitor tick clears the pending probe', async () => {
  const store = timedStore()
  const harness = harnessFor(store)
  const runId = '77777777-7777-4777-8777-777777777777'
  await startTimedProbe(harness, runId)
  for (let i = 0; i < 8; i += 1) { harness.advance(1000); harness.tick() }
  harness.advance(999)
  harness.tick()
  harness.advance(3002)
  harness.tick()
  const deadline = Date.now() + 1000
  while (!harness.messages.some((message) => message.type === 'record' && message.record?.runId === runId && message.record.monitorGap) && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 5))
  const record = harness.messages.filter((message) => message.type === 'record' && message.record?.runId === runId).at(-1)!.record
  expect(record.evidence).toBeNull()
  expect(record.monitorGap?.elapsedMs).toBeGreaterThan(10_000)
  expect(harness.messages.some((message) => message.type === 'challenge' && message.runId === runId)).toBe(true)
})
