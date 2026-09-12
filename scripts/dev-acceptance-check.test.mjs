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

test('keeps a non-zero API stability window in the default acceptance gate', async () => {
  const source = await Bun.file(resolve(import.meta.dirname, 'dev-acceptance-check.mjs')).text()

  expect(source).toContain("ACCEPTANCE_STABILITY_MS ?? '15000'")
  expect(source).toContain("await requireResponse('API after stability window'")
})
