import { readFileSync, rmSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'
import test from 'node:test'
import assert from 'node:assert/strict'

const root = resolve(import.meta.dirname, '..')
const read = (relativePath) => readFileSync(resolve(root, relativePath), 'utf8').replaceAll('\r\n', '\n')

test('backup failure exits before db:deploy in the executable migration flow', () => {
  const script = read('deploy/selectel/redeploy.sh')
  const backupStart = script.indexOf('backup_database() {')
  const backupEnd = script.indexOf('\n}\n\nmigrate()', backupStart) + 2
  const backup = script.slice(backupStart, backupEnd)
  const migrate = script.match(/migrate\(\) \{[\s\S]*?\n\}/)?.[0] ?? ''
  const harness = `
${backup}
${migrate}
preflight() { :; }
validate_database_target() { :; }
migration_status() { :; }
die() { printf 'DIE:%s\\n' "$*" >&2; exit 1; }
compose() {
  if [[ "$*" == *pg_dump* ]]; then return 42; fi
  if [[ "$*" == *db:deploy* ]]; then printf '%s' called > "$DB_DEPLOY_MARKER"; fi
  return 0
}
SERVER_ROOT=/tmp/memoly-selectel-test
mkdir -p "$SERVER_ROOT"
trap 'rm -rf -- "$SERVER_ROOT"' EXIT
DB_DEPLOY_MARKER="$SERVER_ROOT/db-deploy-called"
MEMOLY_PRODUCT_SHA=227e2149e66e3c3ac75ac235eb201f8154d7ceb3
migrate
`
  const harnessPath = resolve(root, 'tests/.selectel-backup-harness.sh')
  const bashHarnessPath = harnessPath.replace(/^([A-Za-z]):[\\/]/, (_, drive) => `/mnt/${drive.toLowerCase()}/`).replaceAll('\\', '/')
  writeFileSync(harnessPath, harness)
  const result = spawnSync('bash', [bashHarnessPath], { encoding: 'utf8', timeout: 30_000 })
  rmSync(harnessPath, { force: true })
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /database backup failed; migration was not attempted/, `${result.stdout}${result.stderr}`)
  assert.doesNotMatch(result.stderr, /secret|DATABASE_URL|web_app_demo/)
  assert.doesNotMatch(result.stdout, /db-deploy-called/)
  assert.match(harness, /DB_DEPLOY_MARKER/)
})

test('empty dump output fails validation before db:deploy', () => {
  const script = read('deploy/selectel/redeploy.sh')
  const backupStart = script.indexOf('backup_database() {')
  const backupEnd = script.indexOf('\n}\n\nmigrate()', backupStart) + 2
  const backup = script.slice(backupStart, backupEnd)
  const migrate = script.match(/migrate\(\) \{[\s\S]*?\n\}/)?.[0] ?? ''
  const harness = `
${backup}
${migrate}
preflight() { :; }
validate_database_target() { :; }
migration_status() { :; }
die() { printf 'DIE:%s\n' "$*" >&2; exit 1; }
compose() {
  if [[ "$*" == *pg_dump* ]]; then return 0; fi
  if [[ "$*" == *db:deploy* ]]; then printf '%s' called > "$DB_DEPLOY_MARKER"; fi
  return 0
}
SERVER_ROOT=/tmp/memoly-selectel-test
mkdir -p "$SERVER_ROOT"
trap 'rm -rf -- "$SERVER_ROOT"' EXIT
DB_DEPLOY_MARKER="$SERVER_ROOT/db-deploy-called"
MEMOLY_PRODUCT_SHA=91735e8b1c52cdcd42c0051dad945d96aa9f0db2
migrate
`
  const harnessPath = resolve(root, 'tests/.selectel-empty-backup-harness.sh')
  const bashHarnessPath = harnessPath.replace(/^([A-Za-z]):[\\/]/, (_, drive) => `/mnt/${drive.toLowerCase()}/`).replaceAll('\\', '/')
  writeFileSync(harnessPath, harness)
  const result = spawnSync('bash', [bashHarnessPath], { encoding: 'utf8', timeout: 30_000 })
  rmSync(harnessPath, { force: true })
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /database backup validation failed; migration was not attempted/, `${result.stdout}${result.stderr}`)
  assert.doesNotMatch(result.stdout, /db-deploy-called/)
})
