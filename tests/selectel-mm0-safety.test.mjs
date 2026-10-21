import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import test from 'node:test'
import { linuxPath, runLinuxRoot } from './bash-runtime.mjs'

const root = resolve(import.meta.dirname, '..')
const run = (script) => runLinuxRoot(`set -euo pipefail\n. '${linuxPath(resolve(root, 'deploy/selectel/ci-release.sh'))}'\n. '${linuxPath(resolve(root, 'deploy/selectel/redeploy.sh'))}'\n${script}`, { timeout: 30_000 })

function failAt(stage, armed, quiesceFails = false) {
  const directory = mkdtempSync(resolve(root, 'tests/.selectel-mm0-inject-'))
  const marker = resolve(directory, 'forward-only')
  const faultEvent = resolve(directory, 'fault-event')
  const serverRoot = resolve(directory, 'server')
  mkdirSync(serverRoot)
  const bashMarker = linuxPath(marker)
  const injected = {
    preflight: 'preflight() { mark_fault preflight; return 42; }; preflight',
    backup: 'preflight() { :; }; validate_database_target() { :; }; backup_database() { mark_fault backup; return 42; }; backup_migration',
    migration: 'preflight() { :; }; validate_database_target() { :; }; validate_forward_marker() { :; }; verify_no_legacy_writers() { :; }; compose() { mark_fault migration; return 42; }; MM0_BACKUP_PREPARED=true; FORWARD_MARKER="$MM0_FORWARD_MARKER"; migrate',
    startup: 'compose() { mark_fault startup; return 42; }; sleep() { :; }; wait_backend_internal 1',
    readiness: 'compose() { printf "backend\\nworker\\nscheduler\\nstatic\\n"; }; wait_public() { mark_fault readiness; return 42; }; readiness',
    revision: `PRODUCT_SHA=${'a'.repeat(40)}; service_image() { printf 'memoly-backend:%s\\n' "$PRODUCT_SHA"; }; docker() { mark_fault revision; printf '%s\\n' '${'b'.repeat(40)}'; }; verify_promoted_revision`,
  }[stage]
  assert.ok(injected)
  try {
    const result = run(`
MM0_FORWARD_MARKER='${bashMarker}'
FAULT_EVENT='${linuxPath(faultEvent)}'
mark_fault() { printf '%s\\n' "$1" > "$FAULT_EVENT"; }
SERVER_ROOT='${linuxPath(serverRoot)}'
FORWARD_MARKER=/tmp/selectel-b2-test-$$
if [ ${armed} = true ]; then : > "$MM0_FORWARD_MARKER"; fi
LEGACY_MEMBERSHIP_RUNTIME=false
LEGACY_MM0_RUNTIME=${armed}
QUIESCE_STARTED=${armed}
PROMOTION_STARTED=${stage === 'preflight' || stage === 'backup' ? 'false' : 'true'}
APP_ROOT=/mock/app
bash() { printf 'ACTION:%s\\n' "$*"; if [ "$2" = quiesce-legacy ] && [ ${quiesceFails} = true ]; then return 42; fi; }
die() { printf 'DIE:%s\\n' "$*" >&2; exit 17; }
trap release_failure EXIT
${injected}
`)
    const faultStage = existsSync(faultEvent) ? readFileSync(faultEvent, 'utf8').trim() : null
    assert.equal(faultStage, stage, `the injected ${stage} boundary was reached`)
    return { result, markerPersists: existsSync(marker), faultStage }
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
}

test('unreadable MM0 marker recovery falls back to stopping all application writers', () => {
  const { result, markerPersists } = failAt('migration', true, true)
  assert.notEqual(result.status, 0)
  assert.equal(markerPersists, true)
  assert.match(result.stdout, /ACTION:.*quiesce-legacy[\s\S]*ACTION:.*quiesce-all/)
  assert.doesNotMatch(result.stdout, /ACTION:.*rollback/)
})





for (const stage of ['preflight', 'backup']) {
  test(`${stage} failure before MM0 attempt leaves the old runtime running`, () => {
    const { result, markerPersists } = failAt(stage, false)
    assert.notEqual(result.status, 0)
    assert.equal(markerPersists, false)
    assert.doesNotMatch(result.stdout, /ACTION:/)
    assert.doesNotMatch(result.stderr, /FORWARD_FIX_REQUIRED/)
  })
}

for (const stage of ['migration', 'startup', 'readiness', 'revision']) {
  test(`armed MM0 marker makes ${stage} failure quiesce instead of rollback`, () => {
    const { result, markerPersists, faultStage } = failAt(stage, true)
    assert.notEqual(result.status, 0, `${result.stdout}${result.stderr}`)
    assert.equal(faultStage, stage, 'the injected failing boundary was reached')
    assert.equal(markerPersists, true, 'forward-only marker survives the failure')
    assert.match(result.stdout, /ACTION:.*quiesce-legacy/)
    assert.doesNotMatch(result.stdout, /ACTION:.*rollback/)
    assert.match(result.stderr, /FORWARD_FIX_REQUIRED/)
  })
}

test('missing forward marker prevents writer quiescence with no Docker mutation', () => {
  const result = run(`
FORWARD_MARKER=/missing-mm0-test-marker
MM0_FORWARD_MARKER=$FORWARD_MARKER
MEMOLY_PRODUCT_SHA=${'a'.repeat(40)}
COMPOSE_PROJECT=memoly
APP_ROOT=/mock/app
B2_RUNTIME_SHA=${'b'.repeat(40)}
MM0_RUNTIME_SHA=${'c'.repeat(40)}
die() { printf 'DIE:%s\\n' "$*" >&2; exit 17; }
docker() { printf 'DOCKER_CALLED\\n'; exit 99; }
quiesce_legacy_runtime
`)
  assert.equal(result.status, 17, `${result.stdout}${result.stderr}`)
  assert.match(result.stderr, /marker is missing or invalid/)
  assert.doesNotMatch(result.stdout, /DOCKER_CALLED/)
})

test('bounded backend readiness retry succeeds after one injected failure', () => {
  const result = run(`
ATTEMPTS=0
compose() { ATTEMPTS=$((ATTEMPTS + 1)); [ "$ATTEMPTS" -ne 1 ]; }
sleep() { :; }
die() { printf 'DIE:%s\\n' "$*" >&2; exit 17; }
wait_backend_internal 3
printf 'ATTEMPTS:%s\\n' "$ATTEMPTS"
`)
  assert.equal(result.status, 0, `${result.stdout}${result.stderr}`)
  assert.match(result.stdout, /ATTEMPTS:3/)
})

test('successful release cleanup removes MM0 marker without rollback', () => {
  const result = run(`
MM0_FORWARD_MARKER=/tmp/selectel-mm0-success-$$
FORWARD_MARKER=/tmp/selectel-b2-success-$$
MM0_ACTIVE_MARKER=$MM0_FORWARD_MARKER
LEGACY_MM0_RUNTIME=true
LEGACY_MEMBERSHIP_RUNTIME=false
: > "$MM0_FORWARD_MARKER"
clear_release_markers
[ ! -e "$MM0_FORWARD_MARKER" ]
printf 'CLEARED\\n'
`)
  assert.equal(result.status, 0, `${result.stdout}${result.stderr}`)
  assert.match(result.stdout, /CLEARED/)
})


test('post-promotion revision mismatch fails before marker cleanup', () => {
  const target = 'a'.repeat(40)
  const result = run(`
PRODUCT_SHA=${target}
service_image() { case "$1" in static) printf 'memoly-webapp:%s\\n' "$PRODUCT_SHA" ;; *) printf 'memoly-backend:%s\\n' "$PRODUCT_SHA" ;; esac; }
docker() { printf '%s\\n' '${'b'.repeat(40)}'; }
die() { printf 'DIE:%s\\n' "$*" >&2; exit 19; }
verify_promoted_revision
`)
  assert.equal(result.status, 19, `${result.stdout}${result.stderr}`)
  assert.match(result.stderr, /revision label does not match/)
})



test('crash with both B2 and MM0 markers recovers through MM0 and removes superseded B2 marker', () => {
  const mmTarget = 'a'.repeat(40)
  const b2Target = 'b'.repeat(40)
  const previous = 'c'.repeat(40)
  const result = run(`
SERVER_ROOT=$(mktemp -d)
MM0_FORWARD_MARKER=$SERVER_ROOT/mm0
FORWARD_MARKER=$SERVER_ROOT/b2
trap 'rm -rf "$SERVER_ROOT"' EXIT
printf 'MM0_FORWARD_ONLY_TARGET=%s\\nPREVIOUS_BACKEND_IMAGE_TAG=%s\\nPREVIOUS_WEBAPP_IMAGE_TAG=%s\\n' '${mmTarget}' '${previous}' '${previous}' > "$MM0_FORWARD_MARKER"
printf 'B2_FORWARD_ONLY_TARGET=%s\\nPREVIOUS_BACKEND_IMAGE_TAG=%s\\nPREVIOUS_WEBAPP_IMAGE_TAG=%s\\n' '${b2Target}' '${previous}' '${previous}' > "$FORWARD_MARKER"
MM0_RUNTIME_SHA=${'d'.repeat(40)}
MM0_ACTIVE_MARKER=$MM0_FORWARD_MARKER
RESUMING_FORWARD_ONLY=false
RESUMING_MM0=false
LEGACY_MM0_RUNTIME=false
LEGACY_MEMBERSHIP_RUNTIME=false
APP_ROOT=/mock/app
die() { printf 'DIE:%s\\n' "$*" >&2; exit 19; }
stat() { case "$*" in *%u*) printf '0\\n' ;; *%a*) printf '600\\n' ;; esac; }
git_root() { [ "$1" = merge-base ] && [ "$4" = '${mmTarget}' ]; }
bash() { printf 'ACTION:%s\\n' "$*"; }
recover_forward_markers
[ -f "$MM0_FORWARD_MARKER" ] && [ ! -e "$FORWARD_MARKER" ]
[ "$MARKER_TARGET_SHA" = '${mmTarget}' ]
[ "$RESUMING_MM0" = true ]
printf 'MM0_RECOVERY_READY\\n'
`)
  assert.equal(result.status, 0, `${result.stdout}${result.stderr}`)
  assert.match(result.stdout, /MM0_RECOVERY_READY/)
  assert.match(result.stdout, /ACTION:.*quiesce-legacy/)
})

test('MM0 marker rejects a retry targeting a pre-MM0 release', () => {
  const result = run(`
MM0_RUNTIME_SHA=${'a'.repeat(40)}
MARKER_TARGET_SHA=${'b'.repeat(40)}
PRODUCT_SHA=${'c'.repeat(40)}
RESUMING_MM0=true
die() { printf 'DIE:%s\\n' "$*" >&2; exit 19; }
git_root() { if [ "$1" = cat-file ]; then return 0; fi; return 1; }
detect_mm0_boundary
`)
  assert.equal(result.status, 19, `${result.stdout}${result.stderr}`)
  assert.match(result.stderr, /MM0 forward-only recovery target must descend/)
})

test('guarded MM0 promotion accepts its active marker and reaches readiness', () => {
  const target = 'a'.repeat(40)
  const previous = 'b'.repeat(40)
  const result = run(`
MEMOLY_PRODUCT_SHA=${target}
PREVIOUS_BACKEND=${previous}
B2_RUNTIME_SHA=${'c'.repeat(40)}
MM0_RUNTIME_SHA=${'d'.repeat(40)}
APP_ROOT=/mock/app
COMPOSE_PROJECT=memoly
SELECTEL_CI_RELEASE=true
SELECTEL_DEPLOY_LOCK_FD=9
FORWARD_MARKER=$(mktemp)
MM0_FORWARD_MARKER=$FORWARD_MARKER
trap 'rm -f "$FORWARD_MARKER"' EXIT
printf 'MM0_FORWARD_ONLY_TARGET=%s\\nPREVIOUS_BACKEND_IMAGE_TAG=%s\\nPREVIOUS_WEBAPP_IMAGE_TAG=%s\\n' "$MEMOLY_PRODUCT_SHA" "$PREVIOUS_BACKEND" "$PREVIOUS_BACKEND" > "$FORWARD_MARKER"
stat() { case "$*" in *%u*) printf '0\\n' ;; *%a*) printf '600\\n' ;; esac; }
git() { case "$5" in rev-parse) printf '%s\\n' "$MEMOLY_PRODUCT_SHA" ;; cat-file) return 0 ;; merge-base) [ "${'${@: -1}'}" != "$PREVIOUS_BACKEND" ] ;; esac; }
docker() { [ "$1" = ps ] && return 0; return 99; }
die() { printf 'DIE:%s\\n' "$*" >&2; exit 19; }
read_static_rollback_tag() { PREVIOUS_WEBAPP_IMAGE_TAG='4b4edc0992803b84c919aadb835e8d2e21095c51'; }
require_accepted_ui_target() { [ "$1" = '4b4edc0992803b84c919aadb835e8d2e21095c51' ] || die 'fixture rollback UI is not accepted'; }
verify_mm0_spike_stopped() { :; }
for step in preflight backup_server_state prepare_configuration migration_status promote_backend wait_backend_internal promote_jobs promote_static verify_static_internal activate_gateway readiness; do
  eval "$step() { printf 'STEP:$step\\n'; }"
done
deploy
`)
  assert.equal(result.status, 0, `${result.stdout}${result.stderr}`)
  assert.match(result.stdout, /STEP:preflight[\s\S]*STEP:promote_backend[\s\S]*STEP:promote_jobs[\s\S]*STEP:readiness/)
})

test('direct quiesce-all is rejected before touching Docker', () => {
  const result = run(`
SELECTEL_CI_RELEASE=false
SELECTEL_DEPLOY_LOCK_FD=
COMPOSE_PROJECT=memoly
die() { printf 'DIE:%s\\n' "$*" >&2; exit 19; }
docker() { printf 'DOCKER_CALLED\\n'; exit 99; }
quiesce_all_writers
`)
  assert.equal(result.status, 19, `${result.stdout}${result.stderr}`)
  assert.match(result.stderr, /guarded ci-release entry point and inherited release lock/)
  assert.doesNotMatch(result.stdout, /DOCKER_CALLED/)
})

function spikeScenario({ present = true, target = 'postgres|5432|prod_db', stopFails = false, emergency = false }) {
  return run(`
MM0_SPIKE_CONTAINER=memoly-spike-max-video-backend-1
COMPOSE_PROJECT=memoly
SPIKE_RUNNING=${present}
SPIKE_TARGET='${target}'
STOP_FAIL=${stopFails}
ACTIONS=
die() { printf 'DIE:%s\\n' "$*" >&2; exit 19; }
compose() { printf 'postgres|5432|prod_db'; }
docker() {
  case "$1" in
    ps) if [[ "$*" == *service=postgres* ]]; then printf 'postgres-id\\n'; elif [ "$SPIKE_RUNNING" = true ]; then printf 'spike-id\\n'; fi; return 0 ;;
    exec) if [ "$2" = postgres-id ]; then printf 'prod_db'; else [ "$SPIKE_TARGET" = unknown ] && return 42; printf '%s' "$SPIKE_TARGET"; fi ;;
    update) ACTIONS="$ACTIONS update" ;;
    stop) ACTIONS="$ACTIONS stop"; [ "$STOP_FAIL" = true ] && return 42; SPIKE_RUNNING=false ;;
    *) return 99 ;;
  esac
}
quiesce_mm0_spike${emergency ? ' emergency' : ''}
printf 'ACTIONS:%s\\n' "$ACTIONS"
`)
}

test('same-database MAX video spike is stopped and restart disabled before MM0', () => {
  const result = spikeScenario({})
  assert.equal(result.status, 0, `${result.stdout}${result.stderr}`)
  assert.match(result.stdout, /ACTIONS: update stop/)
  assert.doesNotMatch(result.stdout + result.stderr, /password|secret/i)
})

test('spike database parser reveals only normalized target, never credentials', () => {
  const fixture = mkdtempSync(resolve(root, 'tests/.mm0-spike-payload-'))
  const payloadPath = resolve(fixture, 'payload.mjs')
  try {
    const bunCommand = process.platform === 'win32' ? 'bun.exe' : 'bun'
    const result = run(`
COMPOSE_PROJECT=memoly
MM0_SPIKE_CONTAINER=memoly-spike-max-video-backend-1
CAPTURE_PAYLOAD='${linuxPath(payloadPath)}'
docker() {
  case "$1" in
    ps) case "$*" in *service=postgres*) printf 'postgres-id\\n' ;; *name=*) printf 'spike-id\\n' ;; *) return 90 ;; esac ;;
    exec)
      if [ "$2" = postgres-id ]; then printf 'prod_db'; return 0; fi
      [ "$2" = spike-id ] && [ "$3" = bun ] && [ "$4" = -e ] || return 91
      printf '%s' "$5" > "$CAPTURE_PAYLOAD"
      printf 'postgres|5432|prod_db'
      ;;
    *) return 92 ;;
  esac
}
result=$(mm0_spike_relation spike-id) || exit 93
printf 'RELATION:%s\\n' "$result"
`)
    assert.equal(result.status, 0, `${result.stdout}${result.stderr}`)
    assert.match(result.stdout, /RELATION:same/)
    assert.doesNotMatch(result.stdout + result.stderr, /synthetic_user|synthetic_secret/)
    const payload = readFileSync(payloadPath, 'utf8')
    assert.doesNotMatch(payload, /synthetic_user|synthetic_secret/)
    const parsed = spawnSync(bunCommand, ['-e', payload], {
      encoding: 'utf8', timeout: 30_000,
      env: { ...process.env, DATABASE_URL: 'postgresql://synthetic_user:synthetic_secret@postgres:5432/prod_db?schema=public' },
    })
    assert.equal(parsed.status, 0, `${parsed.stdout}${parsed.stderr}`)
    assert.equal(parsed.stdout, 'postgres|5432|prod_db')
    assert.doesNotMatch(parsed.stdout + parsed.stderr, /synthetic_user|synthetic_secret/)
  } finally {
    rmSync(fixture, { recursive: true, force: true })
  }
})

test('absent MAX video spike causes no mutation', () => {
  const result = spikeScenario({ present: false })
  assert.equal(result.status, 0, `${result.stdout}${result.stderr}`)
  assert.match(result.stdout, /ACTIONS:\s*$/m)
})

test('known different database leaves the MAX video spike running', () => {
  const result = spikeScenario({ target: 'postgres|5432|other_db' })
  assert.equal(result.status, 0, `${result.stdout}${result.stderr}`)
  assert.match(result.stdout, /ACTIONS:\s*$/m)
})

for (const target of ['other-host|5432|prod_db', 'unknown']) {
  test(`ambiguous spike target ${target} blocks MM0 without stopping an unclassified writer`, () => {
    const result = spikeScenario({ target })
    assert.equal(result.status, 19, `${result.stdout}${result.stderr}`)
    assert.doesNotMatch(result.stdout, /ACTIONS:.*stop/)
    assert.match(result.stderr, /cannot classify MAX video spike database target/)
  })
}

test('MAX video spike stop failure blocks MM0 migration', () => {
  const result = spikeScenario({ stopFails: true })
  assert.equal(result.status, 19, `${result.stdout}${result.stderr}`)
  assert.match(result.stderr, /cannot stop MAX video spike writer/)
})

test('armed-marker emergency fallback stops a spike with unknown database target', () => {
  const result = spikeScenario({ target: 'unknown', emergency: true })
  assert.equal(result.status, 0, `${result.stdout}${result.stderr}`)
  assert.match(result.stdout, /ACTIONS: update stop/)
})

function runReleaseBackupBoundary(spikeTarget) {
  const fixture = mkdtempSync(resolve(root, 'tests/.mm0-release-backup-'))
  const marker = resolve(fixture, 'mm0.marker')
  const events = resolve(fixture, 'events')
  const payload = resolve(fixture, 'payload.mjs')
  try {
    const result = run(`
APP_ROOT='${linuxPath(root)}'
SERVER_ROOT='${linuxPath(fixture)}'
MM0_FORWARD_MARKER='${linuxPath(marker)}'
MM0_ACTIVE_MARKER=$MM0_FORWARD_MARKER
LEGACY_MM0_RUNTIME=true
LEGACY_MEMBERSHIP_RUNTIME=false
QUIESCE_STARTED=false
PROMOTION_STARTED=false
trap release_failure EXIT
CAPTURE_PAYLOAD='${linuxPath(payload)}'
EVENT_LOG='${linuxPath(events)}'
SPIKE_TARGET='${spikeTarget}'
MM0_BOUNDARY=true
die() { printf 'DIE:%s\\n' "$*" >&2; exit 19; }
preflight() { :; }
validate_database_target() { :; }
backup_database() { printf 'backup\\n' >> "$EVENT_LOG"; }
docker() {
  case "$1" in
    ps) case "$*" in *service=postgres*) printf 'postgres-id\\n' ;; *name=*) printf 'spike-id\\n' ;; *) return 90 ;; esac ;;
    exec)
      if [ "$2" = postgres-id ]; then printf 'prod_db'; return 0; fi
      [ "$2" = spike-id ] && [ "$3" = bun ] && [ "$4" = -e ] || return 91
      printf '%s' "$5" > "$CAPTURE_PAYLOAD"
      printf 'spike-probe\\n' >> "$EVENT_LOG"
      printf '%s' "$SPIKE_TARGET"
      ;;
    update|stop) printf 'writer-stop\\n' >> "$EVENT_LOG"; return 0 ;;
    *) return 92 ;;
  esac
}
bash() {
  [ "$1" = "$APP_ROOT/deploy/selectel/redeploy.sh" ] && [ "$2" = backup-migration ] || return 93
  [ "$FORWARD_MARKER" = "$MM0_ACTIVE_MARKER" ] && [ "$MM0_BOUNDARY" = true ] || return 94
  backup_migration
}
backup_mm0_database
`)
    return { fixture, marker, events, payload, result }
  } catch (error) {
    rmSync(fixture, { recursive: true, force: true })
    throw error
  }
}

test('release backup handoff rejects ambiguous spike targets before backup or writer mutation', () => {
  const runResult = runReleaseBackupBoundary('other-host|5432|prod_db')
  try {
    assert.equal(runResult.result.status, 19, `${runResult.result.stdout}${runResult.result.stderr}`)
    assert.match(runResult.result.stderr, /MAX video spike database relation is ambiguous/)
    assert.match(readFileSync(runResult.events, 'utf8'), /spike-probe/)
    assert.doesNotMatch(readFileSync(runResult.events, 'utf8'), /backup|writer-stop/)
    assert.equal(existsSync(runResult.marker), false, 'failure happens before MM0 marker creation')
  } finally {
    rmSync(runResult.fixture, { recursive: true, force: true })
  }
})

test('release backup handoff reaches backup after the real spike check confirms a different database', () => {
  const runResult = runReleaseBackupBoundary('postgres|5432|other_db')
  try {
    assert.equal(runResult.result.status, 0, `${runResult.result.stdout}${runResult.result.stderr}`)
    const events = readFileSync(runResult.events, 'utf8')
    assert.match(events, /spike-probe[\s\S]*backup/)
    assert.doesNotMatch(events, /writer-stop/)
    assert.equal(existsSync(runResult.marker), false, 'backup is completed before MM0 marker creation')
  } finally {
    rmSync(runResult.fixture, { recursive: true, force: true })
  }
})
