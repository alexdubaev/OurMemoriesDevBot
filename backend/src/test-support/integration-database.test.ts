import { afterEach, describe, expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'

import { requireIntegrationDatabaseUrl } from './integration-database'

const original = { test: process.env.TEST_DATABASE_URL, database: process.env.DATABASE_URL }

afterEach(() => {
  if (original.test === undefined) delete process.env.TEST_DATABASE_URL
  else process.env.TEST_DATABASE_URL = original.test
  if (original.database === undefined) delete process.env.DATABASE_URL
  else process.env.DATABASE_URL = original.database
})

describe('integration database boundary', () => {
  test('refuses missing URLs before any test can construct its database client', () => {
    delete process.env.TEST_DATABASE_URL
    delete process.env.DATABASE_URL
    expect(() => requireIntegrationDatabaseUrl()).toThrow(/TEST_DATABASE_URL is required/)
  })

  test('refuses remote and non-test URLs before any database connection', () => {
    const unsafe = [
      'postgresql://synthetic:synthetic@db.example.test:5432/memoly_suite_test',
      'postgresql://synthetic:synthetic@127.0.0.1:5432/application',
    ]
    for (const value of unsafe) {
      process.env.TEST_DATABASE_URL = value
      process.env.DATABASE_URL = value
      expect(() => requireIntegrationDatabaseUrl()).toThrow(/loopback PostgreSQL/)
    }
  })

  test('refuses a separate runtime database URL', () => {
    process.env.TEST_DATABASE_URL = 'postgresql://synthetic:synthetic@127.0.0.1:5432/memoly_suite_test'
    process.env.DATABASE_URL = 'postgresql://synthetic:synthetic@127.0.0.1:5432/other_test'
    expect(() => requireIntegrationDatabaseUrl()).toThrow(/must match/)
  })

  test('direct integration entrypoint rejects an unsafe URL before trying to connect', () => {
    const result = spawnSync('bun', ['test', 'src/outbox/outbox.integration.test.ts'], {
      cwd: resolve(import.meta.dir, '../../..'),
      env: {
        ...process.env,
        DATABASE_URL: 'postgresql://synthetic:synthetic@127.0.0.1:1/memoly_suite_test?host=db.example.test',
        TEST_DATABASE_URL: 'postgresql://synthetic:synthetic@127.0.0.1:1/memoly_suite_test?host=db.example.test',
      },
      encoding: 'utf8',
      timeout: 10_000,
    })
    expect(result.status).not.toBe(0)
    expect(`${result.stdout}\n${result.stderr}`).toContain('loopback PostgreSQL')
    expect(`${result.stdout}\n${result.stderr}`).not.toContain('ECONNREFUSED')
  })

  test('direct integration entrypoint fails closed when infrastructure is missing', () => {
    const environment = { ...process.env }
    delete environment.TEST_DATABASE_URL
    delete environment.DATABASE_URL
    const result = spawnSync('bun', ['test', 'src/outbox/outbox.integration.test.ts'], {
      cwd: resolve(import.meta.dir, '../../..'),
      env: environment,
      encoding: 'utf8',
      timeout: 10_000,
    })
    expect(result.status).not.toBe(0)
    expect(`${result.stdout}\n${result.stderr}`).toContain('TEST_DATABASE_URL is required')
  })
})
