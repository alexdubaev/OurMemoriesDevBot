import { spawnSync } from 'node:child_process'
import { createPrisma } from '../../backend/src/db'
import {
  assertE2eDatabaseUrl,
  composeEnv,
  composeProjectName,
  defaultDatabaseUrl,
  e2eAdminEmail,
  e2eAdminPassword,
  postgresTestService,
  repositoryRoot,
} from './env'
import { ensureInterFontCache } from './helpers/inter-font-cache'
import {
  postgresReadinessProbeTimeoutMs,
  probeTcpEndpoint,
  waitForPostgresReadiness,
} from './helpers/postgres-readiness'

const composeArgs = ['compose', '-p', composeProjectName]

function run(command: string, args: string[], env: NodeJS.ProcessEnv = process.env) {
  const result = spawnSync(command, args, {
    cwd: repositoryRoot,
    env,
    stdio: 'inherit',
  })

  if (result.status !== 0) {
    throw new Error(`Command failed: ${command} ${args.join(' ')}`)
  }
}

export default async function globalSetup() {
  await ensureInterFontCache()

  const databaseUrl = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL ?? defaultDatabaseUrl
  assertE2eDatabaseUrl(databaseUrl)

  process.env.TEST_DATABASE_URL = databaseUrl
  process.env.DATABASE_URL = databaseUrl

  const env = composeEnv({
    DATABASE_URL: databaseUrl,
    TEST_DATABASE_URL: databaseUrl,
  })

  const skipDocker = process.env.E2E_SKIP_DOCKER === '1'
  if (!skipDocker) {
    run('docker', [...composeArgs, 'up', '-d', postgresTestService], env)
  }

  const databaseEndpoint = new URL(databaseUrl)
  const databaseHost = databaseEndpoint.hostname.replace(/^\[|\]$/g, '')
  const databasePort = Number(databaseEndpoint.port || '5432')
  await waitForPostgresReadiness({
    host: databaseHost,
    port: databasePort,
    containerProbe: (args) => {
      if (skipDocker) return true
      const result = spawnSync(
        'docker',
        [...composeArgs, 'exec', '-T', postgresTestService, ...args],
        {
          cwd: repositoryRoot,
          env,
          stdio: 'ignore',
          timeout: postgresReadinessProbeTimeoutMs,
        },
      )
      return result.status === 0
    },
    endpointProbe: probeTcpEndpoint,
    delay: (milliseconds) => new Promise((resolveWait) => setTimeout(resolveWait, milliseconds)),
  })

  run('bun', ['run', '--cwd', 'backend', 'prisma:deploy'], env)
  run('bun', ['run', '--cwd', 'backend', 'prisma:seed'], {
    ...env,
    DEV_SEED_ADMIN_EMAIL: e2eAdminEmail,
    DEV_SEED_ADMIN_PASSWORD: e2eAdminPassword,
    DEV_SEED_USER_EMAIL: 'user@example.com',
    DEV_SEED_USER_PASSWORD: e2eAdminPassword,
  })

  // Browser E2E uses synthetic, signed Telegram initData. Only fixture identities receive pilot
  // admission; regular unadmitted identities remain covered by the family integration suite.
  const prisma = createPrisma(databaseUrl)
  try {
    await prisma.pilotAdmission.createMany({
      data: [81000011, 81000012, 81000013, 81000014, 81000021, 81000022, 81000023, 81000024, 81000031, 81000032, 81000041, 81000051, 81000062, 81000101, 81000102, 81000103, 81000104, 81000105, 81000106, 81000107]
        .map((id) => ({ provider: 'telegram', subject: String(id) })),
      skipDuplicates: true,
    })
  } finally {
    await prisma.$disconnect()
  }
}
