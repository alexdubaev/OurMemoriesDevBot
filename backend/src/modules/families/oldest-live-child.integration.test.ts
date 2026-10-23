import { randomUUID } from 'node:crypto'

import { afterAll, afterEach, describe, expect, test } from 'bun:test'

import { childrenFixtures } from '../../test-support/children-fixtures'

describe('legacy single-child family views use the oldest live child', () => {
  const fx = childrenFixtures()
  afterEach(async () => { await fx.cleanup() })
  afterAll(async () => { await fx.disconnect() })

  async function familyWithDeletedElder() {
    const family = await fx.family(undefined, [{ name: 'Удалённая', deleted: true, birthDate: '2020-01-01' }, 'Младшая', 'Третий'])
    return { family, deleted: family.children[0]!, live: family.children[1]! }
  }

  async function avatar(familyId: string, uploaderId: string) {
    return fx.db.mediaAsset.create({ data: {
      familyId, uploaderId, sourceKind: 'upload', purpose: 'child_avatar', mediaKind: 'photo',
      originalKey: `synthetic/${familyId}/avatar-${randomUUID()}`, declaredMime: 'image/png', verifiedMime: 'image/png',
      sha256: 'f'.repeat(64), byteSize: 10n, width: 64, height: 64, originalStatus: 'stored', renditionStatus: 'ready',
    } })
  }

  test('family response and family list never show a deleted child', async () => {
    const { family, live } = await familyWithDeletedElder()
    const read = await fx.request(`/api/v1/families/${family.id}`, family.owner.token)
    expect(read.response.status).toBe(200)
    expect(read.body.child).toMatchObject({ id: live.id, name: 'Младшая' })
    const home = await fx.request('/api/v1/me/families', family.owner.token)
    expect(home.response.status).toBe(200)
    expect(home.body.items.find((item: { familyId: string }) => item.familyId === family.id)).toMatchObject({ displaySubtitle: 'Младшая', setupStatus: 'needs_child' })
  })

  test('legacy family patch edits the oldest live child', async () => {
    const { family, deleted, live } = await familyWithDeletedElder()
    const patched = await fx.request(`/api/v1/families/${family.id}`, family.owner.token, 'PATCH', { child: { displayName: 'Лиля', expectedVersion: 1 } })
    expect(patched.response.status, JSON.stringify(patched.body)).toBe(200)
    expect(patched.body.child).toMatchObject({ id: live.id, name: 'Лиля' })
    expect((await fx.db.child.findUniqueOrThrow({ where: { id: deleted.id } })).displayName).toBe('Удалённая')
  })

  test('legacy complete-profile request completes the oldest live child', async () => {
    const { family, deleted, live } = await familyWithDeletedElder()
    const asset = await avatar(family.id, family.owner.id)
    const completed = await fx.request(`/api/v1/families/${family.id}/child`, family.owner.token, 'PUT', {
      name: 'Лиля', birthDate: '2024-01-02', sex: 'girl', avatarMediaId: asset.id,
      avatarCrop: { x: 0, y: 0, width: 1, height: 1 }, expectedVersion: 1,
    })
    expect(completed.response.status, JSON.stringify(completed.body)).toBe(200)
    expect(completed.body.child).toMatchObject({ id: live.id, isComplete: true })
    expect((await fx.db.child.findUniqueOrThrow({ where: { id: deleted.id } })).avatarMediaId).toBeNull()
  })

  test('invites depend on the oldest live child, not on a deleted complete one', async () => {
    const { family, deleted } = await familyWithDeletedElder()
    const asset = await avatar(family.id, family.owner.id)
    await fx.db.child.update({ where: { id: deleted.id }, data: { sex: 'girl', avatarMediaId: asset.id, avatarCrop: { x: 0, y: 0, width: 1, height: 1 } } })
    const invite = await fx.request(`/api/v1/families/${family.id}/invites`, family.owner.token, 'POST', { role: 'viewer' }, randomUUID())
    expect(invite.response.status).toBe(409)
    expect(invite.body.error.message).toBe('Сначала завершите профиль ребёнка')
  })
})
