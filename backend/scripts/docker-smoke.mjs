import { spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { createServer } from 'node:net'
import {
  assertTestDatabaseUrl,
  composeEnv,
  defaultTestDatabaseUrl,
  postgresTestDataVolume,
  postgresTestService,
  repositoryHash,
  repositoryRoot,
} from '../../scripts/repo-env.mjs'

const imageName = process.env.BACKEND_DOCKER_SMOKE_IMAGE ?? 'vibecoding-template-backend:smoke'
const smokeResources = createDockerSmokeResources({
  repositoryHash,
  processId: process.pid,
  runId: randomUUID().replaceAll('-', '').slice(0, 16),
})
const { projectName, containerName, networkName } = smokeResources
const postgresHostPort = await findOpenPort()
const hostPort = process.env.BACKEND_DOCKER_SMOKE_PORT ?? String(await findOpenPort(new Set([postgresHostPort])))
const hostPortNumber = Number(hostPort)
if (!/^\d+$/.test(hostPort) || !Number.isInteger(hostPortNumber) || hostPortNumber < 1 || hostPortNumber > 65_535 || hostPortNumber === postgresHostPort) {
  throw new Error('Docker smoke application host port is invalid or conflicts with its PostgreSQL port')
}
const { host: databaseUrlForHost, container: databaseUrlForContainer } = dockerSmokeDatabaseUrls(postgresHostPort)
const composeArgs = ['compose', '-p', projectName]
assertTestDatabaseUrl(databaseUrlForHost)
assertTestDatabaseUrl(databaseUrlForContainer)
const dockerEnv = composeEnv({
  COMPOSE_PROJECT_NAME: projectName,
  POSTGRES_TEST_PORT: String(postgresHostPort),
})
let smokeContainerCreated = false

export function createDockerSmokeResources({ repositoryHash, processId, runId }) {
  if (typeof repositoryHash !== 'string' || !/^[a-f0-9]{12}$/.test(repositoryHash)) throw new Error('Docker smoke repository hash is invalid')
  if (!Number.isSafeInteger(processId) || processId <= 0) throw new Error('Docker smoke process ID is invalid')
  if (typeof runId !== 'string' || !/^[a-f0-9]{16}$/.test(runId)) throw new Error('Docker smoke run ID is invalid')
  const projectName = `vibecoding-docker-smoke-${repositoryHash}-${processId}-${runId}`
  return {
    projectName,
    containerName: `${projectName}-backend`,
    networkName: `${projectName}_default`,
    volumeName: `${projectName}_${postgresTestDataVolume}`,
  }
}

export function dockerSmokeDatabaseUrls(postgresHostPort) {
  if (!Number.isInteger(postgresHostPort) || postgresHostPort < 1 || postgresHostPort > 65_535) {
    throw new Error('Docker smoke PostgreSQL host port is invalid')
  }
  return {
    host: defaultTestDatabaseUrl(postgresHostPort),
    container: 'postgresql://superuser:superpassword@postgres_test:5432/web_app_demo_test?schema=public',
  }
}

export function dockerSmokeCleanupPlan(resources, containerCreated) {
  const plan = []
  if (containerCreated) plan.push(['docker', ['rm', '-f', resources.containerName]])
  plan.push(
    ['docker', ['compose', '-p', resources.projectName, 'rm', '--stop', '--force', '--volumes', postgresTestService]],
    ['docker', ['volume', 'rm', '--force', resources.volumeName]],
    ['docker', ['network', 'rm', resources.networkName]],
  )
  return plan
}

export function dockerSmokeRuntimeEnv(databaseUrl) {
  // Keep the image's NODE_ENV=production and S3 storage guard intact while avoiding any live bot.
  return [
    'PORT=3000',
    `DATABASE_URL=${databaseUrl}`,
    `JWT_SECRET=${'0123456789abcdef'.repeat(4)}`,
    'CORS_ORIGINS=https://web.example.com',
    'COOKIE_SECURE=true',
    'TELEGRAM_ENABLED=false',
    'PRIVATE_STORAGE_DRIVER=s3',
    'PRIVATE_STORAGE_REGION=us-east-1',
    'PRIVATE_STORAGE_BUCKET=docker-smoke-not-a-real-bucket',
    'PRIVATE_STORAGE_ENDPOINT=https://storage.invalid',
    'PRIVATE_STORAGE_ACCESS_KEY_ID=docker-smoke-not-a-real-key',
    'PRIVATE_STORAGE_SECRET_ACCESS_KEY=docker-smoke-not-a-real-secret',
    'PRIVATE_STORAGE_ALLOW_REMOTE_ENDPOINT=true',
  ]
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? repositoryRoot,
    env: options.env ?? process.env,
    stdio: 'inherit',
  })

  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed with exit code ${result.status ?? 1}`)
  }
}

function findOpenPort(excluded = new Set()) {
  return new Promise((resolve, reject) => {
    const server = createServer()

    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      server.close((error) => {
        if (error) {
          reject(error)
          return
        }
        if (address && typeof address === 'object') {
          if (excluded.has(address.port)) {
            void findOpenPort(excluded).then(resolve, reject)
            return
          }
          resolve(address.port)
          return
        }

        reject(new Error('Could not allocate an open TCP port'))
      })
    })
  })
}

async function waitForComposePostgres() {
  for (let attempt = 1; attempt <= 30; attempt += 1) {
    const result = spawnSync(
      'docker',
      [
        ...composeArgs,
        'exec',
        '-T',
        'postgres_test',
        'pg_isready',
        '-U',
        'superuser',
        '-d',
        'web_app_demo_test',
      ],
      {
        cwd: repositoryRoot,
        env: dockerEnv,
        stdio: 'ignore',
      },
    )

    if (result.status === 0) {
      return
    }

    await new Promise((resolveWait) => setTimeout(resolveWait, 1_000))
  }

  process.stderr.write('Timed out waiting for postgres_test\n')
  throw new Error('Timed out waiting for postgres_test')
}

async function waitForHealth() {
  const url = `http://127.0.0.1:${hostPort}/health/ready`

  for (let attempt = 1; attempt <= 30; attempt += 1) {
    try {
      const response = await fetch(url)
      if (response.ok) {
        process.stdout.write(`Backend Docker smoke passed: ${url}\n`)
        return
      }
    } catch {
      // Retry until the container finishes booting.
    }

    await new Promise((resolveWait) => setTimeout(resolveWait, 1_000))
  }

  process.stderr.write(`Timed out waiting for ${url}\n`)
  spawnSync('docker', ['logs', containerName], { stdio: 'inherit' })
  throw new Error(`Timed out waiting for ${url}`)
}

async function smokeAuthApi() {
  const baseUrl = `http://127.0.0.1:${hostPort}`
  const start = await fetch(`${baseUrl}/api/v1/auth/browser-link/start`, {
    method: 'POST',
    headers: { Origin: 'https://web.example.com' },
  })

  if (start.status !== 200) {
    throw new Error(`Browser link start failed with HTTP ${start.status}: ${await start.text()}`)
  }

  const challenge = await start.json()
  if (typeof challenge.challengeId !== 'string' || !/^\d{24}$/.test(challenge.challengeId)) {
    throw new Error('Browser link start response did not include a valid challenge ID')
  }

  const setCookie = start.headers.get('set-cookie')
  const verifierCookie = setCookie?.split(';', 1)[0]
  if (!verifierCookie?.startsWith('web_app_demo_browser_link=')) {
    throw new Error('Browser link start response did not set the verifier cookie')
  }

  const status = await fetch(
    `${baseUrl}/api/v1/auth/browser-link/${challenge.challengeId}/status`,
    { headers: { Cookie: verifierCookie } },
  )
  if (status.status !== 200) {
    throw new Error(`Browser link status failed with HTTP ${status.status}: ${await status.text()}`)
  }

  const statusBody = await status.json()
  if (statusBody.status !== 'pending') {
    throw new Error(`Expected pending browser link challenge, received ${statusBody.status}`)
  }

  process.stdout.write('Backend Docker DB-backed browser-link auth smoke passed\n')
}

async function runDockerSmoke() {
  try {
    run('docker', [...composeArgs, 'up', '-d', 'postgres_test'], { env: dockerEnv })
    await waitForComposePostgres()

    run('bun', ['run', '--cwd', 'backend', 'prisma:deploy'], {
      env: {
        ...process.env,
        DATABASE_URL: databaseUrlForHost,
      },
    })

    run('docker', ['build', '-f', 'backend/Dockerfile', '-t', imageName, '.'])

    run('docker', [
      'run',
      '-d',
      '--name',
      containerName,
      '--network',
      networkName,
      '-p',
      `127.0.0.1:${hostPort}:3000`,
      ...dockerSmokeRuntimeEnv(databaseUrlForContainer).flatMap((value) => ['-e', value]),
      imageName,
    ])
    smokeContainerCreated = true

    await waitForHealth()
    await smokeAuthApi()
  } finally {
    for (const [command, args] of dockerSmokeCleanupPlan(smokeResources, smokeContainerCreated)) {
      spawnSync(command, args, {
        cwd: repositoryRoot,
        env: dockerEnv,
        stdio: command === 'docker' && args[0] === 'compose' ? 'inherit' : 'ignore',
      })
    }
  }
}

if (import.meta.main) await runDockerSmoke()
