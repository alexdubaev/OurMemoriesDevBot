import { expect, test } from 'bun:test'
import { createMonthPhotoQueue } from '../src/features/albums/month-photo-queue'
import type { SourceRef } from '../src/features/albums/model'

const source = (sourceId: string): SourceRef => ({ memoryId: null, sourceKind: 'private_storage', sourceId })

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
