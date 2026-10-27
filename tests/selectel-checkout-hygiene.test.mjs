import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { execFileSync, spawnSync } from 'node:child_process'
import test from 'node:test'
import assert from 'node:assert/strict'
import { bashExecutable, gitBashPath } from './bash-runtime.mjs'

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
    const bashAppRoot = gitBashPath(appRoot)
    const trackedFile = resolve(appRoot, 'deploy path', 'source file')
    const unicodeFile = resolve(appRoot, 'deploy path', '照片 source')
    mkdirSync(resolve(appRoot, 'deploy path'), { recursive: true })
    writeFileSync(trackedFile, 'fixture')
    writeFileSync(unicodeFile, 'fixture')
    const hasSymlink = process.platform !== 'win32'
    if (hasSymlink) symlinkSync(trackedFile, resolve(appRoot, 'deploy path', 'source link'))
    const statLog = resolve(temp, 'stat paths')
    const harness = `
set -Eeuo pipefail
die() { printf 'ERROR: %s\\n' "$*" >&2; exit 1; }
${guard}
APP_ROOT='${bashAppRoot}'
APP_USER=memoly
APP_GROUP=memoly
PRODUCT_SHA=target
ROOT_OWNED_PATH=''
STAT_LOG='${gitBashPath(statLog)}'
id() { [ "$1" = -u ] && printf '1001\\n' || printf '1001\\n'; }
getent() { printf 'memoly:x:1001:\\n'; }
stat() {
  printf '%s\\n' "$4" >> "$STAT_LOG"
  if [ "$4" = "$ROOT_OWNED_PATH" ]; then printf '0 0\\n'; else printf '1001 1001\\n'; fi
}
git_memoly() {
  [ "$1" = ls-tree ] || return 90
  case "$5" in
    HEAD|target) printf 'deploy path/source file\\0deploy path/照片 source\\0${hasSymlink ? 'deploy path/source link\\0' : ''}missing file\\0' ;;
    fail) return 91 ;;
    *) return 92 ;;
  esac
}
require_release_ownership
`
    const clean = spawnSync(bashExecutable, ['-s'], {
      input: harness,
      encoding: 'utf8',
    })
    assert.equal(clean.status, 0, `${clean.stdout}${clean.stderr}`)
    const statPaths = readFileSync(statLog, 'utf8').trim().split('\n')
    assert.equal(statPaths.filter((path) => path === `${bashAppRoot}/deploy path/source file`).length, 1)
    assert.equal(statPaths.filter((path) => path === `${bashAppRoot}/deploy path/照片 source`).length, 1)
    if (hasSymlink) assert.equal(statPaths.filter((path) => path === `${bashAppRoot}/deploy path/source link`).length, 1)
    assert.equal(statPaths.filter((path) => path === `${bashAppRoot}/deploy path`).length, 1)
    assert.equal(statPaths.includes(`${bashAppRoot}/missing file`), false, 'missing paths retain the existing no-stat behavior')

    const unsafe = spawnSync(bashExecutable, ['-s'], {
      input: harness.replace("ROOT_OWNED_PATH=''", `ROOT_OWNED_PATH='${bashAppRoot}/deploy path'`),
      encoding: 'utf8',
    })
    assert.notEqual(unsafe.status, 0)
    assert.match(unsafe.stderr, /unsafe checkout ownership at deploy path: expected memoly:memoly/)

    const gitFailure = spawnSync(bashExecutable, ['-s'], {
      input: harness.replace('PRODUCT_SHA=target', 'PRODUCT_SHA=fail'),
      encoding: 'utf8',
    })
    assert.notEqual(gitFailure.status, 0)
    assert.match(gitFailure.stderr, /cannot inspect tracked paths for checkout ownership/)
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
  const bashRoot = gitBashPath(fixture.appRoot)
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
    const clean = spawnSync(bashExecutable, ['-s'], { input: harness, encoding: 'utf8' })
    assert.equal(clean.status, 0, `${clean.stdout}${clean.stderr}`)

    const dirty = spawnSync(bashExecutable, ['-s'], {
      input: harness.replace('validate_repository\nfetch_and_checkout', "printf 'dirty\\n' >> \"$APP_ROOT/deploy path/app.css\"\nvalidate_repository\nfetch_and_checkout"),
      encoding: 'utf8',
    })
    assert.notEqual(dirty.status, 0)
    assert.match(dirty.stderr, /application checkout must be clean before release/)
  } finally {
    rmSync(fixture.temp, { recursive: true, force: true })
  }
})
