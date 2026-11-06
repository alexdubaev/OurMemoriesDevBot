import { expect, test } from 'bun:test'
import { ApiRequestError } from '../src/platform/api'
import { createMonthPhotoQueue } from '../src/features/albums/month-photo-queue'
import type { SourceRef } from '../src/features/albums/model'

const source = (sourceId: string): SourceRef => ({ memoryId: null, sourceKind: 'private_storage', sourceId })
const limited = (retryAfterMs?: number) => new ApiRequestError(429, 'RATE_LIMITED', 'Rate limited', { retryAfterMs })

test('month queue keeps the reserved slots and replays attach after a lost response without reuploading', async () => {
  const selection = Array.from({ length: 102 }, (_, index) => ({
    file: new File(['fixture'], `${index}.jpg`),
  }))
  const queue = createMonthPhotoQueue(selection)
  const uploads: string[] = []
  const batches: number[] = []
  const committed = new Map<string, { grant: string; offset: number; source: SourceRef }>()
  const deps = {
    reserve: async (count: number) => ({ grant: `batch-${batches.push(count)}` }),
    upload: async (file: File) => {
      uploads.push(file.name)
      return file.name
    },
    attach: async (body: { grant: string; offset: number; source: SourceRef }, key: string) => {
      const prior = committed.get(key)
      if (prior) {
        expect(body).toEqual(prior)
        return
      }
      committed.set(key, body)
      if (body.source.sourceId === '1.jpg') throw new TypeError('lost response after commit')
    },
  }
  const signal = new AbortController().signal

  await queue.run(deps, signal, () => {})
  expect(queue.snapshot()).toMatchObject({ total: 102, saved: 101, failed: 1 })
  expect(batches).toEqual([48, 48, 6])
  await queue.run(deps, signal, () => {})
  expect(queue.snapshot()).toMatchObject({ total: 102, saved: 102, failed: 0 })
  expect(uploads).toHaveLength(102)
  expect(committed.size).toBe(102)
  const ordered = [...committed.values()].sort((a, b) => a.grant.localeCompare(b.grant) || a.offset - b.offset)
  expect(ordered.map((item) => item.source.sourceId)).toEqual(selection.map(({ file }) => file.name))
})

test('stop during a transfer prevents attach and leaves confirmed work intact', async () => {
  const queue = createMonthPhotoQueue([{ source: source('already-selected') }, { file: new File(['fixture'], 'late.jpg') }, { source: source('remaining') }])
  const controller = new AbortController()
  const attachments: string[] = []

  await queue.run({
    reserve: async () => ({ grant: 'batch' }),
    upload: async () => { controller.abort(); return 'late-asset' },
    attach: async (body: { source: SourceRef }) => { attachments.push(body.source.sourceId) },
  }, controller.signal, () => {})

  expect(attachments).toEqual(['already-selected'])
  expect(queue.snapshot()).toMatchObject({ total: 3, saved: 1, failed: 0, pending: 2 })
})

test('429 waits for Retry-After and retries each phase with the original keys and upload receipt', async () => {
  const queue = createMonthPhotoQueue([{ file: new File(['fixture'], 'photo.jpg') }])
  const reserveKeys: string[] = []
  const uploadKeys: string[] = []
  const attachments: Array<{ body: { grant: string; offset: number; source: SourceRef }; key: string }> = []
  const waits: number[] = []
  let byteTransfers = 0

  await queue.run({
    reserve: async (_count, key) => {
      if (reserveKeys.push(key) === 1) throw limited(2)
      return { grant: 'original-batch' }
    },
    upload: async (_file, key, resume) => {
      uploadKeys.push(key)
      if (!resume.stored) {
        byteTransfers += 1
        resume.stored = { uploadId: 'upload', assetId: 'photo' }
        throw limited(3)
      }
      return resume.stored.assetId
    },
    attach: async (body, key) => {
      if (attachments.push({ body, key }) === 1) throw limited(4)
    },
  }, new AbortController().signal, () => {
    const delay = queue.snapshot().retryDelayMs
    if (delay !== null) waits.push(delay)
  })

  expect(waits).toEqual([2, 3, 4])
  expect(reserveKeys).toEqual([reserveKeys[0], reserveKeys[0]])
  expect(uploadKeys).toEqual([uploadKeys[0], uploadKeys[0]])
  expect(attachments).toEqual([attachments[0], attachments[0]])
  expect(attachments[0]?.body).toEqual({ grant: 'original-batch', offset: 0, source: source('photo') })
  expect(byteTransfers).toBe(1)
  expect(queue.snapshot()).toMatchObject({ saved: 1, pending: 0, failed: 0, retryDelayMs: null })
})

test('stop during the fallback rate-limit wait keeps pending work without retrying', async () => {
  const queue = createMonthPhotoQueue([{ source: source('pending') }])
  const controller = new AbortController()
  let attempts = 0
  let reportWait!: (ms: number) => void
  const waiting = new Promise<number>((resolve) => { reportWait = resolve })
  const completion = queue.run({
    reserve: async () => { attempts += 1; throw limited() },
    upload: async () => { throw new Error('unexpected upload') },
    attach: async () => { throw new Error('unexpected attach') },
  }, controller.signal, () => {
    const delay = queue.snapshot().retryDelayMs
    if (delay !== null) reportWait(delay)
  })

  const observed = await Promise.race([waiting, completion.then(() => null)])
  expect(observed).toBe(60_000)
  expect(attempts).toBe(1)
  controller.abort()
  await completion
  expect(attempts).toBe(1)
  expect(queue.snapshot()).toMatchObject({ saved: 0, pending: 1, failed: 0, running: false, retryDelayMs: null })
})

test('repeated 429 pauses the queue without sending requests for subsequent files', async () => {
  const queue = createMonthPhotoQueue([{ source: source('first') }, { source: source('second') }])
  const sent: Array<{ sourceId: string; key: string }> = []
  let accepting = false
  const operations = {
    reserve: async () => ({ grant: 'batch' }),
    upload: async () => { throw new Error('unexpected upload') },
    attach: async (body: { source: SourceRef }, key: string) => {
      sent.push({ sourceId: body.source.sourceId, key })
      if (!accepting) throw limited(0)
    },
  }
  const signal = new AbortController().signal

  await queue.run(operations, signal, () => {})
  expect(sent.map(({ sourceId }) => sourceId)).toEqual(['first', 'first', 'first'])
  expect(queue.snapshot()).toMatchObject({ saved: 0, pending: 2, failed: 0, queueError: expect.any(String) })

  accepting = true
  await queue.run(operations, signal, () => {})
  expect(sent[3]).toEqual(sent[0])
  expect(sent[4]?.sourceId).toBe('second')
  expect(queue.snapshot()).toMatchObject({ saved: 2, pending: 0, failed: 0, queueError: null })
})
