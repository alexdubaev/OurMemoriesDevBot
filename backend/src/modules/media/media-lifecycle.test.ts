import { describe, expect, test } from 'bun:test'

import { runBackgroundJob } from '../../jobs'
import { createMediaTasks } from '.'

describe('media durable lifecycle', () => {
  test('keeps database keys when physical deletion fails so a retry can finish', async () => {
    let fail = true
    let marked = 0
    const asset = {
      id: '019c0000-0000-7000-8000-000000000001', familyId: 'family', originalKey: 'media-originals/2026/09/a',
      originalStatus: 'stored', byteSize: 80n, deletedAt: new Date(), storageDeletedAt: null,
      variants: [{ objectKey: 'media-display/2026/09/a' }],
    }
    const runtime: any = {
      privateStorage: { storage: { async deleteObject() { if (fail) throw new Error('offline') } } },
      prisma: {
        mediaAsset: { findUnique: async () => asset },
        $transaction: async (run: any) => run({
          mediaAsset: { updateMany: async () => ({ count: ++marked }) },
          family: { update: async () => ({}) },
        }),
      },
    }
    await expect(createMediaTasks(runtime).deleteAsset({ mediaId: asset.id })).rejects.toThrow('offline')
    expect(marked).toBe(0)
    fail = false
    await createMediaTasks(runtime).deleteAsset({ mediaId: asset.id })
    expect(marked).toBe(1)
  })

  test('daily reconciliation deletes only old objects with no database reference', async () => {
    const deleted: string[] = []
    const old = new Date('2026-09-01T00:00:00Z')
    const runtime: any = {
      privateStorage: { storage: {
        listObjects: async (prefix: string) => prefix === 'media-originals' ? [{ key: `${prefix}/orphan`, lastModified: old }] : [],
        deleteObject: async (key: string) => { deleted.push(key) },
      } },
      prisma: {
        mediaAsset: { findFirst: async () => null, findMany: async () => [] },
        mediaVariant: { findFirst: async () => null },
      },
    }
    await runBackgroundJob('media:orphans:reconcile', runtime, new Date('2026-09-10T00:00:00Z'))
    expect(deleted).toEqual(['media-originals/orphan'])
  })
})
