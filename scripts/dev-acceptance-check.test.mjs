import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'
import { expect, test } from 'bun:test'

test('fails closed when the local API is unavailable', () => {
  const result = spawnSync('bun', ['scripts/dev-acceptance-check.mjs'], {
    cwd: resolve(import.meta.dirname, '..'),
    env: { ...process.env, ACCEPTANCE_API_URL: 'http://127.0.0.1:1' },
    encoding: 'utf8',
  })

  expect(result.status).toBe(1)
  expect(`${result.stdout}${result.stderr}`).toContain('API unavailable')
})
