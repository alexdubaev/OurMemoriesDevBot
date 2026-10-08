import { expect, test } from 'bun:test'

import type { MediaAssetDto } from '@web-app-demo/contracts'

import type { PrivateStorage } from '../../../storage'
import type { FamilyScope } from '../../families'
import { MediaService } from './media-service'
import { MediaFailure } from '../domain/errors'
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

test('private image ETag returns 304 only after family membership and metadata authorization', async () => {
  let reads = 0
  let lookups = 0
  let membershipChecks = 0
  const service = createService({
    commit: async () => ({ kind: 'ready', asset }),
    requireMember: async () => { membershipChecks += 1 },
    resolveContent: async () => {
      lookups += 1
      return { objectKey: 'private/image', contentType: 'image/jpeg', contentLength: 4, etag: 'abc' }
    },
    readObject: async () => { reads += 1; return null },
  })

  await expect(service.content(scope, asset.id, 'display', undefined, '"abc"')).resolves.toMatchObject({
    body: null, cacheable: true, notModified: true, etag: '"abc"',
  })
  expect(membershipChecks).toBe(1)
  expect(lookups).toBe(1)
  expect(reads).toBe(0)
})

test('private image validators never bypass membership and Range stays no-store', async () => {
  let reads = 0
  let deniedLookups = 0
  const denied = createService({
    commit: async () => ({ kind: 'ready', asset }),
    requireMember: async () => { throw new MediaFailure('forbidden', 'denied') },
    resolveContent: async () => { deniedLookups += 1; return { objectKey: 'private/image', contentType: 'image/jpeg', contentLength: 4, etag: 'abc' } },
  })
  await expect(denied.content(scope, asset.id, 'display', undefined, '"abc"')).rejects.toThrow('denied')
  expect(deniedLookups).toBe(0)

  const ranged = createService({
    commit: async () => ({ kind: 'ready', asset }),
    resolveContent: async () => ({ objectKey: 'private/image', contentType: 'image/jpeg', contentLength: 4, etag: 'abc' }),
    readObject: async () => { reads += 1; return { key: 'private/image', body: new Blob([new Uint8Array([1, 2])]).stream(), contentLength: 2, contentType: 'image/jpeg' } },
  })
  await expect(ranged.content(scope, asset.id, 'display', 'bytes=0-1', '"abc"')).resolves.toMatchObject({
    cacheable: false, notModified: false, range: { start: 0, end: 1 },
  })
  expect(reads).toBe(1)
})







function createService(options: {
  commit: MediaRepository['commitFinalization']
  requireMember?: () => Promise<void>
  resolveContent?: MediaRepository['resolveContent']
  readObject?: PrivateStorage['readObject']
  cleanup?: (directory: string) => Promise<void>
  headObject?: () => Promise<Awaited<ReturnType<PrivateStorage['headObject']>>>
  processPhoto?: PhotoProcessor
  reject?: MediaRepository['rejectUpload']
  warn?: (name: string) => void
}) {
  const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0])
  const storage = {
    headObject: options.headObject ?? (async () => ({ contentLength: bytes.byteLength, contentType: 'image/jpeg' })),
    readRange: async () => bytes,
    readObject: options.readObject ?? (async () => ({ body: new Blob([bytes]).stream(), contentLength: bytes.byteLength, contentType: 'image/jpeg' })),
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
    rejectUpload: options.reject ?? (async () => undefined),
    commitFinalization: options.commit,
    readyForMemory: async () => false,
    resolveContent: options.resolveContent ?? (async () => null),
    resolveMemberAvatarContent: async () => null,
  }
  const processPhoto: PhotoProcessor = options.processPhoto ?? (async () => ({
    verifiedMime: 'image/jpeg', originalSha256: 'original', width: 1200, height: 1600,
    display: { bytes: new Uint8Array([1]), sha256: 'display', width: 1200, height: 1600 },
    preview: { bytes: new Uint8Array([2]), sha256: 'preview', width: 600, height: 800 },
  }))
  return new (MediaService as any)(
    { requireMember: options.requireMember ?? (async () => undefined) } as never, repository, storage, { familyQuotaBytes: 1_000_000, maxPendingUploads: 5, reservationTtlSeconds: 900, uploadUrlTtlSeconds: 300 },
    processPhoto, async () => ({ width: null, height: null, durationMs: 1 }), () => new Date('2026-09-11T00:00:00.000Z'),
    options.cleanup, options.warn,
  ) as MediaService
}

function createReserveService(options: {
  reserve: MediaRepository['reserve']
  findUpload: NonNullable<MediaRepository['findUpload']>
}) {
  const storage = {
    createUploadUrl: async ({ key, contentType, byteSize }: { key: string; contentType: string; byteSize: number }) => ({
      method: 'PUT' as const,
      url: `https://storage.test/${key}`,
      headers: { 'Content-Type': contentType },
      contentLength: byteSize,
      expiresAt: '2026-09-12T00:05:00.000Z',
    }),
  }
  const repository = {
    reserve: options.reserve,
    findUpload: options.findUpload,
  } as MediaRepository
  return new (MediaService as any)(
    { requireFull: async () => undefined }, repository, storage,
    { familyQuotaBytes: 1_000_000, maxPendingUploads: 5, reservationTtlSeconds: 900, uploadUrlTtlSeconds: 300 },
    async () => ({ verifiedMime: 'image/jpeg', originalSha256: 'hash', width: 1, height: 1,
      display: { bytes: new Uint8Array([1]), sha256: 'display', width: 1, height: 1 },
      preview: { bytes: new Uint8Array([2]), sha256: 'preview', width: 1, height: 1 } }),
    async () => ({ width: null, height: null, durationMs: 1 }), () => new Date('2026-09-11T00:00:00.000Z'),
  ) as MediaService
}
