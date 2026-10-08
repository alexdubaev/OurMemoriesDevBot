import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import test from 'node:test'

const root = resolve(import.meta.dirname, '..')
const read = (path) => readFileSync(resolve(root, path), 'utf8').replaceAll('\r\n', '\n')
const release = read('deploy/selectel/ci-release.sh')
const redeploy = read('deploy/selectel/redeploy.sh')
const functionBody = (source, name) => {
  const body = source.match(new RegExp(`^${name}\\(\\) \\{[\\s\\S]*?^\\}`, 'm'))?.[0]
  assert.ok(body, `${name} exists`)
  return body
}
const run = (script) => spawnSync('bash', ['-s'], { input: `set -euo pipefail\n${script}`, encoding: 'utf8', timeout: 30_000 })
const failureHandler = release.slice(release.indexOf('  release_failure() {'), release.indexOf('\n  trap release_failure EXIT'))

function failAt(stage, armed, quiesceFails = false) {
  const directory = mkdtempSync(resolve(root, 'tests/.selectel-mm0-inject-'))
  const marker = resolve(directory, 'forward-only')
  const bashMarker = marker.replace(/^([A-Za-z]):[\\/]/, (_, drive) => `/mnt/${drive.toLowerCase()}/`).replaceAll('\\', '/')
  const injected = {
    preflight: 'preflight() { return 42; }; preflight',
    backup: `${functionBody(redeploy, 'backup_migration')}\npreflight() { :; }; validate_database_target() { :; }; backup_database() { return 42; }; backup_migration`,
    migration: `${functionBody(redeploy, 'migrate')}\npreflight() { :; }; validate_database_target() { :; }; validate_forward_marker() { :; }; verify_no_legacy_writers() { :; }; compose() { return 42; }; MM0_BACKUP_PREPARED=true; FORWARD_MARKER="$MM0_FORWARD_MARKER"; migrate`,
    startup: `${functionBody(redeploy, 'wait_backend_internal')}\ncompose() { return 42; }; sleep() { :; }; wait_backend_internal 1`,
    readiness: `${functionBody(redeploy, 'readiness')}\ncompose() { printf 'backend\\nworker\\nscheduler\\nstatic\\n'; }; wait_public() { return 42; }; readiness`,
    revision: `${functionBody(release, 'verify_promoted_revision')}\nPRODUCT_SHA=${'a'.repeat(40)}; service_image() { printf 'memoly-backend:%s\\n' "$PRODUCT_SHA"; }; docker() { printf '%s\\n' '${'b'.repeat(40)}'; }; verify_promoted_revision`,
  }[stage]
  assert.ok(injected)
  try {
    const result = run(`
MM0_FORWARD_MARKER='${bashMarker}'
FORWARD_MARKER=/tmp/selectel-b2-test-$$
if [ ${armed} = true ]; then : > "$MM0_FORWARD_MARKER"; fi
LEGACY_MEMBERSHIP_RUNTIME=false
LEGACY_MM0_RUNTIME=${armed}
QUIESCE_STARTED=${armed}
PROMOTION_STARTED=${stage === 'preflight' || stage === 'backup' ? 'false' : 'true'}
APP_ROOT=/mock/app
bash() { printf 'ACTION:%s\\n' "$*"; if [ "$2" = quiesce-legacy ] && [ ${quiesceFails} = true ]; then return 42; fi; }
die() { printf 'DIE:%s\\n' "$*" >&2; exit 17; }
${failureHandler}
trap release_failure EXIT
${injected}
`)
    return { result, markerPersists: existsSync(marker) }
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
    const { result, markerPersists } = failAt(stage, true)
    assert.notEqual(result.status, 0, `${result.stdout}${result.stderr}`)
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
${functionBody(redeploy, 'validate_forward_marker')}
${functionBody(redeploy, 'quiesce_legacy_runtime')}
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
${functionBody(redeploy, 'wait_backend_internal')}
wait_backend_internal 3
printf 'ATTEMPTS:%s\\n' "$ATTEMPTS"
`)
  assert.equal(result.status, 0, `${result.stdout}${result.stderr}`)
  assert.match(result.stdout, /ATTEMPTS:3/)
})

test('successful release cleanup removes MM0 marker without rollback', () => {
  const cleanup = release.slice(release.indexOf('  PROMOTION_STARTED=false\n  if [ "$LEGACY_MM0_RUNTIME" = true ]'), release.indexOf('\n}\n\nmain "$@"'))
  assert.ok(cleanup.startsWith('  PROMOTION_STARTED=false'))
  const result = run(`
MM0_FORWARD_MARKER=/tmp/selectel-mm0-success-$$
FORWARD_MARKER=/tmp/selectel-b2-success-$$
MM0_ACTIVE_MARKER=$MM0_FORWARD_MARKER
LEGACY_MM0_RUNTIME=true
LEGACY_MEMBERSHIP_RUNTIME=false
: > "$MM0_FORWARD_MARKER"
${cleanup}
[ ! -e "$MM0_FORWARD_MARKER" ]
printf 'CLEARED\\n'
`)
  assert.equal(result.status, 0, `${result.stdout}${result.stderr}`)
  assert.match(result.stdout, /CLEARED/)
})


test('post-promotion revision mismatch fails before marker cleanup', () => {
  const check = functionBody(release, 'verify_promoted_revision')
  const target = 'a'.repeat(40)
  const result = run(`
PRODUCT_SHA=${target}
service_image() { case "$1" in static) printf 'memoly-webapp:%s\\n' "$PRODUCT_SHA" ;; *) printf 'memoly-backend:%s\\n' "$PRODUCT_SHA" ;; esac; }
docker() { printf '%s\\n' '${'b'.repeat(40)}'; }
die() { printf 'DIE:%s\\n' "$*" >&2; exit 19; }
${check}
verify_promoted_revision
`)
  assert.equal(result.status, 19, `${result.stdout}${result.stderr}`)
  assert.match(result.stderr, /revision label does not match/)
})



test('crash with both B2 and MM0 markers recovers through MM0 and removes superseded B2 marker', () => {
  const mmTarget = 'a'.repeat(40)
  const b2Target = 'b'.repeat(40)
  const previous = 'c'.repeat(40)
  const markerStart = release.indexOf('  if [ -e "$MM0_FORWARD_MARKER" ] || [ -L "$MM0_FORWARD_MARKER" ]; then', release.indexOf('  trap release_failure EXIT'))
  const markerEnd = release.indexOf('  check_disk_space', markerStart)
  assert.ok(markerStart > 0 && markerEnd > markerStart)
  const recovery = release.slice(markerStart, markerEnd)
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
${functionBody(release, 'load_mm0_marker')}
${functionBody(release, 'load_forward_marker')}
recover() {
${recovery}
}
recover
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
${functionBody(release, 'detect_mm0_boundary')}
detect_mm0_boundary
`)
  assert.equal(result.status, 19, `${result.stdout}${result.stderr}`)
  assert.match(result.stderr, /MM0 forward-only recovery target must descend/)
})

test('guarded MM0 promotion accepts its active marker and reaches readiness', () => {
  const target = 'a'.repeat(40)
  const previous = 'b'.repeat(40)
  const releaseFlow = release.slice(release.indexOf('  PROMOTION_STARTED=true'), release.indexOf('  verify_promoted_revision'))
  assert.match(releaseFlow, /FORWARD_MARKER="\$MM0_ACTIVE_MARKER" MM0_BOUNDARY=true bash .*redeploy\.sh" deploy/)
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
verify_mm0_spike_stopped() { :; }
${functionBody(redeploy, 'validate_forward_marker')}
${functionBody(redeploy, 'verify_no_legacy_writers')}
${functionBody(redeploy, 'guard_membership_transition')}
for step in preflight prepare_configuration migration_status promote_backend wait_backend_internal promote_jobs promote_static verify_static_internal activate_gateway readiness; do
  eval "$step() { printf 'STEP:$step\\n'; }"
done
${functionBody(redeploy, 'deploy')}
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
${functionBody(redeploy, 'quiesce_all_writers')}
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
${functionBody(redeploy, 'mm0_spike_id')}
${functionBody(redeploy, 'mm0_spike_relation')}
${functionBody(redeploy, 'quiesce_mm0_spike')}
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
  const script = redeploy.match(/database_script='([^']+)'/)?.[1]
  assert.ok(script)
  const result = spawnSync(process.platform === 'win32' ? 'bun.exe' : 'bun', ['-e', script], {
    encoding: 'utf8', timeout: 30_000,
    env: { ...process.env, DATABASE_URL: 'postgresql://synthetic_user:synthetic_secret@postgres:5432/prod_db?schema=public' },
  })
  assert.equal(result.status, 0, `${result.stdout}${result.stderr}`)
  assert.equal(result.stdout, 'postgres|5432|prod_db')
  assert.doesNotMatch(result.stdout + result.stderr, /synthetic_user|synthetic_secret/)
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

test('ambiguous spike relation aborts backup-migration before marker or writer stop', () => {
  assert.match(release, /MM0_BOUNDARY=true bash .*redeploy\.sh" backup-migration/)
  const result = run(`
MM0_BOUNDARY=true
die() { printf 'DIE:%s\\n' "$*" >&2; exit 19; }
preflight() { :; }
validate_database_target() { :; }
mm0_spike_id() { printf 'spike-id\\n'; }
mm0_spike_relation() { return 42; }
backup_database() { printf 'BACKUP_CALLED\\n'; }
${functionBody(redeploy, 'precheck_mm0_spike_relation')}
${functionBody(redeploy, 'backup_migration')}
backup_migration
`)
  assert.equal(result.status, 19, `${result.stdout}${result.stderr}`)
  assert.doesNotMatch(result.stdout, /BACKUP_CALLED/)
  assert.match(result.stderr, /cannot classify MAX video spike database target before MM0 migration/)
})
