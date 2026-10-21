import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { appendFileSync, chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import test, { after } from 'node:test'

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
const candidateRuntimeSha = '39e8af7bb9e9a5949ada3c32dad31d38f9439505'
const rollback180 = '3fce2739205da927b95eb3379b1d066b61282965'
const legacyBackendId = 'sha256:0f461127ce0c7a6438a0fd36b91a1c5252c3f3b35adaf72162f476f1142e93c9'
const legacyWebappId = 'sha256:3bc840c248da2c13d93f7d307c2f52e1104af43d49bf0bad9c00d11377cc236a'
const candidateBackendId = 'sha256:d8fada3265507cc8ee1ae76b83bf851187aaad19c126b3f4fec4cead92c9106c'
const candidateWebappId = 'sha256:9a31bb3f071ae2f11654671fce4a262a37fb4a039e7d7f3c422ed824a7787a66'
const runtimeFingerprints = {
  legacy: '3d021aa1eb5160c8022ad5da3189ee30d6738bcb967f752458bef38145509857',
  candidate: '5555b4b9419d29b4366f5a70fbdd9537a3ccde3230a0497c41fa392de9038107',
  comments: '5a8c7cfe1839c8ed44434f80ddf7a83e1e9f6c43154a249f3b214ca3d25b5e02',
}
const fixtureWorktrees = []
const fixtureSourceCache = new Map()

function runtimeFingerprint(cwd, revision) {
  const result = spawnSync('git', ['ls-tree', '-rz', '--full-tree', '--format=%(objectmode) %(objecttype) %(objectname)%x09%(path)', revision,
    '--', 'backend', 'webapp', 'packages', 'package.json', 'bun.lock', 'bunfig.toml'], { cwd, encoding: null })
  if (result.status !== 0) throw new Error(result.stderr.toString())
  const records = result.stdout.toString('binary').split('\0').filter(Boolean)
  const kept = records.filter((record) => !/^\d+ \w+ [0-9a-f]+\tbackend\/scripts\/(?:[^/]+\.test\.ts$|test-support\/|test-integration\.mjs$)/.test(record))
  return createHash('sha256').update(kept.join('\0') + '\0').digest('hex')
}

function productionRuntimeFingerprint(cwd) {
  const result = spawnSync('bash', ['-s'], {
    cwd: root,
    input: `${redeployDefinitions}\nAPP_ROOT=${shellQuote(cwd)}\nrollback_runtime_fingerprint HEAD\n`,
    encoding: 'utf8',
  })
  if (result.status !== 0) throw new Error(result.stdout + result.stderr)
  return result.stdout.trim().split('\n').at(-1)
}

function gitFixtureCommit(cwd, message) {
  const env = { ...process.env, GIT_AUTHOR_NAME: 'Rollback Test', GIT_AUTHOR_EMAIL: 'rollback-test@example.invalid',
    GIT_COMMITTER_NAME: 'Rollback Test', GIT_COMMITTER_EMAIL: 'rollback-test@example.invalid' }
  for (const args of [['init', '--quiet'], ['add', '.'], ['commit', '--quiet', '-m', message]]) {
    const result = spawnSync('git', args, { cwd, env, encoding: 'utf8' })
    if (result.status !== 0) throw new Error(result.stdout + result.stderr)
  }
}

function rollbackSource(role) {
	if (fixtureSourceCache.has(role)) return fixtureSourceCache.get(role)
  const expected = runtimeFingerprints[role]
  const currentSha = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).stdout.trim()
  const currentStatus = spawnSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).stdout.trim()
  if (!currentStatus && runtimeFingerprint(root, currentSha) === expected) {
    const source = { root, sha: currentSha }
    fixtureSourceCache.set(role, source)
    return source
  }

  const fallback = role === 'candidate' ? candidateRuntimeSha : role === 'comments' ? 'a353f01a8354e42f71473b1917f99c9a97181680' : rollback180
  assert.equal(runtimeFingerprint(root, fallback), expected, `${role} fallback source has the wrong runtime fingerprint`)
  mkdirSync(resolve(root, '.scratch'), { recursive: true })
  const directory = mkdtempSync(resolve(root, '.scratch', `rollback-${role}-worktree-`))
  const added = spawnSync('git', ['worktree', 'add', '--detach', directory, fallback], { cwd: root, encoding: 'utf8' })
  if (added.status !== 0) throw new Error(added.stdout + added.stderr)
  fixtureWorktrees.push(directory)
  const head = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: directory, encoding: 'utf8' }).stdout.trim()
  assert.equal(head, fallback)
  assert.equal(spawnSync('git', ['status', '--porcelain'], { cwd: directory, encoding: 'utf8' }).stdout.trim(), '')
  assert.equal(runtimeFingerprint(directory, head), expected)
  const source = { root: directory, sha: head }
  fixtureSourceCache.set(role, source)
  return source
}

function createSourceWorktree(role) {
  const source = rollbackSource(role)
  mkdirSync(resolve(root, '.scratch'), { recursive: true })
  const directory = mkdtempSync(resolve(root, '.scratch', `rollback-mutation-${role}-`))
  const added = spawnSync('git', ['worktree', 'add', '--detach', directory, source.sha], { cwd: root, encoding: 'utf8' })
  if (added.status !== 0) throw new Error(added.stdout + added.stderr)
  fixtureWorktrees.push(directory)
  return { root: directory, sha: source.sha }
}

function commitSourceChange(source, relativePath, contents, message) {
  appendFileSync(resolve(source.root, relativePath), contents)
  const env = { ...process.env, GIT_AUTHOR_NAME: 'Rollback Test', GIT_AUTHOR_EMAIL: 'rollback-test@example.invalid',
    GIT_COMMITTER_NAME: 'Rollback Test', GIT_COMMITTER_EMAIL: 'rollback-test@example.invalid' }
  const commit = spawnSync('git', ['-c', 'user.name=Rollback Test', '-c', 'user.email=rollback-test@example.invalid',
    'commit', '-am', message], { cwd: source.root, env, encoding: 'utf8' })
  if (commit.status !== 0) throw new Error(commit.stdout + commit.stderr)
  const sha = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: source.root, encoding: 'utf8' }).stdout.trim()
  assert.equal(spawnSync('git', ['status', '--porcelain'], { cwd: source.root, encoding: 'utf8' }).stdout.trim(), '')
  return { ...source, sha }
}

after(() => {
  for (const directory of fixtureWorktrees.reverse()) {
    const result = spawnSync('git', ['worktree', 'remove', directory], { cwd: root, encoding: 'utf8' })
    if (result.status !== 0) throw new Error(result.stdout + result.stderr)
  }
})
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
  const source = options.sourceRootOverride
    ? { root: options.sourceRootOverride, sha: options.sourceShaOverride }
    : rollbackSource(options.source ?? 'legacy')
  const target = options.target ?? rollbackBaseline
  const candidatePair = target === rollback180
  const targetLabel = options.badLabel ? 'wrong' : target
  const events = resolve(fixture, 'events')
  const env = {
    SERVER_ROOT: server, APP_ROOT: source.root, SCRIPT_DIR: resolve(root, 'deploy/selectel'),
    COMPOSE_FILE: resolve(server, 'compose.yml'), ROLLBACK_ENV: resolve(server, 'rollback.env'),
    CONFIG_BACKUP_MARKER: resolve(server, '.selectel-config-backup'),
    SERVER_EDGE_CADDYFILE: resolve(server, 'gateway/Caddyfile'), SERVER_STATIC_CADDYFILE: resolve(server, 'Caddyfile.static'),
    FORWARD_MARKER: resolve(server, 'b2.marker'), MM0_FORWARD_MARKER: resolve(server, 'mm0.marker'),
    MEMOLY_PRODUCT_SHA: options.producer ?? source.sha,
    MAX_BOT_TOKEN: '', MAX_WEBHOOK_SECRET: '', MAX_INBOX_ENCRYPTION_KEY: '',
    MEMOLY_PUBLIC_HOST: 'example.invalid', PUBLIC_URL: 'http://example.invalid',
    FIXTURE_EVENTS: events, FIXTURE_PENDING: String(options.pending ?? false),
    FIXTURE_STATE_ERROR: String(options.stateError ?? false),
    FIXTURE_UNREAD: String(options.unread ?? true), FIXTURE_MULTIPLE: String(options.multiple ?? true),
    FIXTURE_MIGRATION_HISTORY_MISMATCH: String(options.historyMismatch ?? false),
    FIXTURE_MIGRATION_HISTORY_ERROR: String(options.historyError ?? false),
    FIXTURE_BACKEND_ID: options.badImage ? 'sha256:' + 'f'.repeat(64) : (candidatePair ? candidateBackendId : legacyBackendId),
    FIXTURE_WEBAPP_ID: candidatePair ? candidateWebappId : legacyWebappId, FIXTURE_LABEL: targetLabel,
    FIXTURE_AUTH_RESPONSE: options.badAuthResponse ? '502' : '',
    FIXTURE_PROMOTION_FAIL: String(options.promotionFail ?? false),
    ROLLBACK_AUTH_GATE: options.operatorGate ?? '',
  }
  const mocks = [
    'load_runtime_secrets() { export MAX_BOT_TOKEN=synthetic-test-token MAX_WEBHOOK_SECRET=synthetic-test-secret MAX_INBOX_ENCRYPTION_KEY=synthetic-test-key; }',
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
    ' if [[ "$*" == *config* || "$1" = up ]]; then',
    '   [ -n "${MAX_BOT_TOKEN:-}" ] && [ -n "${MAX_WEBHOOK_SECRET:-}" ] && [ -n "${MAX_INBOX_ENCRYPTION_KEY:-}" ] || { echo COMPOSE_SECRET_MISSING >> "$FIXTURE_EVENTS"; return 1; }',
    ' fi',
    ' if [[ "$*" == *"prisma migrate status"* ]]; then [ "$FIXTURE_PENDING" = false ]; return; fi',
    ' if [[ "$*" == *"bun -e"* && "$*" == *"Client"* ]]; then',
    '   if [[ "$*" == *"migration_name"* && "$*" == *"checksum"* ]]; then',
    '     if [[ "$*" == *"MEMOLY_EXPECTED_MIGRATION_CATALOG_SHA256="* ]]; then echo HISTORY_ATTESTATION:present >> "$FIXTURE_EVENTS"; else echo HISTORY_ATTESTATION:missing >> "$FIXTURE_EVENTS"; return 1; fi',
    '     [ "$FIXTURE_MIGRATION_HISTORY_MISMATCH" = false ] && [ "$FIXTURE_MIGRATION_HISTORY_ERROR" = false ]; return',
    '   fi',
    '   echo "STATE unread=$FIXTURE_UNREAD multiple=$FIXTURE_MULTIPLE" >> "$FIXTURE_EVENTS"',
    '   [ "$FIXTURE_STATE_ERROR" = false ]; return',
    ' fi',
    ' if [ "$1" = up ]; then echo "UP:$MEMOLY_BACKEND_IMAGE_TAG:$*" >> "$FIXTURE_EVENTS"; [ "$FIXTURE_PROMOTION_FAIL" = false ];',
    ' elif [ "$1" = ps ]; then printf "backend\\nworker\\nscheduler\\nstatic\\n"; fi',
    '}',
    'activate_gateway() { cp "$EDGE_CANDIDATE" "$SERVER_EDGE_CADDYFILE"; echo GATE >> "$FIXTURE_EVENTS"; }',
    'curl() {',
    ' if [[ "$*" == *"/api/v1/auth/max"* ]]; then',
    '  if [ -n "$FIXTURE_AUTH_RESPONSE" ]; then printf "%s" "$FIXTURE_AUTH_RESPONSE"; elif grep -q rollback_auth_maintenance "$SERVER_EDGE_CADDYFILE"; then printf 503; else printf 404; fi',
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
  ].join('\n') : (options.action ?? 'rollback')
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

test('candidate to #180 uses its exact runtime attestation and normal auth routing', () => {
  const result = runApplicationRollback({ target: rollback180, webappTarget: rollback180, source: 'candidate', operatorGate: 'true' })
  assert.equal(result.status, 0, result.output)
  assert.match(result.events, /STATE.*\nGATE\nUP:.*backend worker scheduler static/)
  assert.match(result.output, /normal authentication routing/)
  assert.doesNotMatch(result.caddy, /rollback_auth_maintenance/)
})

test('measured comments source to #180 attests exact migration history and uses normal auth routing', () => {
  const result = runApplicationRollback({ target: rollback180, webappTarget: rollback180, source: 'comments' })
  assert.equal(result.status, 0, result.output)
  assert.match(result.events, /HISTORY_ATTESTATION:present/)
  assert.match(result.events, /STATE.*\nHISTORY_ATTESTATION:present\nGATE\nUP:.*backend worker scheduler static/)
  assert.match(result.output, /normal authentication routing/)
  assert.doesNotMatch(result.caddy, /rollback_auth_maintenance/)
})

test('comments rollback rejects unknown migration history and history query failures before promotion', () => {
  for (const options of [{ historyMismatch: true }, { historyError: true }]) {
    const result = runApplicationRollback({ target: rollback180, webappTarget: rollback180, source: 'comments', ...options })
    assert.notEqual(result.status, 0, JSON.stringify(options) + result.output)
    assert.match(result.events, /HISTORY_ATTESTATION:present/)
    assert.doesNotMatch(result.events, /UP:|GATE/)
  }
})

test('comments rollback rejects source, schema, contracts, dependency, and protected configuration drift', () => {
  for (const [path, contents] of [
    ['backend/src/worker.ts', '\n// changed comments source fixture\n'],
    ['backend/prisma/schema.prisma', '\n// changed schema fixture\n'],
    ['packages/contracts/src/memories.ts', '\n// changed contract fixture\n'],
    ['bun.lock', '\n# changed dependency lock fixture\n'],
    ['backend/package.json', '\n// changed dependency manifest fixture\n'],
  ]) {
    const source = commitSourceChange(createSourceWorktree('comments'), path, contents, 'mutate comments rollback source')
    const result = runApplicationRollback({ target: rollback180, webappTarget: rollback180,
      sourceRootOverride: source.root, sourceShaOverride: source.sha })
    assert.notEqual(result.status, 0, `${path}: ${result.output}`)
    assert.match(result.output, /application runtime differs from the verified rollback source/)
    assert.doesNotMatch(result.events, /UP:|GATE/)
  }

  const config = commitSourceChange(createSourceWorktree('comments'), 'deploy/selectel/Caddyfile.edge.template',
    '\n# changed protected configuration fixture\n', 'mutate comments service configuration')
  const result = runApplicationRollback({ target: rollback180, webappTarget: rollback180,
    sourceRootOverride: config.root, sourceShaOverride: config.sha })
  assert.notEqual(result.status, 0, result.output)
  assert.match(result.output, /rollback schema, dependencies or service configuration are incompatible/)
  assert.doesNotMatch(result.events, /UP:|GATE/)
})

test('comments rollback rejects wrong targets, immutable image IDs, OCI labels, and incomplete migration state', () => {
  for (const options of [
    { target: rollbackBaseline, webappTarget: rollbackBaseline },
    { badImage: true }, { badLabel: true }, { pending: true }, { stateError: true },
  ]) {
    const result = runApplicationRollback({ target: rollback180, webappTarget: rollback180,
      source: 'comments', ...options })
    assert.notEqual(result.status, 0, JSON.stringify(options) + result.output)
    if (options.target) assert.match(result.output, /rollback target pair has no verified runtime compatibility attestation/)
    if (options.badImage) assert.match(result.output, /rollback backend image differs from the verified production artifact/)
    if (options.badLabel) assert.match(result.output, /rollback image revision label mismatch/)
    if (options.pending) assert.match(result.output, /rollback target cannot confirm completed migrations/)
    if (options.stateError) assert.match(result.output, /rollback data compatibility state is unknown or migration is unfinished/)
    assert.doesNotMatch(result.events, /UP:|GATE/)
  }
})

test('rollback-readiness runs the attestation without changing services or gateway', () => {
  const result = runApplicationRollback({ target: rollback180, webappTarget: rollback180, source: 'candidate', action: 'rollback_readiness' })
  assert.equal(result.status, 0, result.output)
  assert.match(result.output, /readiness verified; no services were changed/)
  assert.doesNotMatch(result.events, /UP:|GATE/)
  assert.equal(result.caddy, 'before\n')
})

test('runtime fingerprint excludes only the declared test-support files', () => {
  mkdirSync(resolve(root, '.scratch'), { recursive: true })
  const fixture = mkdtempSync(resolve(root, '.scratch', 'runtime-fingerprint-'))
  try {
    for (const [path, body] of [
      ['backend/src/app.ts', 'export const app = 1\n'],
      ['backend/scripts/real.test.ts', 'export const test = 1\n'],
      ['backend/scripts/test-support/probe.mjs', 'export const support = 1\n'],
      ['backend/scripts/test-integration.mjs', 'export const integration = 1\n'],
      ['backend/scripts/real.test.ts.production', 'export const production = 1\n'],
      ['webapp/src/app.ts', 'export const web = 1\n'],
      ['packages/contracts/index.ts', 'export const contract = 1\n'],
      ['package.json', '{}\n'], ['bun.lock', 'lock\n'], ['bunfig.toml', '[install]\n'],
    ]) {
      const pathOnDisk = resolve(fixture, path)
      mkdirSync(resolve(pathOnDisk, '..'), { recursive: true })
      writeFileSync(pathOnDisk, body)
    }
    gitFixtureCommit(fixture, 'initial runtime fixture')
    const initial = productionRuntimeFingerprint(fixture)

    writeFileSync(resolve(fixture, 'backend/scripts/real.test.ts'), 'export const test = 2\n')
    writeFileSync(resolve(fixture, 'backend/scripts/test-support/probe.mjs'), 'export const support = 2\n')
    writeFileSync(resolve(fixture, 'backend/scripts/test-integration.mjs'), 'export const integration = 2\n')
    gitFixtureCommit(fixture, 'change excluded test support')
    assert.equal(productionRuntimeFingerprint(fixture), initial)

    writeFileSync(resolve(fixture, 'backend/scripts/real.test.ts.production'), 'export const production = 2\n')
    gitFixtureCommit(fixture, 'change runtime-shaped test filename')
    assert.notEqual(productionRuntimeFingerprint(fixture), initial)
  } finally {
    rmSync(fixture, { recursive: true, force: true })
  }
})

test('rollback guard reaches runtime and service-configuration incompatibility checks', () => {
  const runtimeSource = commitSourceChange(createSourceWorktree('candidate'), 'backend/src/worker.ts',
    '\n// synthetic rollback guard fixture\n', 'mutate runtime source')
  const runtime = runApplicationRollback({ target: rollback180, webappTarget: rollback180,
    sourceRootOverride: runtimeSource.root, sourceShaOverride: runtimeSource.sha })
  assert.notEqual(runtime.status, 0, runtime.output)
  assert.match(runtime.output, /application runtime differs from the verified rollback source/)
  assert.doesNotMatch(runtime.events, /UP:|GATE/)

  const configSource = commitSourceChange(createSourceWorktree('candidate'), 'deploy/selectel/Caddyfile.edge.template',
    '\n# synthetic rollback guard fixture\n', 'mutate service configuration')
  const config = runApplicationRollback({ target: rollback180, webappTarget: rollback180,
    sourceRootOverride: configSource.root, sourceShaOverride: configSource.sha })
  assert.notEqual(config.status, 0, config.output)
  assert.match(config.output, /rollback schema, dependencies or service configuration are incompatible/)
  assert.doesNotMatch(config.events, /UP:|GATE/)
})

test('rollback guard reports unknown and dirty source states before promotion', () => {
  const unknown = runApplicationRollback({ target: rollback180, webappTarget: rollback180,
    source: 'candidate', producer: 'f'.repeat(40) })
  assert.notEqual(unknown.status, 0, unknown.output)
  assert.match(unknown.output, /rollback compatibility revision is unavailable/)
  assert.doesNotMatch(unknown.events, /UP:|GATE/)

  const source = createSourceWorktree('candidate')
  const untracked = resolve(source.root, 'backend/src/rollback-untracked-fixture.ts')
  writeFileSync(untracked, 'export {}\n')
  const dirty = runApplicationRollback({ target: rollback180, webappTarget: rollback180,
    sourceRootOverride: source.root, sourceShaOverride: source.sha })
  rmSync(untracked)
  assert.notEqual(dirty.status, 0, dirty.output)
  assert.match(dirty.output, /rollback source checkout is not clean/)
  assert.doesNotMatch(dirty.events, /UP:|GATE/)
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

  const candidate = runApplicationRollback({ failure: true, source: 'candidate', target: rollback180, webappTarget: rollback180 })
  assert.equal(candidate.status, 42, candidate.output)
  assert.match(candidate.output, /Application rollback complete/)
  assert.doesNotMatch(candidate.caddy, /rollback_auth_maintenance/)
  assert.match(candidate.events, /GATE\nUP:.*backend worker scheduler static/)

  const blocked = runApplicationRollback({ failure: true, source: 'candidate', target: rollback180,
    webappTarget: rollback180, badAuthResponse: true })
  assert.equal(blocked.status, 42, blocked.output)
  assert.match(blocked.output, /normal authentication routing is not active/)
  assert.doesNotMatch(blocked.events, /UP:/)

  const restorationFailure = runApplicationRollback({ failure: true, source: 'candidate', target: rollback180,
    webappTarget: rollback180, promotionFail: true })
  assert.equal(restorationFailure.status, 42, restorationFailure.output)
  assert.match(restorationFailure.output, /automatic application rollback failed/)
  assert.match(restorationFailure.events, /GATE\nUP:/)
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
