import { spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  assertLoopbackTestDatabaseUrl,
  assertTestDatabaseUrl,
  composeEnv,
  composeProjectName,
  defaultTestDatabaseUrl,
  postgresPortFromDatabaseUrl,
  postgresTestDataVolume,
  postgresTestService,
} from '../../scripts/repo-env.mjs'
import { backendTestFiles, selectBackendTestRun } from './test-files.mjs'

const backendRoot = resolve(fileURLToPath(new URL('.', import.meta.url)), '..')
const repositoryRoot = resolve(backendRoot, '..')

/**
 * The per-test budget every integration test gets unless the caller passes `--timeout=<ms>`.
 *
 * bun's default, 5 s, is a unit-test budget. The scenarios here hash passwords with argon2id
 * several times each and cross a Docker network: 0.3-0.6 s idle, and can exceed 30 s on a
 * saturated machine while an isolated upgrade test runs nested Prisma deploy processes. A test
 * that times out does not fail cleanly either - bun lets its body run on into the
 * next test's cleanup, so the failure is reported against an unrelated later assertion. The budget
 * is longer than the request-path transaction timeouts in `src/db.ts` (15 s and 20 s), so a lock
 * held too long is still reported through the request that held it - Prisma expires that
 * transaction and the request answers 500 - rather than by the harness as a bare timeout.
 */
export const integrationTestTimeoutMs = 60_000
export const integrationChildProcessTimeoutMs = 180_000

export function runIntegrationChild(spawn, command, args, options, timeoutMs = integrationChildProcessTimeoutMs) {
  const result = spawn(command, args, { ...options, timeout: timeoutMs })
  if (result.error?.code === 'ETIMEDOUT') {
    throw new Error(`Integration test process exceeded ${timeoutMs}ms: ${args.at(-1)}`)
  }
  return result
}

class CommandFailure extends Error {
  constructor(command, args, exitCode) {
    super(`${command} ${args.join(' ')} failed with exit code ${exitCode}`)
    this.exitCode = exitCode
  }
}

export async function runBackendIntegration({
  environment = process.env,
  integrationTestFiles,
  testArgs = [],
  spawn = spawnSync,
  writeError = (message) => process.stderr.write(`${message}\n`),
} = {}) {
  const maxOnly = testArgs.includes('--max-only')
  const historicalOnly = testArgs.includes('--historical')
  if (maxOnly && historicalOnly) throw new Error('--max-only and --historical select incompatible integration catalogs')
  const selectedArgs = testArgs.filter((argument) => argument !== '--max-only' && argument !== '--historical')
  const allIntegrationFiles = integrationTestFiles ?? backendTestFiles(backendRoot).integration
  const currentIntegrationFiles = allIntegrationFiles.filter((file) => !isHistoricalIntegration(file))
  const catalogFiles = historicalOnly ? selectHistoricalIntegration(allIntegrationFiles) : currentIntegrationFiles
  const discoveredTestFiles = maxOnly
    ? selectMaxVerificationIntegration(catalogFiles)
    : catalogFiles
  const selectedTestRun = discoveredTestFiles.length > 0
    ? selectBackendTestRun(discoveredTestFiles, selectedArgs)
    : undefined
  if (maxOnly && selectedTestRun) {
    selectedTestRun.bunTestArgs.push('--test-name-pattern', '^(?!.*(?:Telegram|telegram)).*$')
  }

  const managesDocker = environment.TEST_SKIP_DOCKER !== '1'
  if (!managesDocker && !environment.TEST_DATABASE_URL) {
    throw new Error('TEST_SKIP_DOCKER=1 requires TEST_DATABASE_URL')
  }

  const databaseUrl = environment.TEST_DATABASE_URL ?? defaultTestDatabaseUrl()
  assertTestDatabaseUrl(databaseUrl)
  assertLoopbackTestDatabaseUrl(databaseUrl, environment.DATABASE_URL)

  const dockerProjectName = `${composeProjectName}-integration-${randomUUID().slice(0, 8)}`
  const composeArgs = ['compose', '-p', dockerProjectName]
  const dockerEnv = {
    ...composeEnv(),
    ...environment,
    COMPOSE_PROJECT_NAME: dockerProjectName,
    POSTGRES_TEST_PORT: postgresPortFromDatabaseUrl(databaseUrl),
  }
  const env = {
    ...dockerEnv,
    DATABASE_URL: databaseUrl,
    TEST_DATABASE_URL: databaseUrl,
    CHECKPOINT_DISABLE: '1',
  }
  const keepsDocker = environment.TEST_KEEP_DOCKER === '1'

  const run = (command, args, options = {}) => {
    const testFile = command === 'bun' && args[0] === 'test'
      ? args.at(-1)?.replaceAll('\\', '/')
      : undefined
    const childTimeoutMs = testFile
      ? process.platform === 'win32' && testFile === 'scripts/comments-release-compatibility.integration.test.ts'
        ? 360_000
        : integrationChildProcessTimeoutMs
      : undefined
    const result = childTimeoutMs === undefined ? spawn(command, args, {
      cwd: options.cwd ?? backendRoot,
      env: options.env ?? environment,
      encoding: 'utf8',
      maxBuffer: 32 * 1024 * 1024,
      stdio: options.stdio ?? 'pipe',
    }) : runIntegrationChild(spawn, command, args, {
      cwd: options.cwd ?? backendRoot,
      env: options.env ?? environment,
      encoding: 'utf8',
      maxBuffer: 32 * 1024 * 1024,
      stdio: options.stdio ?? 'pipe',
    }, childTimeoutMs)

    if (result.stdout) process.stdout.write(result.stdout)
    if (result.stderr) process.stderr.write(result.stderr)

    if (result.status !== 0) {
      throw new CommandFailure(command, args, result.status ?? 1)
    }
    if (command === 'bun' && args[0] === 'test') {
      const output = `${result.stdout ?? ''}\n${result.stderr ?? ''}`
      const summary = parseBunSummary(output)
      const expectedFiltered = maxOnly ? expectedMaxHistoricalExclusions(testFile) : 0
      if (!summary || summary.passed === 0 || summary.skipped !== 0 || summary.filtered !== expectedFiltered) {
        throw new Error(`Required integration evidence invalid for ${testFile ?? '(unknown test file)'}: ${JSON.stringify(summary)}`)
      }
    }
  }

  const waitForComposePostgres = async () => {
    for (let attempt = 1; attempt <= 30; attempt += 1) {
      const result = spawn(
        'docker',
        [
          ...composeArgs,
          'exec',
          '-T',
          postgresTestService,
          'pg_isready',
          '-U',
          'superuser',
          '-d',
          'web_app_demo_test',
        ],
        {
          cwd: repositoryRoot,
          env,
          stdio: 'ignore',
        },
      )

      if (result.status === 0) return
      await new Promise((resolveWait) => setTimeout(resolveWait, 1_000))
    }

    throw new Error(`Timed out waiting for Docker Compose service "${postgresTestService}"`)
  }

  const cleanupDocker = () => {
    const cleanupFailures = []
    const steps = [
      [
        'docker',
        [...composeArgs, 'rm', '--stop', '--force', '--volumes', postgresTestService],
        { cwd: repositoryRoot, env },
      ],
      [
        'docker',
        ['volume', 'rm', '--force', `${dockerProjectName}_${postgresTestDataVolume}`],
        { cwd: repositoryRoot, env, stdio: 'ignore' },
      ],
      [
        'docker',
        ['network', 'rm', `${dockerProjectName}_default`],
        { cwd: repositoryRoot, env, stdio: 'ignore' },
      ],
    ]

    for (const [command, args, options] of steps) {
      try {
        run(command, args, options)
      } catch (error) {
        cleanupFailures.push(error)
      }
    }

    if (cleanupFailures.length > 0) {
      throw new AggregateError(cleanupFailures, 'Could not fully remove the integration database')
    }
  }

  let primaryFailure

  try {
    if (managesDocker) {
      run('docker', [...composeArgs, 'up', '-d', postgresTestService], {
        cwd: repositoryRoot,
        env,
      })
      await waitForComposePostgres()
    }

    run('bun', ['run', 'prisma:generate'], { env })
    run('bun', ['run', 'prisma:deploy'], { env })

    if (!selectedTestRun) {
      throw new Error('No *.integration.test.* files found under backend/src or backend/scripts')
    }
    for (const testFile of selectedTestRun.testFiles) {
      run('bun', ['test', ...withIntegrationDefaults(selectedTestRun.bunTestArgs), testFile], { env })
    }
  } catch (error) {
    primaryFailure = error
  } finally {
    if (managesDocker && !keepsDocker) {
      try {
        cleanupDocker()
      } catch (cleanupFailure) {
        if (primaryFailure) {
          writeError(`Docker cleanup also failed: ${errorMessage(cleanupFailure)}`)
        } else {
          primaryFailure = cleanupFailure
        }
      }
    }
  }

  if (primaryFailure) throw primaryFailure
}

export function expectedMaxHistoricalExclusions(testFile) {
  return [
    'src/modules/auth/max-auth.integration.test.ts',
    'src/modules/families/family-access.integration.test.ts',
  ].includes(testFile) ? 1 : 0
}

function parseBunSummary(output) {
  const ran = [...output.matchAll(/Ran\s+\d+\s+tests?\s+across\s+\d+\s+files?\b[^\n]*/gi)].at(-1)
  if (!ran) return null
  const end = ran.index + ran[0].length
  const before = output.slice(0, ran.index)
  const pass = [...before.matchAll(/\b(\d+)\s+pass\b/gi)].at(-1)
  if (!pass) return null
  const block = output.slice(pass.index, end)
  return {
    passed: Number(pass[1]),
    skipped: Number(block.match(/\b(\d+)\s+skip\b/i)?.[1] ?? 0),
    filtered: Number(block.match(/\b(\d+)\s+filtered out\b/i)?.[1] ?? 0),
  }
}

const requiredMaxVerificationCategories = [
  ['current candidate and permitted rollback compatibility', (file) => /^scripts\/[^/]*comments[^/]*release[^/]*\.integration\.test\./i.test(file)],
  ['MAX authentication', (file) => /^src\/modules\/auth\/.*max.*\.integration\.test\./i.test(file)],
  ['database concurrency', (file) => /^src\/db\.integration\.test\./.test(file)],
  ['outbox persistence', (file) => /^src\/outbox\/.*\.integration\.test\./.test(file)],
  ['family ACL', (file) => /^src\/modules\/families\/family-access\.integration\.test\./.test(file)],
  ['private media access', (file) => /^src\/modules\/media\/media-access\.integration\.test\./.test(file)],
  ['upload persistence', (file) => /^src\/modules\/uploads\/.*\.integration\.test\./.test(file)],
  ['user and auth state', (file) => /^src\/modules\/users\/.*\.integration\.test\./.test(file)],
  ['MAX media delivery', (file) => /^src\/modules\/max\/.*media.*\.integration\.test\./i.test(file)],
  ['memory/comment behavior', (file) => /^src\/modules\/memories\/(?:memories|comments)[^/]*\.integration\.test\./.test(file)],
  ['migration upgrade coverage', (file) => /^scripts\/.*(?:upgrade|migration).*\.integration\.test\./i.test(file)],
]

export function missingMaxVerificationCategories(allIntegrationFiles) {
  return requiredMaxVerificationCategories
    .filter(([, matches]) => !allIntegrationFiles.some((file) => matches(file)))
    .map(([name]) => name)
}

function isHistoricalIntegration(file) {
  return /^scripts\/(?:historical|history)\//i.test(file) || /(?:^|\/)historical[^/]*\.integration\.test\./i.test(file)
}

export function selectMaxVerificationIntegration(allIntegrationFiles) {
  const currentFiles = allIntegrationFiles.filter((file) => !isHistoricalIntegration(file))
  const missing = missingMaxVerificationCategories(currentFiles)
  if (missing.length) throw new Error(`MAX verification catalog is missing required categories: ${missing.join(', ')}`)
  const selected = currentFiles.filter((file) =>
    !/^src\/modules\/telegram\//i.test(file) &&
    !/^src\/modules\/auth\/telegram-auth\.integration\.test\./i.test(file) &&
    !/^src\/modules\/(?:families|auth)\/[^/]*telegram[^/]*\.integration\.test\./i.test(file),
  )
  if (selected.length === 0) throw new Error('MAX verification catalog selected no integration suites')
  return selected
}

export function selectHistoricalIntegration(allIntegrationFiles) {
  const selected = allIntegrationFiles.filter(isHistoricalIntegration)
  if (selected.length === 0) throw new Error('No opt-in historical integration suites were discovered')
  return selected
}

function withIntegrationDefaults(bunTestArgs) {
  const defaults = [...bunTestArgs]

  // Every integration file shares one disposable PostgreSQL database. Bun otherwise executes
  // files concurrently, so one file's cleanup can race another file's transaction and hang the
  // suite. A caller can still opt into a different value for an explicitly isolated run.
  if (!defaults.some((argument) => argument.startsWith('--max-concurrency='))) {
    defaults.push('--max-concurrency=1')
  }
  if (!defaults.some((argument) => argument.startsWith('--timeout='))) {
    defaults.push(`--timeout=${integrationTestTimeoutMs}`)
  }

  return defaults
}

function errorMessage(error) {
  if (error instanceof AggregateError) {
    return `${error.message}: ${[...error.errors].map(errorMessage).join('; ')}`
  }
  return error instanceof Error ? error.message : String(error)
}

if (import.meta.main) {
  try {
    await runBackendIntegration({ testArgs: process.argv.slice(2) })
  } catch (error) {
    process.stderr.write(`${errorMessage(error)}\n`)
    process.exitCode = error instanceof CommandFailure ? error.exitCode : 1
  }
}
