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

  test('deletes the deterministic private video poster key even if its variant relation was never committed', async () => {
    const deletedKeys: string[] = []
    const asset = {
      id: '019c0000-0000-7000-8000-000000000002', familyId: 'family',
      originalKey: 'media-originals/2026/09/video.mp4', mediaKind: 'video',
      originalStatus: 'stored', byteSize: 80n, deletedAt: new Date(), storageDeletedAt: null,
      variants: [],
    }
    const runtime: any = {
      privateStorage: { storage: { async deleteObject(key: string) { deletedKeys.push(key) } } },
      prisma: {
        mediaAsset: { findUnique: async () => asset },
        $transaction: async (run: any) => run({
          $queryRaw: async () => [],
          mediaAsset: { findUnique: async () => asset, updateMany: async () => ({ count: 1 }) },
          family: { update: async () => ({}) },
        }),
      },
    }
    await createMediaTasks(runtime).deleteAsset({ mediaId: asset.id })
    expect(deletedKeys).toContain('media-preview/2026/09/video.mp4.poster-v1.jpg')
  })

  test('poster extraction failure leaves the source playback state untouched', async () => {
    const asset = {
      id: '019c0000-0000-7000-8000-000000000003', familyId: 'family', uploaderId: 'user',
      originalKey: 'media-originals/2026/09/video.mp4', mediaKind: 'video', purpose: 'memory',
      originalStatus: 'stored', renditionStatus: 'pending', storageDeletedAt: null, deletedAt: null,
      byteSize: 80n, variants: [], durationMs: null, width: null, height: null,
    }
    let transactions = 0
    const runtime: any = {
      privateStorage: { storage: { readObject: async () => null } },
      prisma: {
        mediaAsset: { findUnique: async () => asset, updateMany: async () => ({ count: 1 }) },
        $transaction: async () => { transactions += 1 },
      },
      env: { FFMPEG_PATH: undefined, FFPROBE_PATH: undefined, PRIVATE_STORAGE_UPLOAD_MAX_BYTES: 100 },
    }
    await expect(createMediaTasks(runtime).createVideoPoster({ mediaId: asset.id })).rejects.toThrow('missing')
    expect(transactions).toBe(0)
    expect(asset).toMatchObject({ renditionStatus: 'pending', durationMs: null, width: null, height: null })
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
