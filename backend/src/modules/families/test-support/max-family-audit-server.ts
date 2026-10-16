import { createApp } from '../../../app'
import { createPrisma } from '../../../db'
import { loadEnv } from '../../../env'
import { createPrivateStorage } from '../../../storage'
import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'

const databaseUrl = process.env.TEST_DATABASE_URL
if (!databaseUrl) throw new Error('TEST_DATABASE_URL is required for MAX family audit E2E')
const runId = process.env.MAX_FAMILY_AUDIT_RUN_ID
if (!runId || !/^[a-zA-Z0-9-]{1,64}$/.test(runId)) throw new Error('MAX_FAMILY_AUDIT_RUN_ID is required and must be a simple unique identifier')
const parsedUrl = new URL(databaseUrl)
if (!['127.0.0.1', 'localhost', '::1'].includes(parsedUrl.hostname)
  || !/^\/memoly_family_audit_(?:test|e2e_test|resume_20261016_test)$/.test(parsedUrl.pathname)) {
  throw new Error('MAX family audit E2E refuses non-loopback or non-task-owned databases')
}

const env = loadEnv({
  DATABASE_URL: databaseUrl,
  NODE_ENV: 'test',
  PORT: process.env.PORT ?? '56601',
  JWT_SECRET: '0123456789abcdef'.repeat(4),
  MAX_ENABLED: 'true',
  MAX_BOT_TOKEN: '987654:max-family-audit-synthetic',
  MAX_BOT_EXPECTED_USERNAME: 'OurMemoriesMaxBot',
  MAX_WEBHOOK_URL: 'https://max.example.test/webhook',
  MAX_WEBHOOK_SECRET: 'M'.repeat(43),
  MAX_INBOX_ENCRYPTION_KEY: 'B'.repeat(43),
  MAX_MINI_APP_URL: 'https://app.example.test',
  COOKIE_SECURE: 'false',
  CORS_ORIGINS: `http://127.0.0.1:${process.env.MAX_FAMILY_AUDIT_WEB_PORT ?? '56602'}`,
  MULTI_FAMILY_ACTIVATION: 'on',
  AUTH_RATE_LIMIT_MAX: '10000',
  PRIVATE_STORAGE_DRIVER: 'filesystem',
  PRIVATE_STORAGE_LOCAL_ROOT: resolve(`.scratch/max-family-audit-e2e-storage-${runId}`),
  PRIVATE_STORAGE_LOCAL_PUBLIC_URL: `http://127.0.0.1:${process.env.MAX_FAMILY_AUDIT_API_PORT ?? process.env.PORT ?? '56601'}`,
  PRIVATE_STORAGE_UPLOAD_MAX_BYTES: '10000000',
})
const prisma = createPrisma(databaseUrl)
const privateStorage = createPrivateStorage(env)
const boot = async () => {
  await mkdir(env.PRIVATE_STORAGE_LOCAL_ROOT, { recursive: true })
  const app = createApp({ env, prisma, privateStorage })
  const server = Bun.serve({ hostname: '127.0.0.1', port: env.PORT, fetch: app.fetch })
  console.log(`MAX family audit API listening at ${server.url}`)
  const shutdown = () => { void prisma.$disconnect().finally(() => server.stop(true)) }
  process.on('SIGTERM', shutdown)
  process.on('SIGINT', shutdown)
}
void boot().catch((error: unknown) => {
  console.error('MAX family audit server failed to start', error)
  process.exitCode = 1
})
