import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { createPrisma } from '../../db'
import { requireIntegrationDatabaseUrl } from '../../test-support/integration-database'

const prisma = createPrisma(requireIntegrationDatabaseUrl())
const userId = '70000000-0000-4000-8000-000000000001'

describe('Control deletion schema integration', () => {
  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { id: userId } })
    await prisma.user.create({ data: { id: userId, displayName: 'Synthetic lifecycle subject' } })
  })

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: userId } })
    await prisma.$disconnect()
  })

  test('new accounts start in the active Control lifecycle state', async () => {
    const [row] = await prisma.$queryRaw<Array<{ controlState: string }>>`
      SELECT control_state AS "controlState" FROM users WHERE id = ${userId}::uuid
    `
    expect(row?.controlState).toBe('active')
  })
})
