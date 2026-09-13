import { expect, test } from 'bun:test'

import type { MediaAssetDto } from '@web-app-demo/contracts'

import type { PrivateStorage } from '../../../storage'
import type { FamilyScope } from '../../families'
import { MediaService } from './media-service'
import type { MediaRepository, PhotoProcessor } from './ports'

const scope: FamilyScope = {
  familyId: '0196f6f8-6600-7000-8000-000000000001',
  principal: { userId: '0196f6f8-6600-7000-8000-000000000002', sessionId: 'session' },
}
const asset: MediaAssetDto = {
  id: '0196f6f8-6600-7000-8000-000000000003', purpose: 'child_avatar', kind: 'photo',
  originalStatus: 'stored', renditionStatus: 'ready', width: 1200, height: 1600,
  durationMs: null, waveform: null, previewPath: '/api/v1/families/x/media/x/content?variant=preview',
  displayPath: '/api/v1/families/x/media/x/content?variant=display', playbackPath: null,
  originalDownloadPath: '/api/v1/families/x/media/x/content?variant=original',
}

test('finalize preserves a committed ready asset when temporary cleanup fails', async () => {
  let committed = false
  let cleanupCalls = 0
  const warnings: string[] = []
  const service = createService({
    commit: async () => { committed = true; return { kind: 'ready', asset } },
    cleanup: async () => { cleanupCalls += 1; throw new Error('locked temporary directory') },
    warn: (name) => warnings.push(name),
  })

  await expect(service.finalize(scope, '0196f6f8-6600-7000-8000-000000000004')).resolves.toEqual({ asset })
  expect(committed).toBe(true)
  expect(cleanupCalls).toBe(1)
  expect(warnings).toEqual(['Error'])
})

test('finalize still rejects a processing error before commit', async () => {
  let committed = false
  const service = createService({
    processPhoto: async () => { throw new Error('photo processing failed') },
    commit: async () => { committed = true; return { kind: 'ready', asset } },
  })

  await expect(service.finalize(scope, '0196f6f8-6600-7000-8000-000000000004')).rejects.toThrow('photo processing failed')
  expect(committed).toBe(false)
})

test('finalize keeps its normal ready result when cleanup succeeds', async () => {
  let cleanupCalls = 0
  const service = createService({
    commit: async () => ({ kind: 'ready', asset }),
    cleanup: async () => { cleanupCalls += 1 },
  })

  await expect(service.finalize(scope, '0196f6f8-6600-7000-8000-000000000004')).resolves.toEqual({ asset })
  expect(cleanupCalls).toBe(1)
})

function createService(options: {
  commit: MediaRepository['commitFinalization']
  cleanup?: (directory: string) => Promise<void>
  processPhoto?: PhotoProcessor
  warn?: (name: string) => void
}) {
  const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0])
  const storage = {
    headObject: async () => ({ contentLength: bytes.byteLength, contentType: 'image/jpeg' }),
    readRange: async () => bytes,
    readObject: async () => ({ body: new Blob([bytes]).stream(), contentLength: bytes.byteLength, contentType: 'image/jpeg' }),
    writeObject: async () => undefined,
  } as unknown as PrivateStorage
  const repository: MediaRepository = {
    reserve: async () => undefined,
    findTelegramIngestion: async () => null,
    prepareFinalize: async () => ({ kind: 'pending', upload: {
      uploadId: '0196f6f8-6600-7000-8000-000000000004', assetId: asset.id, familyId: scope.familyId,
      userId: scope.principal.userId, purpose: 'child_avatar', kind: 'photo', objectKey: 'media-originals/test',
      declaredMime: 'image/jpeg', byteSize: bytes.byteLength, expiresAt: new Date('2026-09-12T00:00:00.000Z'),
    } }),
    rejectUpload: async () => undefined,
    commitFinalization: options.commit,
    readyForMemory: async () => false,
    resolveContent: async () => null,
  }
  const processPhoto: PhotoProcessor = options.processPhoto ?? (async () => ({
    verifiedMime: 'image/jpeg', originalSha256: 'original', width: 1200, height: 1600,
    display: { bytes: new Uint8Array([1]), sha256: 'display', width: 1200, height: 1600 },
    preview: { bytes: new Uint8Array([2]), sha256: 'preview', width: 600, height: 800 },
  }))
  return new (MediaService as any)(
    {} as never, repository, storage, { familyQuotaBytes: 1_000_000, maxPendingUploads: 5, reservationTtlSeconds: 900, uploadUrlTtlSeconds: 300 },
    processPhoto, async () => ({ width: null, height: null, durationMs: 1 }), () => new Date('2026-09-11T00:00:00.000Z'),
    options.cleanup, options.warn,
  ) as MediaService
}
