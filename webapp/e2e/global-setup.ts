import { spawnSync } from 'node:child_process'
import {
  assertE2eDatabaseUrl,
  composeEnv,
  composeProjectName,
  defaultDatabaseUrl,
  postgresTestService,
  repositoryRoot,
} from './env'
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
}
