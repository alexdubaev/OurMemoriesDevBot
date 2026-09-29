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

test('release checkout is gated by tracked-path ownership and only switches as memoly', () => {
  const checkout = release.slice(release.indexOf('fetch_and_checkout() {'), release.indexOf('\n}\n\nvalidate_prebuilt_images'))
  assert.match(release, /git_memoly\(\)[\s\S]*sudo -n -u "\$APP_USER" git/)
  assert.match(release, /ls-tree -r --name-only -z/)
  assert.match(release, /check_tree_paths HEAD[\s\S]*check_tree_paths "\$PRODUCT_SHA"/)
  assert.match(checkout, /require_release_ownership[\s\S]*git_memoly switch --detach/)
  assert.match(checkout, /git_memoly switch --detach "\$PRODUCT_SHA"/)
  assert.doesNotMatch(checkout, /git_root switch|chown|reset|clean/)
  assert.match(checkout, /server checkout HEAD does not equal requested release SHA/)
  assert.match(checkout, /server checkout is dirty after release checkout/)
  assert.match(release, /require_command getent/)
})

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

test('ownership drift after build preparation is caught by the second guard', () => {
  const guard = release.match(/require_release_ownership\(\) \{[\s\S]*?\n\}/)?.[0]
  const buildBlock = release.slice(release.indexOf('if [ "$PREBUILT_IMAGES" = false ]; then'), release.indexOf('\n  if [ "$RESUMING_FORWARD_ONLY" = false ]; then prepare_rollback'))
  assert.ok(guard)
  assert.match(buildBlock, /build-images\.sh[\s\S]*require_release_ownership[\s\S]*git_memoly status --porcelain/)

  const temp = mkdtempSync(resolve(tmpdir(), 'selectel-owner-drift-'))
  try {
    const appRoot = resolve(temp, 'app root')
    const bashAppRoot = appRoot.replace(/^([A-Za-z]):[\\/]/, (_, drive) => `/mnt/${drive.toLowerCase()}/`).replaceAll('\\', '/')
    mkdirSync(resolve(appRoot, 'deploy path'), { recursive: true })
    writeFileSync(resolve(appRoot, 'deploy path', 'source file'), 'fixture')
    const harness = `
set -Eeuo pipefail
die() { printf 'ERROR: %s\\n' "$*" >&2; exit 1; }
${guard}
APP_ROOT='${bashAppRoot}'
APP_USER=memoly
APP_GROUP=memoly
PRODUCT_SHA=target
ROOT_OWNED_PATH=''
id() { printf '1001\\n'; }
getent() { printf 'memoly:x:1001:\\n'; }
stat() { if [ "$4" = "$ROOT_OWNED_PATH" ]; then printf '0 0\\n'; else printf '1001 1001\\n'; fi; }
git_memoly() { printf 'deploy path/source file\\0'; }
require_release_ownership
# Simulate build preparation leaving a tracked source file root-owned.
ROOT_OWNED_PATH="$APP_ROOT/deploy path/source file"
require_release_ownership
`
    const result = spawnSync('bash', ['-s'], { input: harness, encoding: 'utf8' })
    assert.notEqual(result.status, 0)
    assert.match(result.stderr, /unsafe checkout ownership at deploy path\/source file: expected memoly:memoly/)
  } finally {
    rmSync(temp, { recursive: true, force: true })
  }
})

test('build preparation uses an archive, and release checks that tracked source remains clean', () => {
  assert.match(builder, /repo_git archive --format=tar "\$PRODUCT_SHA" \| tar -xf - -C "\$BUILD_CONTEXT"/)
  assert.match(builder, /BUILD_CONTEXT=\$\(mktemp -d\)/)
  const build = release.slice(release.indexOf('if [ "$PREBUILT_IMAGES" = false ]; then'), release.indexOf('\n  if [ "$RESUMING_FORWARD_ONLY" = false ]; then prepare_rollback'))
  assert.match(build, /build-images\.sh[\s\S]*git_memoly status --porcelain[\s\S]*application checkout changed during image build preparation/)
  assert.match(release, /SERVER_ROOT=\$\{SERVER_ROOT:-\/opt\/memoly\}/)
  assert.match(release, /ROLLBACK_ENV=\$\{ROLLBACK_ENV:-\$SERVER_ROOT/)
  assert.match(release, /RELEASES_DIR=\$\{RELEASES_DIR:-\$SERVER_ROOT/)
  assert.match(builder, /BUILD_CONTEXT=\$\(mktemp -d\)/)
  assert.doesNotMatch(builder, /mktemp.*CHECKOUT_ROOT|install.*CHECKOUT_ROOT/)
})
