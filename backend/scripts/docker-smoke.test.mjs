import { expect, test } from 'bun:test'

import {
  createDockerSmokeResources,
  dockerSmokeCleanupPlan,
  dockerSmokeDatabaseUrls,
  dockerSmokeRuntimeEnv,
} from './docker-smoke.mjs'

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
