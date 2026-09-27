import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import test from 'node:test'

const root = resolve(import.meta.dirname, '..')

test('all Bun Docker installs use bounded network concurrency', () => {
  const dockerfiles = [
    'backend/Dockerfile',
    'deploy/selectel/Dockerfile.webapp',
  ]

  for (const relativePath of dockerfiles) {
    const content = readFileSync(resolve(root, relativePath), 'utf8').replaceAll('\r\n', '\n')
    const installLines = content.split('\n').filter((line) => /^RUN .*bun install /.test(line))
    assert.ok(installLines.length > 0, `${relativePath} has a Bun install step`)
    for (const line of installLines) {
      assert.match(line, /BUN_CONFIG_MAX_HTTP_REQUESTS=8/)
      assert.match(line, /--network-concurrency 8/)
    }
  }
})
