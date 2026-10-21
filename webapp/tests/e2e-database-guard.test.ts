import { expect, test } from 'bun:test'
import { assertE2eDatabaseConfiguration } from '../e2e/env'
import { resolveE2ePorts } from '../e2e/ports'

const localTestUrl = 'postgresql://tester:synthetic@127.0.0.1:5432/any_owned_test'

test('E2E startup requires an explicit test database when Docker is skipped', () => {
  expect(() => assertE2eDatabaseConfiguration(localTestUrl, undefined, true)).toThrow(/explicit TEST_DATABASE_URL or DATABASE_URL/)
  expect(() => assertE2eDatabaseConfiguration(localTestUrl, localTestUrl, true)).not.toThrow()
})

test('E2E database safety rejects remote hosts, routing overrides and mismatched database URLs', () => {
  expect(() => assertE2eDatabaseConfiguration('postgresql://tester:synthetic@db.example/any_owned_test', undefined, false)).toThrow()
  expect(() => assertE2eDatabaseConfiguration(`${localTestUrl}?host=db.example`, undefined, false)).toThrow()
  expect(() => assertE2eDatabaseConfiguration(localTestUrl, localTestUrl.replace('any_owned_test', 'other_test'), false)).toThrow()
})

test('E2E port bootstrap rejects implicit or mismatched database configuration before server setup', async () => {
  const names = ['TEST_DATABASE_URL', 'DATABASE_URL', 'E2E_SKIP_DOCKER', 'POSTGRES_TEST_PORT', 'E2E_BACKEND_URL', 'E2E_WEB_URL'] as const
  const previous = new Map(names.map((name) => [name, process.env[name]]))
  try {
    for (const name of names) delete process.env[name]
    process.env.E2E_SKIP_DOCKER = '1'
    process.env.POSTGRES_TEST_PORT = '5432'
    process.env.E2E_BACKEND_URL = 'http://127.0.0.1:51423'
    process.env.E2E_WEB_URL = 'http://127.0.0.1:55423'
    await expect(resolveE2ePorts()).rejects.toThrow(/explicit TEST_DATABASE_URL or DATABASE_URL/)

    process.env.TEST_DATABASE_URL = localTestUrl
    process.env.DATABASE_URL = localTestUrl.replace('any_owned_test', 'other_test')
    await expect(resolveE2ePorts()).rejects.toThrow(/must match the run-owned TEST_DATABASE_URL/)
  } finally {
    for (const [name, value] of previous) {
      if (value === undefined) delete process.env[name]
      else process.env[name] = value
    }
  }
})
