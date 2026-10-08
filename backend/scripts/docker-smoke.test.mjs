import { expect, test } from 'bun:test'
import { mkdtemp, rmdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  buildDockerSmokeImage,
  createDockerSmokeResources,
  dockerSmokeCleanupPlan,
  dockerSmokeDatabaseUrls,
  dockerSmokeRunArgs,
  dockerSmokeRuntimeEnv,
  waitForComposePostgres,
} from './docker-smoke.mjs'

test('Docker smoke waits until PostgreSQL accepts TCP connections, not just Unix-socket startup', async () => {
  let probeCount = 0
  let waitCount = 0
  const fakePgIsReady = (_command, args) => {
    probeCount += 1
    const hostIndex = args.indexOf('-h')
    const asksForTcp = hostIndex >= 0 && args[hostIndex + 1] === '127.0.0.1'
    // The temporary postgres:18 init server is Unix-socket-ready first; TCP opens on probe 3.
    return { status: asksForTcp ? (probeCount >= 3 ? 0 : 1) : 0 }
  }

  await waitForComposePostgres({ runProbe: fakePgIsReady, wait: async () => { waitCount += 1 } })

  expect(probeCount).toBe(3)
  expect(waitCount).toBe(2)
})

test('Docker smoke bounds PostgreSQL TCP readiness polling at 30 attempts', async () => {
  let probeCount = 0
  let waitCount = 0
  await expect(waitForComposePostgres({
    runProbe: () => { probeCount += 1; return { status: 1 } },
    wait: async () => { waitCount += 1 },
  })).rejects.toThrow('Timed out waiting for postgres_test')

  expect(probeCount).toBe(30)
  expect(waitCount).toBe(30)
})

test('Docker smoke runs the image built by this invocation after another build retags the shared label', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'docker-smoke-image-isolation-'))
  const tag = 'vibecoding-template-backend:smoke'
  const imageIds = ['sha256:' + 'a'.repeat(64), 'sha256:' + 'b'.repeat(64)]
  const imageByTag = new Map()
  const launchedImages = []
  let buildCount = 0

  const fakeDocker = (_command, args) => {
    if (args[0] === 'build') {
      const iidFileIndex = args.indexOf('--iidfile')
      if (iidFileIndex >= 0) return writeFile(args[iidFileIndex + 1], imageIds[buildCount]).then(() => {
        imageByTag.set(args[args.indexOf('-t') + 1], imageIds[buildCount++])
      })
      imageByTag.set(args[args.indexOf('-t') + 1], imageIds[buildCount++])
      return undefined
    }
    if (args[0] === 'run') {
      const imageRef = args.at(-1)
      launchedImages.push(imageByTag.get(imageRef) ?? imageRef)
    }
  }

  try {
    const firstImage = await buildDockerSmokeImage({
      runDocker: fakeDocker,
      imageName: tag,
      iidFile: join(directory, 'first.iid'),
    })
    await buildDockerSmokeImage({
      runDocker: fakeDocker,
      imageName: tag,
      iidFile: join(directory, 'second.iid'),
    })
    const runArgs = dockerSmokeRunArgs({
      containerName: 'run-owned-container',
      networkName: 'run-owned-network',
      hostPort: 34877,
      databaseUrl: 'postgresql://superuser:superpassword@postgres_test:5432/web_app_demo_test?schema=public',
      imageId: firstImage,
    })
    fakeDocker('docker', runArgs)

    expect(imageByTag.get(tag)).toBe(imageIds[1])
    expect(launchedImages).toEqual([imageIds[0]])
    expect(runArgs.at(-1)).toBe(imageIds[0])
  } finally {
    await Promise.all(['first.iid', 'second.iid'].map((name) => rm(join(directory, name), { force: true })))
    await rmdir(directory)
  }
})

test('Docker smoke rejects a missing or malformed build IID before it can be used for a run', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'docker-smoke-invalid-iid-'))
  const iidFile = join(directory, 'missing.iid')
  try {
    await expect(buildDockerSmokeImage({ runDocker: () => undefined, imageName: 'synthetic:tag', iidFile }))
      .rejects.toThrow()
    await writeFile(iidFile, 'synthetic:tag\n')
    await expect(buildDockerSmokeImage({ runDocker: () => undefined, imageName: 'synthetic:tag', iidFile }))
      .rejects.toThrow('immutable image ID')
    expect(() => dockerSmokeRunArgs({
      containerName: 'run-owned-container',
      networkName: 'run-owned-network',
      hostPort: 34877,
      databaseUrl: 'postgresql://superuser:superpassword@postgres_test:5432/web_app_demo_test?schema=public',
      imageId: 'synthetic:tag',
    })).toThrow('immutable image ID')
  } finally {
    await rm(iidFile, { force: true })
    await rmdir(directory)
  }
})

test('Docker smoke resources use a run-owned Compose project and test databases', () => {
  const previous = Object.fromEntries(['COMPOSE_PROJECT_NAME', 'TEST_DATABASE_URL', 'BACKEND_DOCKER_SMOKE_DATABASE_URL', 'BACKEND_DOCKER_SMOKE_CONTAINER'].map((key) => [key, process.env[key]]))
  try {
    process.env.COMPOSE_PROJECT_NAME = 'foreign-app-project'
    process.env.TEST_DATABASE_URL = 'postgresql://other:other@localhost:5432/foreign_app'
    process.env.BACKEND_DOCKER_SMOKE_DATABASE_URL = 'postgresql://other:other@foreign-db:5432/foreign_app'
    process.env.BACKEND_DOCKER_SMOKE_CONTAINER = 'foreign-app-container'

    const resources = createDockerSmokeResources({ repositoryHash: '0123456789ab', processId: 42, runId: 'abcdef1234567890' })
    const urls = dockerSmokeDatabaseUrls(34876)

    expect(resources.projectName).toBe('vibecoding-docker-smoke-0123456789ab-42-abcdef1234567890')
    expect(resources.projectName).not.toBe(process.env.COMPOSE_PROJECT_NAME)
    expect(resources.networkName).toBe(`${resources.projectName}_default`)
    expect(resources.volumeName).toBe(`${resources.projectName}_postgres_18_test_data`)
    expect(resources.containerName).toBe(`${resources.projectName}-backend`)
    expect(resources.containerName).not.toBe(process.env.BACKEND_DOCKER_SMOKE_CONTAINER)
    expect(urls.host).toBe('postgresql://superuser:superpassword@localhost:34876/web_app_demo_test?schema=public')
    expect(urls.container).toBe('postgresql://superuser:superpassword@postgres_test:5432/web_app_demo_test?schema=public')
    expect(urls.host).not.toBe(process.env.TEST_DATABASE_URL)
    expect(urls.container).not.toBe(process.env.BACKEND_DOCKER_SMOKE_DATABASE_URL)
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  }
})

test('Docker smoke cleanup targets only its isolated project and only removes its owned app container', () => {
  const previousProject = process.env.COMPOSE_PROJECT_NAME
  process.env.COMPOSE_PROJECT_NAME = 'foreign-app-project'
  try {
    const resources = createDockerSmokeResources({ repositoryHash: '0123456789ab', processId: 42, runId: 'abcdef1234567890' })
    const notCreated = dockerSmokeCleanupPlan(resources, false)
    const created = dockerSmokeCleanupPlan(resources, true)

    expect(notCreated).toEqual([
      ['docker', ['compose', '-p', resources.projectName, 'rm', '--stop', '--force', '--volumes', 'postgres_test']],
      ['docker', ['volume', 'rm', '--force', resources.volumeName]],
      ['docker', ['network', 'rm', resources.networkName]],
    ])
    expect(created[0]).toEqual(['docker', ['rm', '-f', resources.containerName]])
    expect(created.slice(1)).toEqual(notCreated)
    expect(JSON.stringify([...notCreated, ...created])).not.toContain('foreign-app-project')
  } finally {
    if (previousProject === undefined) delete process.env.COMPOSE_PROJECT_NAME
    else process.env.COMPOSE_PROJECT_NAME = previousProject
  }
})

test('Docker auth smoke keeps production storage rules and disables live Telegram startup', () => {
  const env = dockerSmokeRuntimeEnv(
    'postgresql://superuser:superpassword@postgres_test:5432/web_app_demo_test?schema=public',
  )

  expect(env).toContain(
    'DATABASE_URL=postgresql://superuser:superpassword@postgres_test:5432/web_app_demo_test?schema=public',
  )
  expect(env).toContain('TELEGRAM_ENABLED=false')
  expect(env.some((entry) => entry.startsWith('TELEGRAM_BOT_TOKEN='))).toBe(false)
  expect(env).toContain('PRIVATE_STORAGE_DRIVER=s3')
  expect(env).toContain('PRIVATE_STORAGE_ENDPOINT=https://storage.invalid')
  expect(env.some((entry) => entry.startsWith('NODE_ENV='))).toBe(false)
})
