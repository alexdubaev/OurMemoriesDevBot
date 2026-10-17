import assert from 'node:assert/strict'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import test from 'node:test'

const root = resolve(import.meta.dirname, '..')
const release = readFileSync(resolve(root, 'deploy/selectel/ci-release.sh'), 'utf8').replaceAll('\r\n', '\n')
const bashPath = (path) => {
  if (process.platform !== 'win32') return path
  const match = path.match(/^([A-Za-z]):[\\/](.*)$/)
  return match ? `/mnt/${match[1].toLowerCase()}/${match[2].replaceAll('\\', '/')}` : path.replaceAll('\\', '/')
}
const shellQuote = (value) => `'${bashPath(value).replaceAll("'", "'\\''")}'`
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

function runStaticRollback({ marker, badLabel, badId, incompatible = false, bunfigChanged = false, rollbackTag, curlFailures = 0 } = {}) {
  const fixture = mkdtempSync(resolve(root, 'tests', '.uim-static-rollback-'))
  const server = resolve(fixture, 'server')
  const bin = resolve(fixture, 'bin')
  const previous = rollbackTag ?? 'a'.repeat(40)
  const current = 'b'.repeat(40)
  const eventLog = resolve(fixture, 'events')
  const curlCounter = resolve(fixture, 'curl-count')
  mkdirSync(server)
  mkdirSync(bin)
  mkdirSync(resolve(server, 'secrets'))
  mkdirSync(resolve(server, 'gateway'))
  writeFileSync(resolve(server, 'compose.yml'), 'services: {}\n')
  writeFileSync(resolve(server, 'gateway', 'Caddyfile'), 'example.invalid { reverse_proxy static:80 }\n')
  writeFileSync(resolve(server, 'static-current'), `${current}\n`)
  writeFileSync(resolve(server, 'rollback.env'), [
    `PREVIOUS_BACKEND_IMAGE_TAG=${previous}`,
    `PREVIOUS_WEBAPP_IMAGE_TAG=${previous}`,
    'MEMOLY_DB_ROLLBACK_ALLOWED=false',
    '',
  ].join('\n'), { mode: 0o600 })
  for (const name of ['max_bot_token', 'max_webhook_secret', 'max_inbox_encryption_key']) {
    writeFileSync(resolve(server, 'secrets', name), 'fixture-secret\n', { mode: 0o600 })
  }
  if (marker) writeFileSync(resolve(server, marker), 'forward-only\n')

  const stubs = {
    stat: `#!/usr/bin/env bash\ncase "$2" in %u) printf '0\\n' ;; %a) printf '600\\n' ;; *) exit 2 ;; esac\n`,
    readlink: `#!/usr/bin/env bash\nprintf '%s\\n' "$3"\n`,
    flock: '#!/usr/bin/env bash\nexit 0\n',
    git: `#!/usr/bin/env bash
if [[ " $* " == *" diff --quiet "* ]] && [ "\${STATIC_INCOMPATIBLE:-false}" = true ]; then exit 1; fi
if [[ " $* " == *" diff --quiet "* && " $* " == *" bunfig.toml "* ]] && [ "\${STATIC_BUNFIG_CHANGED:-false}" = true ]; then exit 1; fi
exit 0
`,
    docker: `#!/usr/bin/env bash
set -euo pipefail
if [ "$1" = ps ]; then
  service=
  for arg in "$@"; do case "$arg" in label=com.docker.compose.service=*) service=\${arg##*=} ;; esac; done
  printf 'container-%s\\n' "$service"
elif [ "$1" = inspect ] && [[ "$*" == *".Config.Image}}|{{.Image"* ]]; then
  service=\${4#container-}
  if [ "$service" = static ]; then tag=$(<"$SERVER_ROOT/static-current"); prefix=memoly-webapp; else tag="$STATIC_CURRENT_SHA"; prefix=memoly-backend; fi
  if [ "\${STATIC_BAD_ID_SERVICE:-}" = "$service" ]; then id=sha256:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff; else id=sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa; fi
  printf '%s:%s|%s\\n' "$prefix" "$tag" "$id"
elif [ "$1" = inspect ] && [ "\${3:-}" = '{{.State.Status}}' ]; then
  printf 'running\\n'
elif [ "$1" = inspect ] && [ "\${3:-}" = '{{json .Config.Labels}}' ]; then
  printf '{}\\n'
elif [ "$1" = inspect ] && [ "\${3:-}" = '{{json .NetworkSettings.Networks}}' ]; then
  printf '{"memoly_default":{}}\\n'
elif [ "$1" = inspect ] && [[ "\${3:-}" == *"{{range .Mounts}}"* ]]; then
  printf 'bind|%s/gateway|false\\n' "$SERVER_ROOT"
elif [ "$1" = network ] && [ "$2" = inspect ]; then
  exit 0
elif [ "$1" = image ] && [ "$2" = inspect ]; then
  format= image=
  while [ "$#" -gt 0 ]; do
    if [ "$1" = --format ]; then format=$2; shift 2; continue; fi
    if [ "$1" != image ] && [ "$1" != inspect ]; then image=$1; fi
    shift
  done
  tag=\${image#*:}
  if [[ "$format" == *"{{.Id}}"* ]]; then
    printf 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\\n'
  elif [[ "$format" == *"org.opencontainers.image.revision"* ]]; then
    if [ "\${STATIC_BAD_LABEL_TAG:-}" = "$tag" ]; then printf 'wrong-revision\\n'; else printf '%s\\n' "$tag"; fi
  else printf '%s\\n' "$image"; fi
elif [ "$1" = compose ]; then
  if [[ " $* " == *" up "* ]]; then
    services=; after_up=0
    for arg in "$@"; do
      if [ "$arg" = up ]; then after_up=1; continue; fi
      if [ "$after_up" -eq 1 ] && [[ "$arg" != -* ]]; then services="$services $arg"; fi
    done
    printf 'UP:%s:%s\\n' "\${services# }" "$MEMOLY_WEBAPP_IMAGE_TAG" >> "$STATIC_EVENT_LOG"
    printf '%s\\n' "$MEMOLY_WEBAPP_IMAGE_TAG" > "$SERVER_ROOT/static-current"
  elif [[ " $* " == *" exec "* ]]; then
    exit 0
  elif [[ " $* " == *" config "* ]]; then
    exit 0
  fi
fi
`,
    curl: `#!/usr/bin/env bash
count=0
[ ! -f "$STATIC_CURL_COUNTER" ] || count=$(<"$STATIC_CURL_COUNTER")
count=$((count + 1))
printf '%s\\n' "$count" > "$STATIC_CURL_COUNTER"
if [ "$count" -le "\${STATIC_CURL_FAILURES:-0}" ]; then exit 22; fi
exit 0
`,
    sleep: '#!/usr/bin/env bash\nexit 0\n',
  }
  for (const [name, contents] of Object.entries(stubs)) {
    const path = resolve(bin, name)
    writeFileSync(path, contents)
    chmodSync(path, 0o755)
  }
  const env = {
    SERVER_ROOT: bashPath(server),
    APP_ROOT: bashPath(root),
    COMPOSE_FILE: bashPath(resolve(server, 'compose.yml')),
    ROLLBACK_ENV: bashPath(resolve(server, 'rollback.env')),
    FORWARD_MARKER: bashPath(resolve(server, 'b2.marker')),
    MM0_FORWARD_MARKER: bashPath(resolve(server, 'mm0.marker')),
    SERVER_EDGE_CADDYFILE: bashPath(resolve(server, 'gateway', 'Caddyfile')),
    COMPOSE_PROJECT: 'memoly',
    PUBLIC_URL: 'http://example.invalid',
    STATIC_EVENT_LOG: bashPath(eventLog),
    STATIC_CURL_COUNTER: bashPath(curlCounter),
    STATIC_CURRENT_SHA: current,
    STATIC_INCOMPATIBLE: String(incompatible),
    STATIC_BUNFIG_CHANGED: String(bunfigChanged),
    STATIC_BAD_LABEL_TAG: badLabel ?? '',
    STATIC_BAD_ID_SERVICE: badId ?? '',
    STATIC_CURL_FAILURES: String(curlFailures),
  }
  const shellEnv = Object.entries(env).map(([name, value]) => `export ${name}=${shellQuote(value)}`).join('\n')
  try {
    const result = spawnSync('bash', ['-s'], {
      cwd: root,
      input: `${shellEnv}\nPATH=${shellQuote(bin)}:$PATH\nset -- rollback-static\nsource ${shellQuote(resolve(root, 'deploy/selectel/redeploy.sh'))}\n`,
      encoding: 'utf8',
      timeout: 30_000,
    })
    const output = `${result.stdout}${result.stderr}`
    const events = existsSync(eventLog) ? readFileSync(eventLog, 'utf8') : ''
    return { ...result, output, events, previous, current }
  } finally {
    rmSync(fixture, { recursive: true, force: true })
  }
}

test('UI rollback promotes only the static service after all guards pass', () => {
  const result = runStaticRollback()
  assert.equal(result.status, 0, result.output)
  assert.equal((result.events.match(/^UP:/gm) ?? []).length, 1, result.events)
  assert.match(result.events, new RegExp(`^UP:static:${result.previous}$`, 'm'))
  assert.match(result.output, /UI-only rollback complete/)
})

test('UI rollback rejects forward markers, incompatible trees, bad labels, and image ID mismatches before promotion', () => {
  for (const options of [
    { marker: 'b2.marker' },
    { marker: 'mm0.marker' },
    { incompatible: true },
    { bunfigChanged: true },
    { badLabel: 'a'.repeat(40) },
    { badId: 'backend' },
  ]) {
    const result = runStaticRollback(options)
    assert.notEqual(result.status, 0, result.output)
    assert.doesNotMatch(result.events, /^UP:/m, result.events)
  }
})

test('UI rollback restores the previously running static image after public readiness fails', () => {
  const result = runStaticRollback({ curlFailures: 30 })
  assert.notEqual(result.status, 0, result.output)
  assert.deepEqual(result.events.trim().split('\n'), [
    `UP:static:${result.previous}`,
    `UP:static:${result.current}`,
  ])
  assert.match(result.output, /previously running static image was restored/)
})

const rollbackBaseline = 'e383d79269a3595f4c6cabedf167335aea042cf3'
const currentCandidate = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).stdout.trim()
const candidateRuntimeSha = '39e8af7bb9e9a5949ada3c32dad31d38f9439505'
const rollback180 = '3fce2739205da927b95eb3379b1d066b61282965'
const backendBaselineId = 'sha256:0f461127ce0c7a6438a0fd36b91a1c5252c3f3b35adaf72162f476f1142e93c9'
const webappBaselineId = 'sha256:3bc840c248da2c13d93f7d307c2f52e1104af43d49bf0bad9c00d11377cc236a'
const redeployDefinitions = readFileSync(resolve(root, 'deploy/selectel/redeploy.sh'), 'utf8')
  .replaceAll('\r\n', '\n').replace(/\nmain "\$@"\s*$/, '\n')

function runApplicationRollback(options = {}) {
  const fixture = mkdtempSync(resolve(root, '.scratch/rollback-guard-'))
  const server = resolve(fixture, 'server')
  const backup = resolve(server, 'backups/compose.pre-selectel-fixture')
  mkdirSync(backup, { recursive: true })
  mkdirSync(resolve(server, 'gateway'))
  for (const [name, content] of [['compose.yml', 'services: {}\n'], ['Caddyfile', 'before\n'], ['Caddyfile.static', 'static\n']]) {
    writeFileSync(resolve(backup, name), content)
  }
  writeFileSync(resolve(server, '.selectel-config-backup'), backup + '\n', { mode: 0o600 })
  writeFileSync(resolve(server, 'gateway/Caddyfile'), 'before\n')
  writeFileSync(resolve(server, 'compose.yml'), 'services: {}\n')
  writeFileSync(resolve(server, 'rollback.env'), [
    'PREVIOUS_BACKEND_IMAGE_TAG=' + (options.target ?? rollbackBaseline),
    'PREVIOUS_WEBAPP_IMAGE_TAG=' + (options.webappTarget ?? rollbackBaseline),
    'MEMOLY_DB_ROLLBACK_ALLOWED=false', '',
  ].join('\n'), { mode: 0o600 })
  if (options.marker) writeFileSync(resolve(server, options.marker), 'unfinished\n')
  if (options.noBackup) rmSync(resolve(backup, 'compose.yml'))
  const events = resolve(fixture, 'events')
  const env = {
    SERVER_ROOT: server, APP_ROOT: root, SCRIPT_DIR: resolve(root, 'deploy/selectel'),
    COMPOSE_FILE: resolve(server, 'compose.yml'), ROLLBACK_ENV: resolve(server, 'rollback.env'),
    CONFIG_BACKUP_MARKER: resolve(server, '.selectel-config-backup'),
    SERVER_EDGE_CADDYFILE: resolve(server, 'gateway/Caddyfile'), SERVER_STATIC_CADDYFILE: resolve(server, 'Caddyfile.static'),
    FORWARD_MARKER: resolve(server, 'b2.marker'), MM0_FORWARD_MARKER: resolve(server, 'mm0.marker'),
    MEMOLY_PRODUCT_SHA: options.producer ?? currentCandidate,
    MEMOLY_PUBLIC_HOST: 'example.invalid', PUBLIC_URL: 'http://example.invalid',
    FIXTURE_EVENTS: events, FIXTURE_PENDING: String(options.pending ?? false),
    FIXTURE_STATE_ERROR: String(options.stateError ?? false),
    FIXTURE_UNREAD: String(options.unread ?? true), FIXTURE_MULTIPLE: String(options.multiple ?? true),
    FIXTURE_BACKEND_ID: options.badImage ? 'sha256:' + 'f'.repeat(64) : backendBaselineId,
    FIXTURE_WEBAPP_ID: webappBaselineId, FIXTURE_LABEL: options.badLabel ? 'wrong' : rollbackBaseline,
  }
  const mocks = [
    'load_runtime_secrets() { :; }',
    'gateway_preflight() { :; }',
    'docker() {',
    ' case "$*" in',
    ' *"image inspect --format {{.Id}}"*memoly-backend*) echo "$FIXTURE_BACKEND_ID" ;;',
    ' *"image inspect --format {{.Id}}"*memoly-webapp*) echo "$FIXTURE_WEBAPP_ID" ;;',
    ' *"image inspect --format "*org.opencontainers.image.revision*) echo "$FIXTURE_LABEL" ;;',
    ' *) return 0 ;;',
    ' esac',
    '}',
    'compose() {',
    ' if [[ "$*" == *"prisma migrate status"* ]]; then [ "$FIXTURE_PENDING" = false ]; return; fi',
    ' if [[ "$*" == *"bun -e"* && "$*" == *"Client"* ]]; then',
    '   echo "STATE unread=$FIXTURE_UNREAD multiple=$FIXTURE_MULTIPLE" >> "$FIXTURE_EVENTS"',
    '   [ "$FIXTURE_STATE_ERROR" = false ]; return',
    ' fi',
    ' if [ "$1" = up ]; then echo "UP:$MEMOLY_BACKEND_IMAGE_TAG:$*" >> "$FIXTURE_EVENTS";',
    ' elif [ "$1" = ps ]; then printf "backend\\nworker\\nscheduler\\nstatic\\n"; fi',
    '}',
    'activate_gateway() { cp "$EDGE_CANDIDATE" "$SERVER_EDGE_CADDYFILE"; echo GATE >> "$FIXTURE_EVENTS"; }',
    'curl() {',
    ' if [[ "$*" == *"/api/v1/auth/max"* ]]; then',
    '  if grep -q rollback_auth_maintenance "$SERVER_EDGE_CADDYFILE"; then printf 503; else printf 405; fi',
    ' fi',
    ' return 0',
    '}',
  ].join('\n')
  const trigger = options.failure ? [
    releaseFailure,
    'LEGACY_MEMBERSHIP_RUNTIME=false; LEGACY_MM0_RUNTIME=false; QUIESCE_STARTED=false; PROMOTION_STARTED=true',
    'bash() { if [ "$2" = rollback ]; then ( rollback ); else command bash "$@"; fi; }',
    'trap release_failure EXIT',
    '(exit 42)',
  ].join('\n') : 'rollback'
  const assignments = Object.entries(env).map(([name, value]) => name + '=' + shellQuote(value)).join('\n')
  try {
    const result = spawnSync('bash', ['-s'], {
      input: [redeployDefinitions, assignments, mocks, trigger].join('\n'), encoding: 'utf8', timeout: 30_000,
    })
    return { ...result, output: result.stdout + result.stderr,
      events: existsSync(events) ? readFileSync(events, 'utf8') : '',
      caddy: readFileSync(resolve(server, 'gateway/Caddyfile'), 'utf8') }
  } finally { rmSync(fixture, { recursive: true, force: true }) }
}

test('candidate to #180 is rejected until its exact runtime attestation is implemented', () => {
  const result = runApplicationRollback({ target: rollback180, webappTarget: rollback180, producer: candidateRuntimeSha })
  assert.notEqual(result.status, 0, result.output)
  assert.match(result.output, /rollback target pair has no verified runtime compatibility attestation/)
  assert.doesNotMatch(result.events, /UP:/)
})

for (const flags of [{ unread: true, multiple: false }, { unread: false, multiple: true }]) {
  test('attested application target accepts supported data state ' + JSON.stringify(flags), () => {
    const result = runApplicationRollback(flags)
    assert.equal(result.status, 0, result.output)
    assert.match(result.events, /STATE.*\nGATE\nUP:.*backend worker scheduler static/)
    assert.match(result.output, /Application rollback complete/)
    assert.match(result.caddy, /rollback_auth_maintenance/)
  })
}

test('application rollback fails closed for unknown, incompatible, image, migration, DB and artifact states', () => {
  for (const options of [
    { target: 'f'.repeat(40) }, { producer: rollbackBaseline }, { target: 'f2731e02547fb1118e233c99c47b4ec7c5fc8ba6' },
    { webappTarget: 'a'.repeat(40) }, { stateError: true }, { pending: true },
    { marker: 'b2.marker' }, { marker: 'mm0.marker' }, { badImage: true }, { badLabel: true }, { noBackup: true },
  ]) {
    const result = runApplicationRollback(options)
    assert.notEqual(result.status, 0, JSON.stringify(options) + result.output)
    assert.doesNotMatch(result.events, /UP:/, JSON.stringify(options) + result.events)
  }
})

test('real ci-release failure branch completes guarded application restoration and retains failure status', () => {
  const result = runApplicationRollback({ failure: true })
  assert.equal(result.status, 42, result.output)
  assert.match(result.output, /attempting application rollback/)
  assert.match(result.output, /Application rollback complete/)
  assert.doesNotMatch(result.output, /automatic application rollback failed/)
  assert.match(result.events, /GATE\nUP:.*backend worker scheduler static/)
  const failed = runApplicationRollback({ failure: true, stateError: true })
  assert.equal(failed.status, 42, failed.output)
  assert.match(failed.output, /automatic application rollback failed/)
  assert.doesNotMatch(failed.events, /UP:/)
})

test('normal promotion requires compatibility and a fresh validated backup before service changes', () => {
  const start = redeployDefinitions.indexOf('\ndeploy() {')
  const end = redeployDefinitions.indexOf('\n}\n', start)
  assert.ok(start > 0 && end > start)
  for (const failure of ['none', 'verify_application_rollback', 'validate_database_target', 'backup_database']) {
    const result = spawnSync('bash', ['-s'], { encoding: 'utf8', input: [
      'set -euo pipefail',
      'MM0_BOUNDARY=false; FORWARD_MARKER=/nonexistent-selectel-marker',
      'die() { echo "DIE:$*"; exit 19; }',
      ...['guard_membership_transition', 'preflight', 'backup_server_state', 'verify_application_rollback',
        'validate_database_target', 'backup_database', 'prepare_configuration', 'migration_status',
        'promote_backend', 'wait_backend_internal', 'promote_jobs', 'promote_static',
        'verify_static_internal', 'activate_gateway', 'readiness'].map((name) =>
        name + '() { echo STEP:' + name + '; return ' + (name === failure ? 42 : 0) + '; }'),
      redeployDefinitions.slice(start, end + 2), 'deploy',
    ].join('\n') })
    const output = result.stdout + result.stderr
    if (failure === 'none') {
      assert.equal(result.status, 0, output)
      assert.match(output, /STEP:verify_application_rollback\nSTEP:validate_database_target\nSTEP:backup_database\nSTEP:prepare_configuration/)
    } else {
      assert.notEqual(result.status, 0, output)
      assert.doesNotMatch(output, /STEP:promote_backend/)
    }
  }
})
