import { expect, test } from 'bun:test'
import { readFile } from 'node:fs/promises'
import sharp from 'sharp'

import type { DbClient } from '../../db'
import type { PrivateStorage } from '../../storage'
import { pngFixture } from '../../storage/storage-contract'
import type { FamilyAccess, FamilyScope } from '../families'
import { MediaService } from './application/media-service'
import type { MediaRepository } from './application/ports'
import { PrismaMediaRepository } from './infrastructure/prisma-media-repository'

const scope: FamilyScope = {
  familyId: '0196f6f8-6600-7000-8000-000000000001',
  principal: { userId: '0196f6f8-6600-7000-8000-000000000002', sessionId: 'session' },
}
const userId = '0196f6f8-6600-7000-8000-000000000003'
const avatarId = '0196f6f8-6600-7000-8000-000000000004'

test('avatar lookup binds ready row to target user and active membership in the requested family', async () => {
  let where: unknown
  const repository = new PrismaMediaRepository({ userAvatar: {
    findFirst: async (input: { where: unknown }) => {
      where = input.where
      return { objectKey: 'avatars/example', contentType: 'image/png', byteSize: 42 }
    },
  } } as unknown as DbClient)
  expect(await repository.resolveMemberAvatarContent(scope, userId, avatarId)).toEqual({
    objectKey: 'avatars/example', contentType: 'image/png', contentLength: 42,
  })
  expect(where).toEqual({
    id: avatarId, userId, state: 'ready',
    user: { familyMemberships: { some: {
      familyId: scope.familyId, revokedAt: null, family: { status: 'active' },
    } } },
  })
})

test('viewer receives original PNG bytes and MIME with matching GET/HEAD length while ACL remains enforced', async () => {
  let allowed = true
  let currentAvatarId: string | null = avatarId
  let reads = 0
  const access = { requireMember: async () => {
    if (!allowed) throw { kind: 'not_found' }
    return { role: 'viewer', isOwner: false }
  } } as unknown as FamilyAccess
  const repository = { resolveMemberAvatarContent: async (_scope: FamilyScope, _userId: string, requestedId: string) =>
    requestedId === currentAvatarId ? { objectKey: 'avatars/example', contentType: 'image/png', contentLength: pngFixture.byteLength } : null,
  } as MediaRepository
  const storage = { headObject: async () => ({ contentLength: pngFixture.byteLength, contentType: 'image/png' }), readObject: async () => {
    reads += 1
    return { body: new Blob([pngFixture]).stream(), contentLength: pngFixture.byteLength, contentType: 'image/png' }
  } } as unknown as PrivateStorage
  const service = new MediaService(access, repository, storage, {} as never, {} as never, {} as never)

  const response = await service.memberAvatarContent(scope, userId, avatarId)
  expect(response.contentType).toBe('image/png')
  expect(response.contentLength).toBe(pngFixture.byteLength)
  expect(new Uint8Array(await new Response(response.body).arrayBuffer())).toEqual(new Uint8Array(pngFixture))
  expect(reads).toBe(1)
  const head = await service.memberAvatarContent(scope, userId, avatarId, true)
  expect(head.body).toBeNull()
  expect(head.contentType).toBe(response.contentType)
  expect(head.contentLength).toBe(response.contentLength)
  expect(reads).toBe(2)
  currentAvatarId = '0196f6f8-6600-7000-8000-000000000005'
  await expect(service.memberAvatarContent(scope, userId, avatarId)).rejects.toMatchObject({ kind: 'not_found' })
  currentAvatarId = null
  await expect(service.memberAvatarContent(scope, userId, avatarId)).rejects.toMatchObject({ kind: 'not_found' })
  allowed = false
  await expect(service.memberAvatarContent(scope, userId, avatarId)).rejects.toMatchObject({ kind: 'not_found' })
  expect(reads).toBe(2)
})

test('member HEIC display normalizes to full JPEG and keeps HEAD headers aligned with GET', async () => {
  const heic = new Uint8Array(await readFile(new URL('./fixtures/heic-exif-orientation.heic', import.meta.url)))
  const access = { requireMember: async () => ({ role: 'viewer', isOwner: false }) } as unknown as FamilyAccess
  const repository = { resolveMemberAvatarContent: async () => ({
    objectKey: 'avatars/heic', contentType: 'image/heic', contentLength: heic.byteLength,
  }) } as unknown as MediaRepository
  const storage = { readObject: async () => ({ body: new Blob([heic]).stream(), contentLength: heic.byteLength, contentType: 'image/heic' }) } as unknown as PrivateStorage
  const service = new MediaService(access, repository, storage, {} as never, {} as never, {} as never)

  const get = await service.memberAvatarContent(scope, userId, avatarId)
  const head = await service.memberAvatarContent(scope, userId, avatarId, true)
  expect(get.contentType).toBe('image/jpeg')
  expect(get.contentLength).toBeGreaterThan(0)
  expect(head.contentType).toBe(get.contentType)
  expect(head.contentLength).toBe(get.contentLength)
  expect(head.body).toBeNull()
  const metadata = await sharp(Buffer.from(await new Response(get.body).arrayBuffer())).metadata()
  expect({ width: metadata.width, height: metadata.height }).toEqual({ width: 480, height: 640 })
})
