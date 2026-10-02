import { expect, test } from 'bun:test'

import { FamilyService } from './family-service'

test('legacy /me refuses an ambiguous two-family membership', async () => {
  const user = {
    id: '00000000-0000-4000-8000-000000000001', email: null, displayName: null,
    role: 'user' as const, createdAt: new Date().toISOString(),
  }
  const db = { familyMember: { findMany: async () => [
    { role: 'full', family: { id: 'family-a', name: 'A', ownerUserId: user.id } },
    { role: 'viewer', family: { id: 'family-b', name: 'B', ownerUserId: 'other' } },
  ] } }
  const service = new FamilyService(db as never, {} as never, {} as never, {} as never, 'test', 1)
  await expect(service.getMe(user)).rejects.toMatchObject({ kind: 'conflict' })
})

test('a failed unread count leaves the family list available with an unavailable counter', async () => {
  const userId = '00000000-0000-4000-8000-000000000001'
  const familyId = '00000000-0000-4000-8000-000000000002'
  let queryNumber = 0
  const tx = {
    $queryRaw: async () => ++queryNumber === 1
      ? [{ snapshot: 'synthetic-snapshot', activeCount: 1n }]
      : [{ familyId, rank: 0, sortName: 'Наша семья' }],
    familyMember: { findMany: async () => [{
      role: 'full', familyDisplayName: null, membershipEpoch: 1,
      family: {
        id: familyId, name: 'Наша семья', ownerUserId: userId,
        unreadTrackingActivatedAt: new Date(), children: [{
          displayName: 'Лиза', birthDate: new Date('2020-02-02T00:00:00.000Z'), sex: 'girl',
          avatarMediaId: '00000000-0000-4000-8000-000000000003',
          avatarCrop: { x: 0.2, y: 0.1, width: 0.6, height: 0.6 },
        }],
      },
    }] },
    family: { findFirst: async () => ({ id: familyId, status: 'active' }) },
  }
  const db = {
    $transaction: async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx),
    $queryRaw: async () => { throw new Error('synthetic counter failure') },
  }
  const service = new FamilyService(db as never, {} as never, {} as never, {} as never, 'test', 1,
    () => new Date(), 'on')
  const response = await service.getFamilies({ userId, sessionId: 'synthetic-session', externalIdentity: null }, { limit: 20 })
  expect(response.items).toHaveLength(1)
  expect(response.items[0]).toMatchObject({
    familyId, unreadCount: null, unreadState: 'unavailable',
    childAvatarMediaId: '00000000-0000-4000-8000-000000000003',
    childAvatarCrop: { x: 0.2, y: 0.1, width: 0.6, height: 0.6 },
  })
})
