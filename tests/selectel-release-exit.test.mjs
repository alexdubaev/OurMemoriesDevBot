import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import test from 'node:test'

const root = resolve(import.meta.dirname, '..')
const release = readFileSync(resolve(root, 'deploy/selectel/ci-release.sh'), 'utf8').replaceAll('\r\n', '\n')
const start = release.indexOf('  release_failure() {')
const end = release.indexOf('\n  }\n  trap release_failure EXIT', start)
assert.ok(start >= 0 && end > start, 'release failure handler is present')
const releaseFailure = release.slice(start, end + 4)

function runHandler({ legacy = false, quiesced = false, promoted = false, trigger }) {
  return spawnSync('bash', ['-s'], {
    input: `
set -euo pipefail
LEGACY_MEMBERSHIP_RUNTIME=${legacy}
LEGACY_MM0_RUNTIME=false
QUIESCE_STARTED=${quiesced}
PROMOTION_STARTED=${promoted}
MM0_FORWARD_MARKER=/nonexistent-mm0-marker
APP_ROOT=/mock/app
bash() { printf 'ACTION:%s\\n' "$*"; return 0; }
${releaseFailure}
${trigger}
`,
    encoding: 'utf8',
    timeout: 30_000,
  })
}

test('successful release exit does not invoke failure side effects', () => {
  const result = runHandler({ trigger: 'true\nrelease_failure' })
  assert.equal(result.status, 0, `${result.stdout}${result.stderr}`)
  assert.equal(result.stdout, '')
  assert.equal(result.stderr, '')
})

test('nonzero release exit preserves forward-only quiesce handling', () => {
  const result = runHandler({
    legacy: true,
    quiesced: true,
    trigger: 'false || release_failure',
  })
  assert.equal(result.status, 1, `${result.stdout}${result.stderr}`)
  assert.match(result.stdout, /ACTION:.*quiesce-legacy/)
  assert.match(result.stderr, /legacy writers stopped for forward recovery/)
})

test('nonzero release exit preserves application rollback handling', () => {
  const result = runHandler({
    promoted: true,
    trigger: 'false || release_failure',
  })
  assert.equal(result.status, 1, `${result.stdout}${result.stderr}`)
  assert.match(result.stdout, /ACTION:.*rollback/)
  assert.match(result.stderr, /attempting application rollback/)
})
