import { randomUUID } from 'node:crypto'

import { afterAll, afterEach, describe, expect, test } from 'bun:test'

import { childrenFixtures, type FixtureFamily, type FixtureUser } from '../../test-support/children-fixtures'

const CHILDREN_HEADER = { 'X-Memoly-Children': '1' }
const FULL_CROP = { x: 0, y: 0, width: 1, height: 1 }

describe('family children API', () => {
  const fx = childrenFixtures()
  const touchedFamilies: string[] = []
  const avatarIds: string[] = []

  afterEach(async () => {
    await fx.db.album.deleteMany({ where: { familyId: { in: touchedFamilies } } })
    await fx.db.maxVideoUploadSession.deleteMany({ where: { familyId: { in: touchedFamilies } } })
    await fx.db.taskOutbox.deleteMany({ where: { dedupeKey: { in: avatarIds.map((id) => `media-delete:${id}`) } } })
    touchedFamilies.length = 0
    avatarIds.length = 0
    await fx.cleanup()
  })
  afterAll(async () => { await fx.disconnect() })

  async function family(...args: Parameters<typeof fx.family>) {
    const created = await fx.family(...args)
    touchedFamilies.push(created.id)
    return created
  }

  async function avatar(familyId: string, uploaderId: string, size: { width: number; height: number } = { width: 64, height: 64 }) {
    const asset = await fx.db.mediaAsset.create({ data: {
      familyId, uploaderId, sourceKind: 'upload', purpose: 'child_avatar', mediaKind: 'photo',
      originalKey: `synthetic/${familyId}/avatar-${randomUUID()}`, declaredMime: 'image/png', verifiedMime: 'image/png',
      sha256: 'f'.repeat(64), byteSize: 10n, ...size, originalStatus: 'stored', renditionStatus: 'ready',
    } })
    avatarIds.push(asset.id)
    return asset
  }

  async function createBody(target: FixtureFamily, overrides: Record<string, unknown> = {}) {
    const asset = await avatar(target.id, target.owner.id)
    return { name: 'Миша', birthDate: '2024-03-04', sex: 'boy', avatarMediaId: asset.id, avatarCrop: FULL_CROP, ...overrides }
  }

  function post(target: FixtureFamily, body: unknown, key = randomUUID(), token = target.owner.token) {
    return fx.request(`/api/v1/families/${target.id}/children`, token, 'POST', body, key)
  }

  function patch(familyId: string, childId: string, body: unknown, token: string) {
    return fx.request(`/api/v1/families/${familyId}/children/${childId}`, token, 'PATCH', body)
  }

  function remove(familyId: string, childId: string, version: number, token: string) {
    return fx.request(`/api/v1/families/${familyId}/children/${childId}`, token, 'DELETE', undefined, undefined, { 'If-Match': String(version) })
  }

  async function childVersion(childId: string) {
    return (await fx.db.child.findUniqueOrThrow({ where: { id: childId } })).version
  }

  describe('POST /families/:familyId/children', () => {
    test('owner adds a complete child; the same key returns the same child', async () => {
      const target = await family(undefined, ['Лиля'])
      const body = await createBody(target)
      const key = randomUUID()
      const created = await post(target, body, key)
      expect(created.response.status, JSON.stringify(created.body)).toBe(201)
      expect(created.body).toEqual({ child: {
        id: expect.any(String), name: 'Миша', birthDate: '2024-03-04', sex: 'boy',
        avatarMediaId: body.avatarMediaId, avatarCrop: FULL_CROP, version: 1, isComplete: true,
      } })
      const replay = await post(target, body, key)
      expect(replay.response.status).toBe(201)
      expect(replay.body.child.id).toBe(created.body.child.id)
      expect(await fx.db.child.count({ where: { familyId: target.id, deletedAt: null } })).toBe(2)
      const conflict = await post(target, { ...body, name: 'Другое имя' }, key)
      expect(conflict.response.status).toBe(409)
      expect(conflict.body.error.code).toBe('IDEMPOTENCY_CONFLICT')
    })

    test('rejects a future birth date, a foreign or used avatar and a non-square crop', async () => {
      const target = await family(undefined, ['Лиля'])
      const future = await post(target, await createBody(target, { birthDate: '2999-01-01' }))
      expect(future.response.status).toBe(409)
      expect(future.body.error.message).toBe('Дата рождения не может быть в будущем')

      const stranger = await family()
      const foreign = await post(target, await createBody(target, { avatarMediaId: (await avatar(stranger.id, stranger.owner.id)).id }))
      expect(foreign.response.status).toBe(409)
      expect(foreign.body.error.message).toBe('Аватар ребёнка должен быть готовым private photo этой семьи')

      const wide = await avatar(target.id, target.owner.id, { width: 200, height: 100 })
      const crop = await post(target, await createBody(target, { avatarMediaId: wide.id }))
      expect(crop.response.status).toBe(409)
      expect(crop.body.error.message).toBe('Кадрирование аватара должно быть квадратным')

      const first = await post(target, await createBody(target))
      expect(first.response.status).toBe(201)
      const reused = await post(target, await createBody(target, { avatarMediaId: first.body.child.avatarMediaId }))
      expect(reused.response.status).toBe(409)
      expect(reused.body.error.message).toBe('Эта фотография уже используется в профиле другого ребёнка')
    })

    test('a family holds at most 12 live children; deleted profiles do not count', async () => {
      const names = Array.from({ length: 11 }, (_, index) => `Ребёнок ${index + 1}`)
      const target = await family(undefined, [...names, { name: 'Удалённый', deleted: true }])
      const twelfth = await post(target, await createBody(target))
      expect(twelfth.response.status, JSON.stringify(twelfth.body)).toBe(201)
      const thirteenth = await post(target, await createBody(target))
      expect(thirteenth.response.status).toBe(409)
      expect(thirteenth.body.error.message).toBe('В семье уже 12 детей')
      expect(await fx.db.child.count({ where: { familyId: target.id, deletedAt: null } })).toBe(12)
    })
  })

  describe('PATCH /families/:familyId/children/:childId', () => {
    test('owner edits any live child and a stale version is a conflict', async () => {
      const target = await family(undefined, ['Лиля', 'Миша'])
      const younger = target.children[1]!
      const edited = await patch(target.id, younger.id, { name: 'Михаил', sex: 'boy', birthDate: '2023-05-06', expectedVersion: 1 }, target.owner.token)
      expect(edited.response.status, JSON.stringify(edited.body)).toBe(200)
      expect(edited.body).toEqual({ child: expect.objectContaining({ id: younger.id, name: 'Михаил', sex: 'boy', birthDate: '2023-05-06', version: 2 }) })
      const stale = await patch(target.id, younger.id, { name: 'Миша', expectedVersion: 1 }, target.owner.token)
      expect(stale.response.status).toBe(409)
      expect(stale.body.error.code).toBe('VERSION_CONFLICT')
      expect((await fx.db.child.findUniqueOrThrow({ where: { id: younger.id } })).displayName).toBe('Михаил')
      const future = await patch(target.id, younger.id, { birthDate: '2999-01-01', expectedVersion: 2 }, target.owner.token)
      expect(future.response.status).toBe(409)
      expect(future.body.error.message).toBe('Дата рождения не может быть в будущем')
    })

    test('replacing the avatar retires the previous one', async () => {
      const target = await family(undefined, ['Лиля', 'Миша'])
      const younger = target.children[1]!
      const first = await avatar(target.id, target.owner.id)
      const second = await avatar(target.id, target.owner.id)
      const set = await patch(target.id, younger.id, { avatarMediaId: first.id, avatarCrop: FULL_CROP, expectedVersion: 1 }, target.owner.token)
      expect(set.response.status, JSON.stringify(set.body)).toBe(200)
      const replaced = await patch(target.id, younger.id, { avatarMediaId: second.id, avatarCrop: FULL_CROP, expectedVersion: 2 }, target.owner.token)
      expect(replaced.response.status, JSON.stringify(replaced.body)).toBe(200)
      expect(replaced.body.child.avatarMediaId).toBe(second.id)
      expect((await fx.db.mediaAsset.findUniqueOrThrow({ where: { id: first.id } })).deletedAt).not.toBeNull()
      expect(await fx.db.taskOutbox.count({ where: { dedupeKey: `media-delete:${first.id}` } })).toBe(1)
      expect((await fx.db.mediaAsset.findUniqueOrThrow({ where: { id: second.id } })).deletedAt).toBeNull()
    })

    test('a photo-only edit that loses its version conflict retires the uploaded avatar', async () => {
      const target = await family(undefined, ['Лиля', 'Миша'])
      const younger = target.children[1]!
      const uploaded = await avatar(target.id, target.owner.id)
      const concurrentEdit = await patch(target.id, younger.id, { name: 'Михаил', expectedVersion: 1 }, target.owner.token)
      expect(concurrentEdit.response.status).toBe(200)
      const stale = await patch(target.id, younger.id, {
        avatarMediaId: uploaded.id, avatarCrop: FULL_CROP, expectedVersion: 1,
      }, target.owner.token)

      expect(stale.response.status).toBe(409)
      expect(stale.body.error.code).toBe('VERSION_CONFLICT')
      expect((await fx.db.mediaAsset.findUniqueOrThrow({ where: { id: uploaded.id } })).deletedAt).not.toBeNull()
      expect(await fx.db.taskOutbox.count({ where: { dedupeKey: `media-delete:${uploaded.id}` } })).toBe(1)
      expect(await fx.db.child.findUniqueOrThrow({ where: { id: younger.id } })).toMatchObject({ avatarMediaId: null, version: 2, displayName: 'Михаил' })
    })

    test('a deleted child or a child of another family is not found', async () => {
      const target = await family(undefined, ['Лиля', { name: 'Удалённый', deleted: true }])
      const stranger = await family(undefined, ['Чужой'])
      const deleted = await patch(target.id, target.children[1]!.id, { name: 'Новое', expectedVersion: 1 }, target.owner.token)
      expect(deleted.response.status).toBe(404)
      const foreign = await patch(target.id, stranger.children[0]!.id, { name: 'Новое', expectedVersion: 1 }, target.owner.token)
      expect(foreign.response.status).toBe(404)
      expect((await fx.db.child.findUniqueOrThrow({ where: { id: stranger.children[0]!.id } })).displayName).toBe('Чужой')
    })
  })

  describe('DELETE /families/:familyId/children/:childId', () => {
    test('soft-deletes a child without tags or albums; it leaves the children list', async () => {
      const target = await family(undefined, ['Лиля', 'Миша'])
      const younger = target.children[1]!
      const deletedAlbum = await fx.db.album.create({ data: {
        familyId: target.id, childId: younger.id, kind: 'events', title: 'Удалённый альбом', deletedAt: new Date(),
        createActorId: target.owner.id, createOperation: 'test:create', createRequestId: randomUUID(), initialPayloadHash: 'a'.repeat(64),
      } })
      const deleted = await remove(target.id, younger.id, 1, target.owner.token)
      expect(deleted.response.status, JSON.stringify(deleted.body)).toBe(204)
      const row = await fx.db.child.findUniqueOrThrow({ where: { id: younger.id } })
      expect(row.deletedAt).not.toBeNull()
      expect(row.version).toBe(2)
      expect(await fx.db.album.count({ where: { id: deletedAlbum.id } })).toBe(1)
      const repeat = await remove(target.id, younger.id, 1, target.owner.token)
      expect(repeat.response.status).toBe(204)
      const read = await fx.request(`/api/v1/families/${target.id}`, target.owner.token, 'GET', undefined, undefined, CHILDREN_HEADER)
      expect(read.body.children.map((child: { id: string }) => child.id)).toEqual([target.children[0]!.id])
    })

    test('refuses while the child has tags, a live album, an active MAX upload or is the last one', async () => {
      const target = await family(undefined, ['Лиля', 'Миша', 'Вера', 'Петя'])
      const [elder, tagged, withAlbum, uploading] = target.children as [typeof target.children[0], typeof target.children[0], typeof target.children[0], typeof target.children[0]]
      await fx.memory(target, { tags: [{ childId: tagged!.id }] })
      await fx.db.album.create({ data: {
        familyId: target.id, childId: withAlbum!.id, kind: 'workshop', title: 'Мастерская',
        createActorId: target.owner.id, createOperation: 'test:create', createRequestId: randomUUID(), initialPayloadHash: 'a'.repeat(64),
      } })
      await fx.db.maxVideoUploadSession.create({ data: {
        familyId: target.id, authorId: target.owner.id, childId: uploading!.id, plannedMemoryId: randomUUID(), body: '',
        occurredAt: new Date(), idempotencyFingerprint: randomUUID(), idempotencyKey: randomUUID(),
        expiresAt: new Date(Date.now() + 600_000), state: 'uploaded',
      } })

      const byTag = await remove(target.id, tagged!.id, 1, target.owner.token)
      expect(byTag.response.status).toBe(409)
      expect(byTag.body.error.message).toBe('Ребёнок отмечен в публикациях. Сначала снимите отметки')
      const byAlbum = await remove(target.id, withAlbum!.id, 1, target.owner.token)
      expect(byAlbum.response.status).toBe(409)
      expect(byAlbum.body.error.message).toBe('У ребёнка есть альбомы. Сначала удалите их')
      const byUpload = await remove(target.id, uploading!.id, 1, target.owner.token)
      expect(byUpload.response.status).toBe(409)
      expect(byUpload.body.error.message).toBe('Для ребёнка загружается видео. Дождитесь окончания загрузки')
      const stale = await remove(target.id, elder!.id, 7, target.owner.token)
      expect(stale.response.status).toBe(409)
      expect(stale.body.error.code).toBe('VERSION_CONFLICT')
      expect(await fx.db.child.count({ where: { familyId: target.id, deletedAt: { not: null } } })).toBe(0)

      const single = await family(undefined, ['Единственный'])
      const last = await remove(single.id, single.children[0]!.id, 1, single.owner.token)
      expect(last.response.status).toBe(409)
      expect(last.body.error.message).toBe('Нельзя удалить единственного ребёнка семьи')
    })

    test('expired upload sessions do not block profile removal', async () => {
      const target = await family(undefined, ['Лиля', 'Миша'])
      const younger = target.children[1]!
      await fx.db.maxVideoUploadSession.create({ data: {
        familyId: target.id, authorId: target.owner.id, childId: younger.id, plannedMemoryId: randomUUID(), body: 'Просрочено',
        occurredAt: new Date(), idempotencyFingerprint: randomUUID(), idempotencyKey: randomUUID(),
        expiresAt: new Date(Date.now() - 60_000), state: 'uploaded',
      } })

      const deleted = await remove(target.id, younger.id, 1, target.owner.token)
      expect(deleted.response.status, JSON.stringify(deleted.body)).toBe(204)
      expect((await fx.db.child.findUniqueOrThrow({ where: { id: younger.id } })).deletedAt).not.toBeNull()
    })

    test('deleting a profile retires its avatar and immediately denies private access exactly once', async () => {
      const target = await family(undefined, ['Лиля', 'Миша'])
      const younger = target.children[1]!
      const profilePhoto = await avatar(target.id, target.owner.id)
      const edited = await patch(target.id, younger.id, {
        avatarMediaId: profilePhoto.id, avatarCrop: FULL_CROP, expectedVersion: 1,
      }, target.owner.token)
      expect(edited.response.status, JSON.stringify(edited.body)).toBe(200)

      const activeUpload = await fx.db.maxVideoUploadSession.create({ data: {
        familyId: target.id, authorId: target.owner.id, childId: younger.id, plannedMemoryId: randomUUID(), body: 'В процессе',
        occurredAt: new Date(), idempotencyFingerprint: randomUUID(), idempotencyKey: randomUUID(),
        expiresAt: new Date(Date.now() + 60_000), state: 'uploaded',
      } })
      const conflictingDelete = await remove(target.id, younger.id, 2, target.owner.token)
      expect(conflictingDelete.response.status).toBe(409)
      expect((await fx.db.mediaAsset.findUniqueOrThrow({ where: { id: profilePhoto.id } })).deletedAt).toBeNull()
      expect(await fx.db.taskOutbox.count({ where: { dedupeKey: `media-delete:${profilePhoto.id}` } })).toBe(0)
      await fx.db.maxVideoUploadSession.delete({ where: { id: activeUpload.id } })

      const deleted = await remove(target.id, younger.id, 2, target.owner.token)
      expect(deleted.response.status, JSON.stringify(deleted.body)).toBe(204)
      const media = await fx.db.mediaAsset.findUniqueOrThrow({ where: { id: profilePhoto.id } })
      expect(media.deletedAt).not.toBeNull()
      expect(await fx.db.taskOutbox.count({ where: { dedupeKey: `media-delete:${profilePhoto.id}` } })).toBe(1)
      const privateRead = await fx.request(`/api/v1/families/${target.id}/media/${profilePhoto.id}/content?variant=original`, target.owner.token)
      expect(privateRead.response.status).toBe(404)

      const replay = await remove(target.id, younger.id, 2, target.owner.token)
      expect(replay.response.status).toBe(204)
      expect(await fx.db.taskOutbox.count({ where: { dedupeKey: `media-delete:${profilePhoto.id}` } })).toBe(1)
      expect((await fx.db.mediaAsset.findUniqueOrThrow({ where: { id: profilePhoto.id } })).deletedAt).toEqual(media.deletedAt)
    })

    test('a tag on a deleted publication does not block deletion', async () => {
      const target = await family(undefined, ['Лиля', 'Миша'])
      const memory = await fx.memory(target, { tags: [{ childId: target.children[1]!.id }] })
      await fx.db.memory.update({ where: { id: memory.id }, data: { status: 'deleted', deletedAt: new Date() } })
      const deleted = await remove(target.id, target.children[1]!.id, 1, target.owner.token)
      expect(deleted.response.status, JSON.stringify(deleted.body)).toBe(204)
    })
  })

  describe('access to child management', () => {
    async function familyWithMembers() {
      const target = await family(undefined, ['Лиля', 'Миша'])
      const full = await fx.member(target.id, 'full')
      const viewer = await fx.member(target.id, 'viewer')
      const revoked = await fx.member(target.id, 'full')
      await fx.db.familyMember.update({ where: { familyId_userId: { familyId: target.id, userId: revoked.id } }, data: { revokedAt: new Date() } })
      return { target, full, viewer, revoked }
    }

    async function attempts(target: FixtureFamily, actor: FixtureUser, childId: string) {
      const body = await createBody(target)
      return [
        (await post(target, body, randomUUID(), actor.token)).response.status,
        (await patch(target.id, childId, { name: 'Чужая правка', expectedVersion: 1 }, actor.token)).response.status,
        (await remove(target.id, childId, 1, actor.token)).response.status,
      ]
    }

    test('members who are not the owner get 403; revoked members and strangers get 404', async () => {
      const { target, full, viewer, revoked } = await familyWithMembers()
      const childId = target.children[1]!.id
      expect(await attempts(target, full, childId)).toEqual([403, 403, 403])
      expect(await attempts(target, viewer, childId)).toEqual([403, 403, 403])
      expect(await attempts(target, revoked, childId)).toEqual([404, 404, 404])
      const stranger = await family()
      expect(await attempts(target, stranger.owner, childId)).toEqual([404, 404, 404])
      const row = await fx.db.child.findUniqueOrThrow({ where: { id: childId } })
      expect({ name: row.displayName, deletedAt: row.deletedAt, version: row.version }).toEqual({ name: 'Миша', deletedAt: null, version: 1 })
      expect(await fx.db.child.count({ where: { familyId: target.id } })).toBe(2)
    })

    test('an owner cannot delete a child of another family through their own family', async () => {
      const target = await family(undefined, ['Лиля', 'Миша'])
      const stranger = await family(undefined, ['Чужой', 'Чужая'])
      const response = await remove(target.id, stranger.children[1]!.id, 1, target.owner.token)
      expect(response.response.status).toBe(404)
      expect((await fx.db.child.findUniqueOrThrow({ where: { id: stranger.children[1]!.id } })).deletedAt).toBeNull()
    })
  })

  describe('GET /families/:familyId children list', () => {
    test('with the header returns live children by birth date (unknown last), then creation', async () => {
      const target = await family(undefined, [
        { name: 'Без даты' }, { name: 'Младшая', birthDate: '2023-01-01' },
        { name: 'Удалённая', deleted: true, birthDate: '2019-01-01' }, { name: 'Старший', birthDate: '2020-06-01' },
        { name: 'Без даты 2' },
      ])
      const read = await fx.request(`/api/v1/families/${target.id}`, target.owner.token, 'GET', undefined, undefined, CHILDREN_HEADER)
      expect(read.response.status).toBe(200)
      expect(read.body.children.map((child: { name: string }) => child.name)).toEqual(['Старший', 'Младшая', 'Без даты', 'Без даты 2'])
      expect(read.body.child.name).toBe('Без даты')
    })

    test('without the header the response keeps its previous shape', async () => {
      const target = await family(undefined, ['Лиля', 'Миша'])
      const read = await fx.request(`/api/v1/families/${target.id}`, target.owner.token)
      expect(read.response.status).toBe(200)
      expect(Object.keys(read.body).sort()).toEqual(['child', 'family'])
      expect(read.body.child.name).toBe('Лиля')
    })
  })
})
