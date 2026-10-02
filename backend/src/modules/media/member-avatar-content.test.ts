import { expect, test } from 'bun:test'

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

test('viewer reads a ready avatar, while access loss, replacement and deletion cannot read bytes', async () => {
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

  expect((await service.memberAvatarContent(scope, userId, avatarId)).contentType).toBe('image/jpeg')
  expect(reads).toBe(1)
  expect((await service.memberAvatarContent(scope, userId, avatarId, true)).body).toBeNull()
  expect(reads).toBe(2)
  currentAvatarId = '0196f6f8-6600-7000-8000-000000000005'
  await expect(service.memberAvatarContent(scope, userId, avatarId)).rejects.toMatchObject({ kind: 'not_found' })
  currentAvatarId = null
  await expect(service.memberAvatarContent(scope, userId, avatarId)).rejects.toMatchObject({ kind: 'not_found' })
  allowed = false
  await expect(service.memberAvatarContent(scope, userId, avatarId)).rejects.toMatchObject({ kind: 'not_found' })
  expect(reads).toBe(2)
})
