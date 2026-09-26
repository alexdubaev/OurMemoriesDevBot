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
