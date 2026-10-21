import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import test from 'node:test'
import assert from 'node:assert/strict'
import { linuxPath, runLinuxRoot } from './bash-runtime.mjs'

const root = resolve(import.meta.dirname, '..')
const redeploySource = `. '${linuxPath(resolve(root, 'deploy/selectel/redeploy.sh'))}'`

test('backup failure exits before the dedicated Selectel database job in the migration flow', () => {
  const marker = resolve(mkdtempSync(resolve(tmpdir(), 'memoly-db-migration-event-')), 'called')
  const harness = `
SERVER_ROOT=$(mktemp -d /tmp/memoly-selectel-test.XXXXXX)
${redeploySource}
preflight() { :; }
validate_database_target() { :; }
migration_status() { :; }
die() { printf 'DIE:%s\\n' "$*" >&2; exit 1; }
compose() {
  if [[ "$*" == *pg_dump* ]]; then return 42; fi
  if [[ "$*" == *deploy-selectel-database.ts* ]]; then : > "$DB_DEPLOY_MARKER"; fi
  return 0
}
trap 'rm -rf -- "$SERVER_ROOT"' EXIT
DB_DEPLOY_MARKER='${linuxPath(marker)}'
MEMOLY_PRODUCT_SHA=227e2149e66e3c3ac75ac235eb201f8154d7ceb3
migrate
`
  const result = runLinuxRoot(harness, { timeout: 30_000 })
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /database backup failed; migration was not attempted/, `${result.stdout}${result.stderr}`)
  assert.doesNotMatch(result.stderr, /secret|DATABASE_URL|web_app_demo/)
  assert.equal(existsSync(marker), false, 'migration command was never observed')
  rmSync(resolve(marker, '..'), { recursive: true, force: true })
})

test('empty dump output fails validation before the dedicated Selectel database job', () => {
  const marker = resolve(mkdtempSync(resolve(tmpdir(), 'memoly-db-migration-event-')), 'called')
  const harness = `
SERVER_ROOT=$(mktemp -d /tmp/memoly-selectel-test.XXXXXX)
${redeploySource}
preflight() { :; }
validate_database_target() { :; }
migration_status() { :; }
die() { printf 'DIE:%s\n' "$*" >&2; exit 1; }
compose() {
  if [[ "$*" == *pg_dump* ]]; then return 0; fi
  if [[ "$*" == *deploy-selectel-database.ts* ]]; then : > "$DB_DEPLOY_MARKER"; fi
  return 0
}
trap 'rm -rf -- "$SERVER_ROOT"' EXIT
DB_DEPLOY_MARKER='${linuxPath(marker)}'
MEMOLY_PRODUCT_SHA=91735e8b1c52cdcd42c0051dad945d96aa9f0db2
migrate
`
  const result = runLinuxRoot(harness, { timeout: 30_000 })
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /database backup validation failed; migration was not attempted/, `${result.stdout}${result.stderr}`)
  assert.equal(existsSync(marker), false, 'migration command was never observed')
  rmSync(resolve(marker, '..'), { recursive: true, force: true })
})

test('Selectel migration invokes the dedicated MAX existing-database procedure', () => {
  const invocation = resolve(mkdtempSync(resolve(tmpdir(), 'memoly-db-migration-invocation-')), 'argv')
  const harness = `
SERVER_ROOT=$(mktemp -d /tmp/memoly-selectel-migrate.XXXXXX)
${redeploySource}
trap 'rm -rf -- "$SERVER_ROOT"' EXIT
MM0_BACKUP_PREPARED=false
preflight() { printf 'PREFLIGHT\\n'; }
validate_database_target() { printf 'DATABASE_TARGET_VALIDATED\\n'; }
backup_database() { printf 'BACKUP_CREATED\\n'; }
migration_status() { MIGRATION_STATUS_VERIFIED=true; }
compose() { printf '%s\\n' "$*" > "$MIGRATION_CALL_CAPTURE"; }
MIGRATION_CALL_CAPTURE='${linuxPath(invocation)}'
migrate
printf 'MIGRATION_STATUS_VERIFIED=%s\\n' "$MIGRATION_STATUS_VERIFIED"
`
  const result = runLinuxRoot(harness, { timeout: 30_000 })
  assert.equal(result.status, 0, result.stdout + result.stderr)
  assert.match(result.stdout, /PREFLIGHT[\s\S]*DATABASE_TARGET_VALIDATED[\s\S]*BACKUP_CREATED/)
  assert.equal(readFileSync(invocation, 'utf8').trim(), 'run --rm --no-deps backend bun scripts/deploy-selectel-database.ts')
  rmSync(resolve(invocation, '..'), { recursive: true, force: true })
  assert.match(result.stdout, /MIGRATION_STATUS_VERIFIED=true/)
})

test('Selectel job reports only whitelisted stage diagnostics and keeps raw output private', () => {
  const harness = `
SERVER_ROOT=$(mktemp -d /tmp/memoly-selectel-test.XXXXXX)
${redeploySource}
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
trap 'rm -rf -- "$SERVER_ROOT"' EXIT
JOB_LOG_CAPTURE="$JOB_LOG_CAPTURE_PATH"
JOB_LOG_MODE_CAPTURE="$JOB_LOG_MODE_CAPTURE_PATH"
MEMOLY_PRODUCT_SHA=91735e8b1c52cdcd42c0051dad945d96aa9f0db2
migrate
`
  const logCapturePath = resolve(root, 'tests/.selectel-stage-job.log')
  const modeCapturePath = resolve(root, 'tests/.selectel-stage-job.mode')
  const linuxHarness = harness.replace('$JOB_LOG_CAPTURE_PATH', linuxPath(logCapturePath)).replace('$JOB_LOG_MODE_CAPTURE_PATH', linuxPath(modeCapturePath))
  const result = runLinuxRoot(linuxHarness, { timeout: 30_000 })
  const privateOutput = readFileSync(logCapturePath, 'utf8')
  const mode = readFileSync(modeCapturePath, 'utf8').trim()
  rmSync(logCapturePath, { force: true })
  rmSync(modeCapturePath, { force: true })
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /post-migration runtime grants or postconditions failed; schema may already have advanced/)
  assert.match(result.stderr, /private job log: selectel-db-deploy\.[A-Za-z0-9]{8}\.log/)
  assert.doesNotMatch(`${result.stdout}\n${result.stderr}`, /synthetic-secret|do-not-print|DATABASE_URL/)
  assert.match(privateOutput, /synthetic-secret=do-not-print/)
  assert.equal(mode, '600')
})
