import { createApp } from '../../../app'
import { createPrisma } from '../../../db'
import { loadEnv } from '../../../env'
import { createPrivateStorage } from '../../../storage'
import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { createHash } from 'node:crypto'
import { requireIntegrationDatabaseUrl } from '../../../test-support/integration-database'

const databaseUrl = requireIntegrationDatabaseUrl()
const runId = process.env.CONTROL_E2E_RUN_ID
if (!runId || !/^[a-zA-Z0-9-]{1,64}$/.test(runId)) throw new Error('CONTROL_E2E_RUN_ID is required and must be a simple unique identifier')

const port = process.env.PORT ?? '56701'
const webPort = process.env.CONTROL_E2E_WEB_PORT ?? '56702'
const maxToken = '987654:control-e2e-synthetic'
const prisma = createPrisma(databaseUrl)

async function boot() {
  await prisma.family.deleteMany({ where: { name: 'Control E2E Garden' } })
  const ownerIdentity = await prisma.externalIdentity.upsert({
    where: { provider_subject: { provider: 'max', subject: '987654321' } },
    create: {
      provider: 'max', subject: '987654321',
      user: { create: { displayName: 'Control E2E Owner' } },
    },
    update: {},
  })
  await prisma.user.update({ where: { id: ownerIdentity.userId }, data: { displayName: 'Control E2E Owner' } })
  const ownerId = ownerIdentity.userId
  const family = await prisma.family.create({
    data: {
      ownerUserId: ownerId,
      name: 'Control E2E Garden',
      timezone: 'UTC',
      members: { create: { user: { connect: { id: ownerId } }, role: 'full' } },
    },
  })
  const members = await Promise.all(Array.from({ length: 26 }, (_, index) => prisma.user.create({
    data: { displayName: `Control E2E Member ${String(index + 1).padStart(2, '0')}`, createdAt: new Date(Date.now() - index * 86_400_000) },
  })))
  await prisma.familyMember.createMany({
    data: members.map((member, index) => ({ familyId: family.id, userId: member.id, role: 'viewer' as const, familyDisplayName: `Garden alias ${String(index + 1).padStart(2, '0')}` })),
  })
  await prisma.familyInvite.create({
    data: { familyId: family.id, role: 'viewer', inviteeDisplayName: 'Control synthetic guest', tokenHash: createHash('sha256').update(runId!).digest('hex'), expiresAt: new Date(Date.now() + 86_400_000), createdBy: ownerId },
  })
  const today = new Date()
  const activityDays = [1, 2].map((daysAgo) => {
    const day = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - daysAgo))
    return { day, observedAt: new Date(day.getTime() + 12 * 60 * 60 * 1000) }
  })
  await prisma.controlUserActivity.createMany({
    data: activityDays.flatMap(({ day, observedAt }) => [ownerId, members[0]!.id].map((userId) => ({ userId, utcDay: day, firstObservedAt: observedAt, lastObservedAt: observedAt, surface: 'browser' }))),
    skipDuplicates: true,
  })
  await prisma.controlFamilyActivity.createMany({
    data: activityDays.map(({ day, observedAt }) => ({ familyId: family.id, userId: members[0]!.id, utcDay: day, firstObservedAt: observedAt, lastObservedAt: observedAt })),
    skipDuplicates: true,
  })

  const env = loadEnv({
    DATABASE_URL: databaseUrl,
    NODE_ENV: 'test',
    PORT: port,
    JWT_SECRET: '0123456789abcdef'.repeat(4),
    MAX_ENABLED: 'true',
    MAX_BOT_TOKEN: maxToken,
    MAX_BOT_EXPECTED_USERNAME: 'OurMemoriesMaxBot',
    MAX_WEBHOOK_URL: 'https://max.example.test/webhook',
    MAX_WEBHOOK_SECRET: 'M'.repeat(43),
    MAX_INBOX_ENCRYPTION_KEY: 'B'.repeat(43),
    MAX_MINI_APP_URL: 'https://app.example.test',
    CONTROL_ENABLED: 'true',
    CONTROL_OWNER_USER_IDS: ownerIdentity.userId,
    COOKIE_SECURE: 'false',
    CORS_ORIGINS: `http://127.0.0.1:${webPort}`,
    MULTI_FAMILY_ACTIVATION: 'on',
    AUTH_RATE_LIMIT_MAX: '10000',
    // The browser catalog reuses one synthetic owner; dedicated integration tests cover limiter boundaries.
    ADMIN_USERS_READ_RATE_LIMIT_MAX: '10000',
    PRIVATE_STORAGE_DRIVER: 'filesystem',
    PRIVATE_STORAGE_LOCAL_ROOT: resolve(`.scratch/control-e2e-storage-${runId}`),
    PRIVATE_STORAGE_LOCAL_PUBLIC_URL: `http://127.0.0.1:${port}`,
    PRIVATE_STORAGE_UPLOAD_MAX_BYTES: '10000000',
  })
  await mkdir(env.PRIVATE_STORAGE_LOCAL_ROOT, { recursive: true })
  const app = createApp({ env, prisma, privateStorage: createPrivateStorage(env) })
  const server = Bun.serve({ hostname: '127.0.0.1', port: env.PORT, fetch: app.fetch })
  console.log(`Control E2E API listening at ${server.url}`)
  const shutdown = () => { void prisma.$disconnect().finally(() => server.stop(true)) }
  process.on('SIGTERM', shutdown)
  process.on('SIGINT', shutdown)
}

void boot().catch((error: unknown) => {
  console.error('Control E2E server failed to start', error)
  process.exitCode = 1
})
