import { readFileSync, rmSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'
import test from 'node:test'
import assert from 'node:assert/strict'

const root = resolve(import.meta.dirname, '..')
const read = (relativePath) => readFileSync(resolve(root, relativePath), 'utf8').replaceAll('\r\n', '\n')

test('backup failure exits before the dedicated Selectel database job in the migration flow', () => {
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
  if [[ "$*" == *deploy-selectel-database.ts* ]]; then printf '%s' called > "$DB_DEPLOY_MARKER"; fi
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

test('empty dump output fails validation before the dedicated Selectel database job', () => {
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
  if [[ "$*" == *deploy-selectel-database.ts* ]]; then printf '%s' called > "$DB_DEPLOY_MARKER"; fi
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

test('Selectel migration invokes the dedicated MAX existing-database procedure', () => {
  const script = read('deploy/selectel/redeploy.sh')
  const migrate = script.match(/migrate\(\) \{[\s\S]*?\n\}/)?.[0] ?? ''
  assert.match(migrate, /compose run --rm --no-deps backend bun scripts\/deploy-selectel-database\.ts/)
  assert.match(migrate, /schema may already have advanced; inspect migration status before retrying/)
  assert.match(migrate, /backup_database/)
  assert.match(migrate, /validate_database_target/)
})

test('Selectel job reports only whitelisted stage diagnostics and keeps raw output private', () => {
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
die() {
  cp -- "$job_log" "$JOB_LOG_CAPTURE"
  stat -c '%a' "$job_log" > "$JOB_LOG_MODE_CAPTURE"
  printf 'DIE:%s\\n' "$*" >&2
  exit 1
}
compose() {
  case "$*" in
    *pg_dump*) printf 'PGDMP'; return 0 ;;
    *pg_restore*) printf 'TOC\\n'; return 0 ;;
    *deploy-selectel-database.ts*) printf 'Database migration was applied, but runtime grants or postconditions failed; inspect the database before retrying.\\nsynthetic-secret=do-not-print'; return 42 ;;
  esac
  return 0
}
SERVER_ROOT=/tmp/memoly-selectel-test
mkdir -p "$SERVER_ROOT"
trap 'rm -rf -- "$SERVER_ROOT"' EXIT
JOB_LOG_CAPTURE="$JOB_LOG_CAPTURE_PATH"
JOB_LOG_MODE_CAPTURE="$JOB_LOG_MODE_CAPTURE_PATH"
MEMOLY_PRODUCT_SHA=91735e8b1c52cdcd42c0051dad945d96aa9f0db2
migrate
`
  const harnessPath = resolve(root, 'tests/.selectel-stage-harness.sh')
  const logCapturePath = resolve(root, 'tests/.selectel-stage-job.log')
  const modeCapturePath = resolve(root, 'tests/.selectel-stage-job.mode')
  const bashHarnessPath = harnessPath.replace(/^([A-Za-z]):[\\/]/, (_, drive) => `/mnt/${drive.toLowerCase()}/`).replaceAll('\\', '/')
  const bashLogPath = logCapturePath.replace(/^([A-Za-z]):[\\/]/, (_, drive) => `/mnt/${drive.toLowerCase()}/`).replaceAll('\\', '/')
  const bashModePath = modeCapturePath.replace(/^([A-Za-z]):[\\/]/, (_, drive) => `/mnt/${drive.toLowerCase()}/`).replaceAll('\\', '/')
  writeFileSync(harnessPath, harness.replace('$JOB_LOG_CAPTURE_PATH', bashLogPath).replace('$JOB_LOG_MODE_CAPTURE_PATH', bashModePath))
  const result = spawnSync('bash', [bashHarnessPath], { encoding: 'utf8', timeout: 30_000 })
  const privateOutput = readFileSync(logCapturePath, 'utf8')
  const mode = readFileSync(modeCapturePath, 'utf8').trim()
  rmSync(harnessPath, { force: true })
  rmSync(logCapturePath, { force: true })
  rmSync(modeCapturePath, { force: true })
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /post-migration runtime grants or postconditions failed; schema may already have advanced/)
  assert.match(result.stderr, /private job log: selectel-db-deploy\.[A-Za-z0-9]{8}\.log/)
  assert.doesNotMatch(`${result.stdout}\n${result.stderr}`, /synthetic-secret|do-not-print|DATABASE_URL/)
  assert.match(privateOutput, /synthetic-secret=do-not-print/)
  assert.equal(mode, '600')
})
