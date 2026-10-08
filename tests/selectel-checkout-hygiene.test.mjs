import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { execFileSync, spawnSync } from 'node:child_process'
import test from 'node:test'
import assert from 'node:assert/strict'

const root = resolve(import.meta.dirname, '..')
const release = readFileSync(resolve(root, 'deploy/selectel/ci-release.sh'), 'utf8').replaceAll('\r', '')
const builder = readFileSync(resolve(root, 'deploy/selectel/build-images.sh'), 'utf8').replaceAll('\r', '')

function createGitFixture() {
  const temp = mkdtempSync(resolve(tmpdir(), 'selectel-checkout-'))
  const appRoot = resolve(temp, 'app root')
  mkdirSync(resolve(appRoot, 'deploy path'), { recursive: true })
  const git = (...args) => execFileSync('git', ['-C', appRoot, ...args], { encoding: 'utf8' }).trim()
  git('init', '-q')
  git('config', 'user.name', 'Checkout Fixture')
  git('config', 'user.email', 'checkout-fixture@example.test')
  git('config', 'core.autocrlf', 'false')
  git('remote', 'add', 'origin', 'git@github.com:alexdubaev/OurMemoriesDevBot.git')
  writeFileSync(resolve(appRoot, 'deploy path', 'app.css'), '.fixture { color: red; }\n')
  git('add', 'deploy path/app.css')
  git('commit', '-qm', 'old source')
  const oldSha = git('rev-parse', 'HEAD')
  writeFileSync(resolve(appRoot, 'deploy path', 'app.css'), '.fixture { color: blue; }\n')
  git('commit', '-qam', 'target source')
  const targetSha = git('rev-parse', 'HEAD')
  git('update-ref', 'refs/remotes/origin/main', targetSha)
  git('switch', '--detach', oldSha)
  return { temp, appRoot, targetSha }
}

test('release ownership guard accepts a clean tree and stops on a root-owned ancestor', () => {
  const guard = release.match(/require_release_ownership\(\) \{[\s\S]*?\n\}/)?.[0]
  assert.ok(guard)
  const temp = mkdtempSync(resolve(tmpdir(), 'selectel-owner-'))
  try {
    const appRoot = resolve(temp, 'app root')
    const bashAppRoot = appRoot.replace(/^([A-Za-z]):[\\/]/, (_, drive) => `/mnt/${drive.toLowerCase()}/`).replaceAll('\\', '/')
    const trackedFile = resolve(appRoot, 'deploy path', 'source file')
    mkdirSync(resolve(appRoot, 'deploy path'), { recursive: true })
    writeFileSync(trackedFile, 'fixture')
    const harness = `
set -Eeuo pipefail
die() { printf 'ERROR: %s\\n' "$*" >&2; exit 1; }
${guard}
APP_ROOT='${bashAppRoot}'
APP_USER=memoly
APP_GROUP=memoly
PRODUCT_SHA=target
ROOT_OWNED_PATH=''
id() { [ "$1" = -u ] && printf '1001\\n' || printf '1001\\n'; }
getent() { printf 'memoly:x:1001:\\n'; }
stat() {
  if [ "$4" = "$ROOT_OWNED_PATH" ]; then printf '0 0\\n'; else printf '1001 1001\\n'; fi
}
git_memoly() {
  [ "$1" = ls-tree ] || return 90
  printf 'deploy path/source file\\0'
}
require_release_ownership
`
    const clean = spawnSync('bash', ['-s'], {
      input: harness,
      encoding: 'utf8',
    })
    assert.equal(clean.status, 0, `${clean.stdout}${clean.stderr}`)

    const unsafe = spawnSync('bash', ['-s'], {
      input: harness.replace("ROOT_OWNED_PATH=''", `ROOT_OWNED_PATH='${bashAppRoot}/deploy path'`),
      encoding: 'utf8',
    })
    assert.notEqual(unsafe.status, 0)
    assert.match(unsafe.stderr, /unsafe checkout ownership at deploy path: expected memoly:memoly/)
  } finally {
    rmSync(temp, { recursive: true, force: true })
  }
})

test('modified tracked source fails closed and a clean target checkout updates source content', () => {
  const validate = release.match(/validate_repository\(\) \{[\s\S]*?\n\}/)?.[0]
  const guard = release.match(/require_release_ownership\(\) \{[\s\S]*?\n\}/)?.[0]
  const checkout = release.match(/fetch_and_checkout\(\) \{[\s\S]*?\n\}/)?.[0]
  assert.ok(validate && guard && checkout)
  const fixture = createGitFixture()
  const bashRoot = fixture.appRoot.replace(/^([A-Za-z]):[\\/]/, (_, drive) => `/mnt/${drive.toLowerCase()}/`).replaceAll('\\', '/')
  try {
    const harness = `
set -Eeuo pipefail
die() { printf 'ERROR: %s\\n' "$*" >&2; exit 1; }
APP_ROOT='${bashRoot}'
APP_USER=memoly
APP_GROUP=memoly
PRODUCT_SHA='${fixture.targetSha}'
id() { printf '1001\\n'; }
getent() { printf 'memoly:x:1001:\\n'; }
stat() { printf '1001 1001\\n'; }
git_memoly() {
  if [ "$1" = fetch ]; then return 0; fi
  git -C "$APP_ROOT" "$@"
}
git_root() { git -C "$APP_ROOT" "$@"; }
${validate}
${guard}
${checkout}
validate_repository
fetch_and_checkout
test "$(cat "$APP_ROOT/deploy path/app.css")" = '.fixture { color: blue; }'
test -z "$(git_root status --porcelain)"
test "$(git_root rev-parse HEAD)" = "$PRODUCT_SHA"
test ! -e "$APP_ROOT/.runtime/generated.json"
`
    const clean = spawnSync('bash', ['-s'], { input: harness, encoding: 'utf8' })
    assert.equal(clean.status, 0, `${clean.stdout}${clean.stderr}`)

    const dirty = spawnSync('bash', ['-s'], {
      input: harness.replace('validate_repository\nfetch_and_checkout', "printf 'dirty\\n' >> \"$APP_ROOT/deploy path/app.css\"\nvalidate_repository\nfetch_and_checkout"),
      encoding: 'utf8',
    })
    assert.notEqual(dirty.status, 0)
    assert.match(dirty.stderr, /application checkout must be clean before release/)
  } finally {
    rmSync(fixture.temp, { recursive: true, force: true })
  }
})
