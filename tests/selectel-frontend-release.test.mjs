import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import test from 'node:test'
import { bashExecutable, gitBashPath, linuxPath, runLinuxRoot } from './bash-runtime.mjs'

const root = resolve(import.meta.dirname, '..')
const library = gitBashPath(resolve(root, 'deploy/selectel/frontend-release.sh'))
const linuxLibrary = linuxPath(resolve(root, 'deploy/selectel/frontend-release.sh'))
const entrypoint = gitBashPath(resolve(root, 'deploy/selectel/ci-release.sh'))
const appRoot = gitBashPath(root)
const hex = (char, size) => char.repeat(size)

function runBash(script) {
  return spawnSync(bashExecutable, ['-s'], { input: script, encoding: 'utf8', timeout: 30_000 })
}

function scopeScript(path) {
  return `
set -euo pipefail
APP_ROOT=${appRoot}
SERVER_ROOT=/mock
PRODUCT_SHA=${hex('d', 40)}
FRONTEND_BACKEND_SHA=${hex('b', 40)}
FRONTEND_OLD_SHA=${hex('c', 40)}
ACCEPTED_UI_V4_SHA=${hex('a', 40)}
git_root() {
  if [[ "$1" == merge-base ]]; then return 0; fi
  if [[ "$1" == diff && "$2" == --summary* ]]; then return 0; fi
  if [[ "$1" == diff && "$2" == --name-only* ]]; then printf '%s\\0' ${JSON.stringify(path)}; return 0; fi
  return 90
}
. ${library}
frontend_validate_scope ${hex('b', 40)}
`
}

test('frontend source guard admits vetted presentation and rejects runtime or unknown paths', async () => {
  const allowed = runBash(scopeScript('webapp/src/features/family/FamilyHubPage.tsx'))
  assert.equal(allowed.status, 0, `${allowed.stdout}${allowed.stderr}`)
  const denied = runBash(scopeScript('webapp/src/features/auth/LoginPage.tsx'))
  assert.notEqual(denied.status, 0)
  assert.match(denied.stderr, /refuses sensitive path/)
  const unknown = runBash(scopeScript('webapp/src/features/home/Widget.tsx'))
  assert.notEqual(unknown.status, 0)
  assert.match(unknown.stderr, /refuses unknown path/)
})

test('frontend entrypoint rejects forward markers before image capture or recovery', () => {
  const fixture = mkdtempSync(resolve(root, 'tests', '.frontend-marker-'))
  const marker = resolve(fixture, 'forward.marker')
  writeFileSync(marker, 'synthetic forward-only state\n')
  const script = `
set -- ${hex('d', 40)} DEPLOY false ExampleBot frontend
SERVER_ROOT=${gitBashPath(fixture)} APP_ROOT=${gitBashPath(root)} FORWARD_MARKER=${gitBashPath(marker)}
. ${entrypoint}
require_root() { :; }
require_command() { :; }
flock() { :; }
validate_repository() { :; }
validate_planned_source() { :; }
check_disk_space() { :; }
fetch_and_checkout() { printf 'CHECKOUT\\n'; }
capture_running_images() { printf 'IMAGE-CAPTURE\\n'; }
recover_forward_markers() { printf 'FORWARD-RECOVERY\\n'; }
main
`
  try {
    const result = runBash(script)
    assert.notEqual(result.status, 0)
    assert.match(result.stderr, /blocked while a backend forward-only marker exists/)
    assert.doesNotMatch(`${result.stdout}${result.stderr}`, /IMAGE-CAPTURE|FORWARD-RECOVERY|CHECKOUT/)
  } finally {
    rmSync(fixture, { recursive: true, force: true })
  }
})

test('frontend recovery state preserves existing server-root permissions', () => {
  const result = runLinuxRoot(`
set -euo pipefail
SERVER_ROOT=/mock
. ${linuxLibrary}
tmp=$(mktemp -d)
chmod 0755 "$tmp"
FRONTEND_STATE="$tmp/frontend-recovery.env"
FRONTEND_BACKEND_SHA=${hex('b', 40)}
FRONTEND_BACKEND_IDS=${hex('1', 64)}
FRONTEND_BACKEND_IMAGE_IDS=sha256:${hex('2', 64)}
FRONTEND_WORKER_IDS=${hex('3', 64)}
FRONTEND_WORKER_IMAGE_IDS=sha256:${hex('4', 64)}
FRONTEND_SCHEDULER_IDS=${hex('5', 64)}
FRONTEND_SCHEDULER_IMAGE_IDS=sha256:${hex('6', 64)}
FRONTEND_GATEWAY_ID=${hex('7', 64)}
FRONTEND_GATEWAY_IMAGE_ID=sha256:${hex('8', 64)}
FRONTEND_CONFIG_SHA256=${hex('9', 64)}
FRONTEND_OLD_SHA=${hex('c', 40)}
FRONTEND_OLD_ID=sha256:${hex('a', 64)}
FRONTEND_NEW_SHA=${hex('d', 40)}
FRONTEND_NEW_ID=sha256:${hex('f', 64)}
frontend_write_state pending
printf 'parent=%s file=%s owner=%s\\n' "$(stat -c %a "$tmp")" "$(stat -c %a "$FRONTEND_STATE")" "$(stat -c %u "$FRONTEND_STATE")"
rm -rf "$tmp"
`)
  assert.equal(result.status, 0, `${result.stdout}${result.stderr}`)
  assert.match(result.stdout, /parent=755 file=600 owner=0/)
})

test('frontend recovery refuses corrupt state before any runtime command', () => {
  const result = runLinuxRoot(`
set -euo pipefail
SERVER_ROOT=/mock
. ${linuxLibrary}
tmp=$(mktemp -d)
FRONTEND_STATE="$tmp/state"
printf 'FRONTEND_RECOVERY_VERSION=1\\nPHASE=pending\\ncorrupt\\n' > "$FRONTEND_STATE"
chmod 0600 "$FRONTEND_STATE"
docker() { printf 'DOCKER-MUTATION\\n'; }
frontend_load_state
`)
  assert.notEqual(result.status, 0)
  assert.doesNotMatch(result.stdout, /DOCKER-MUTATION/)
  assert.match(result.stderr, /invalid line count/)
})

test('frontend recovery restores only the exact recorded static image when static is absent', () => {
  const result = runBash(`
set -euo pipefail
SERVER_ROOT=/mock
. ${library}
COMPOSE_FILE=/mock/compose.yml COMPOSE_PROJECT=memoly SERVER_ROOT=/mock
FRONTEND_BACKEND_SHA=${hex('b', 40)} FRONTEND_OLD_SHA=${hex('c', 40)}
FRONTEND_OLD_ID=sha256:${hex('a', 64)} FRONTEND_NEW_ID=sha256:${hex('f', 64)}
FRONTEND_BACKEND_IDS=${hex('1', 64)} FRONTEND_BACKEND_IMAGE_IDS=sha256:${hex('2', 64)}
FRONTEND_WORKER_IDS=${hex('3', 64)} FRONTEND_WORKER_IMAGE_IDS=sha256:${hex('4', 64)}
FRONTEND_SCHEDULER_IDS=${hex('5', 64)} FRONTEND_SCHEDULER_IMAGE_IDS=sha256:${hex('6', 64)}
FRONTEND_GATEWAY_ID=${hex('7', 64)} FRONTEND_GATEWAY_IMAGE_ID=sha256:${hex('8', 64)}
FRONTEND_CONFIG_SHA256=${hex('9', 64)}
CURRENT=none
frontend_current_static() { printf '%s\\n' "$CURRENT"; }
frontend_internal_smoke() { printf 'STATIC-SMOKE:%s\\n' "$1"; }
frontend_assert_runtime_unchanged() { printf 'RETAINED-BACKEND-CHECK\\n'; }
frontend_write_state() { printf 'STATE:%s\\n' "$1"; }
docker() {
  printf 'DOCKER:backend=%s webapp=%s %s\\n' "\${MEMOLY_BACKEND_IMAGE_TAG:-}" "\${MEMOLY_WEBAPP_IMAGE_TAG:-}" "$*" >&2
  if [[ "$*" == *' up -d --no-deps --force-recreate static' ]]; then
    CURRENT='${hex('e', 64)}|sha256:${hex('a', 64)}|memoly-webapp:${hex('c', 40)}'
    return 0
  fi
  return 80
}
frontend_restore_static
`)
  assert.equal(result.status, 0, `${result.stdout}${result.stderr}`)
  assert.match(result.stderr, new RegExp(`DOCKER:backend=${hex('b', 40)} webapp=${hex('c', 40)} compose.*up -d --no-deps --force-recreate static`))
  assert.match(result.stdout, /STATE:restored/)
  assert.doesNotMatch(result.stdout, /up -d.*(backend|worker|scheduler)/)
})

