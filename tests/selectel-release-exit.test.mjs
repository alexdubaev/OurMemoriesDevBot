import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { appendFileSync, chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import test from 'node:test'
import { afterAll } from 'bun:test'
import { bashExecutable, gitBashPath, linuxPath, runLinuxRoot } from './bash-runtime.mjs'
import './selectel-frontend-release.test.mjs'

const root = resolve(import.meta.dirname, '..')
const release = readFileSync(resolve(root, 'deploy/selectel/ci-release.sh'), 'utf8').replaceAll('\r\n', '\n')
const redeployScript = readFileSync(resolve(root, 'deploy/selectel/redeploy.sh'), 'utf8').replaceAll('\r\n', '\n')
const slowTest = (name, fn) => test(name, { timeout: 60_000 }, fn)
const shellLiteral = (value) => `'${String(value).replaceAll("'", "'\\''")}'`
const shellQuote = (value) => shellLiteral(gitBashPath(value))

function runHandler({ legacy = false, quiesced = false, promoted = false, trigger }) {
  return spawnSync(bashExecutable, ['-s'], {
    input: `
set -euo pipefail
. ${shellQuote(resolve(root, 'deploy/selectel/ci-release.sh'))}
LEGACY_MEMBERSHIP_RUNTIME=${legacy}
LEGACY_MM0_RUNTIME=false
QUIESCE_STARTED=${quiesced}
PROMOTION_STARTED=${promoted}
MM0_FORWARD_MARKER=/nonexistent-mm0-marker
APP_ROOT=/mock/app
bash() { printf 'ACTION:%s\\n' "$*"; return 0; }
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

test('documented bash -s release entry reaches SHA validation before creating a deployment lock', () => {
  const fixture = mkdtempSync(resolve(root, 'tests', '.release-stdin-'))
  const bin = resolve(fixture, 'bin')
  const server = resolve(fixture, 'server')
  mkdirSync(bin, { recursive: true })
  mkdirSync(server, { recursive: true })
  const requiredCommands = [
    'awk', 'cp', 'date', 'df', 'docker', 'git', 'getent', 'id', 'install', 'sudo',
    'mv', 'flock', 'curl', 'sed', 'find', 'sha256sum', 'stat', 'sync',
  ]
  for (const command of requiredCommands) {
    const executable = resolve(bin, command)
    writeFileSync(executable, command === 'id'
      ? '#!/bin/sh\n[ "$1" = -u ] && { printf "0\\n"; exit 0; }\nexit 91\n'
      : '#!/bin/sh\nexit 0\n')
    chmodSync(executable, 0o755)
  }

  try {
    const result = spawnSync(bashExecutable, ['-s', '--', 'invalid-sha'], {
      input: `PATH=${shellQuote(gitBashPath(bin))}:$PATH\nSERVER_ROOT=${shellQuote(gitBashPath(server))}\n${release}`,
      encoding: 'utf8',
      timeout: 30_000,
    })
    assert.equal(result.status, 1, `${result.stdout}${result.stderr}`)
    assert.match(result.stderr, /ERROR: release SHA must be a 40-character lowercase Git SHA/)
    assert.equal(existsSync(resolve(server, '.selectel-deploy.lock')), false)
    assert.equal(readdirSync(server).length, 0, 'rejected input leaves server files untouched')
  } finally {
    rmSync(fixture, { recursive: true, force: true })
  }
})

slowTest('Control sampler installer path guard rejects symlink and writable ancestors before installation', () => {
  const script = linuxPath(resolve(root, 'deploy/selectel/ci-release.sh'))
  const repository = linuxPath(root)
  const gitDirectory = linuxPath(spawnSync('git', ['rev-parse', '--absolute-git-dir'], { cwd: root, encoding: 'utf8' }).stdout.trim())
  const result = runLinuxRoot(`
set -euo pipefail
. '${script}'
fixture=$(mktemp -d /root/control-path-guard.XXXXXX)
trap 'rm -rf -- "$fixture"' EXIT
chmod 0755 "$fixture"
mkdir -m 0755 "$fixture/safe"
touch "$fixture/safe/sampler.py"
assert_root_owned_path "$fixture/safe/sampler.py" file
ln -s "$fixture/safe" "$fixture/link"
if ( assert_root_owned_path "$fixture/link/sampler.py" file ) >/dev/null 2>&1; then
  echo 'symlink ancestor was accepted' >&2
  exit 31
fi
mkdir -m 0775 "$fixture/writable"
touch "$fixture/writable/sampler.py"
if ( assert_root_owned_path "$fixture/writable/sampler.py" file ) >/dev/null 2>&1; then
  echo 'writable ancestor was accepted' >&2
  exit 32
fi
mkdir -m 0755 "$fixture/bin"
printf '#!/bin/sh\\nexit 0\\n' > "$fixture/bin/python3.12"
chmod 0755 "$fixture/bin/python3.12"
ln -s python3.12 "$fixture/bin/python3"
assert_root_controlled_interpreter "$fixture/bin/python3"
chmod 0664 "$fixture/bin/python3.12"
if ( assert_root_controlled_interpreter "$fixture/bin/python3" ) >/dev/null 2>&1; then
  echo 'unsafe resolved interpreter was accepted' >&2
  exit 33
fi
printf 'PASS: root-owned non-writable path accepted; symlink and writable ancestors rejected\\n'
`)
  assert.equal(result.status, 0, result.stdout + result.stderr)
  assert.match(result.stdout, /symlink and writable ancestors rejected/)
  assert.match(release, /control_root=\/opt\/memoly\/control metrics_dir=\/opt\/memoly\/control\/metrics/)
  assert.match(release, /install_pinned_control_host_inputs "\$control_root" "\$systemd_dir"/)
  assert.match(release, /"deploy\/selectel\/control\/sampler\.py:\$control_root\/sampler\.py:0644"/)

  const install = runLinuxRoot(`
set -euo pipefail
. '${script}'
APP_ROOT='${repository}'
export GIT_DIR='${gitDirectory}' GIT_WORK_TREE='${repository}'
PRODUCT_SHA=$(git -C "$APP_ROOT" rev-parse HEAD)
fixture=$(mktemp -d /root/control-installer-guard.XXXXXX)
trap 'rm -rf -- "$fixture"' EXIT
mkdir -m 0755 "$fixture/control" "$fixture/systemd"
install_pinned_control_host_inputs "$fixture/control" "$fixture/systemd"
for path in "$fixture/control/sampler.py" "$fixture/systemd/memoly-control-sampler.service" "$fixture/systemd/memoly-control-sampler.timer"; do
  [ "$(stat -c '%a' -- "$path")" = 644 ] || exit 34
done
printf 'PASS: all pinned host files copied with verified bytes and mode 0644\\n'
`)
  assert.equal(install.status, 0, install.stdout + install.stderr)
  assert.match(install.stdout, /verified bytes and mode 0644/)
})

slowTest('Control rollback readiness requires root-owned installed artifacts with exact sampler and unit bytes', () => {
  const script = linuxPath(resolve(root, 'deploy/selectel/redeploy.sh'))
  const repository = linuxPath(root)
  const pins = Object.fromEntries([
    ['sampler', 'deploy/selectel/control/sampler.py'],
    ['service', 'deploy/selectel/control/memoly-control-sampler.service'],
    ['timer', 'deploy/selectel/control/memoly-control-sampler.timer'],
  ].map(([name, path]) => [name, spawnSync('git', ['hash-object', path], { cwd: root, encoding: 'utf8' }).stdout.trim()]))
  const pinBytes = Object.fromEntries(Object.entries(pins).map(([name, hash]) => {
    const result = spawnSync('git', ['cat-file', 'blob', hash], { cwd: root })
    assert.equal(result.status, 0, result.stderr?.toString('utf8'))
    return [name, result.stdout.toString('base64')]
  }))
  assert.match(pins.sampler, /^[0-9a-f]{40}$/)
  assert.match(pins.service, /^[0-9a-f]{40}$/)
  assert.match(pins.timer, /^[0-9a-f]{40}$/)
  const result = runLinuxRoot(`
set -euo pipefail
. '${script}'
fixture=$(mktemp -d /root/control-installed-guard.XXXXXX)
trap 'rm -rf -- "$fixture"' EXIT
APP_ROOT="$fixture/app"
mkdir -m 0755 "$APP_ROOT"
git -C "$APP_ROOT" init --quiet
CONTROL_PIN_SAMPLER_BLOB='${pins.sampler}'
CONTROL_PIN_SERVICE_BLOB='${pins.service}'
CONTROL_PIN_TIMER_BLOB='${pins.timer}'
PIN_SAMPLER_B64='${pinBytes.sampler}'
PIN_SERVICE_B64='${pinBytes.service}'
PIN_TIMER_B64='${pinBytes.timer}'
mkdir -m 0755 "$APP_ROOT/control" "$APP_ROOT/control/metrics" "$APP_ROOT/systemd"
printf '%s' "$PIN_SAMPLER_B64" | base64 -d > "$APP_ROOT/control/sampler.py"
printf '%s' "$PIN_SERVICE_B64" | base64 -d > "$APP_ROOT/systemd/memoly-control-sampler.service"
printf '%s' "$PIN_TIMER_B64" | base64 -d > "$APP_ROOT/systemd/memoly-control-sampler.timer"
chmod 0644 "$APP_ROOT/control/sampler.py" "$APP_ROOT/systemd/memoly-control-sampler.service" "$APP_ROOT/systemd/memoly-control-sampler.timer"
printf '{}\\n' > "$APP_ROOT/control/metrics/snapshot.json"
chmod 0644 "$APP_ROOT/control/metrics/snapshot.json"
rollback_control_installed_inputs_match "$APP_ROOT/control" "$APP_ROOT/systemd"
printf 'PASS: exact protected installed chain accepted\\n'
printf '# drift\\n' >> "$APP_ROOT/control/sampler.py"
if rollback_control_installed_inputs_match "$APP_ROOT/control" "$APP_ROOT/systemd"; then
  echo 'changed installed sampler was accepted' >&2; exit 41
fi
rm -f "$APP_ROOT/control/sampler.py"
printf '%s' "$PIN_SAMPLER_B64" | base64 -d > "$APP_ROOT/control/sampler.py"
chmod 0644 "$APP_ROOT/control/sampler.py"
chmod 0664 "$APP_ROOT/control/sampler.py"
if rollback_control_installed_inputs_match "$APP_ROOT/control" "$APP_ROOT/systemd"; then
  echo 'writable installed sampler was accepted' >&2; exit 42
fi
rm -f "$APP_ROOT/control/sampler.py"
printf '%s' "$PIN_SAMPLER_B64" | base64 -d > "$APP_ROOT/control/sampler.py"
chmod 0644 "$APP_ROOT/control/sampler.py"
mv "$APP_ROOT/control/sampler.py" "$APP_ROOT/control/sampler.expected"
ln -s sampler.expected "$APP_ROOT/control/sampler.py"
if rollback_control_installed_inputs_match "$APP_ROOT/control" "$APP_ROOT/systemd"; then
  echo 'symlink installed sampler was accepted' >&2; exit 43
fi
printf 'PASS: changed bytes, writable mode, and symlink rejected\\n'
`)
  assert.equal(result.status, 0, result.stdout + result.stderr)
  assert.match(result.stdout, /exact protected installed chain accepted/)
  assert.match(result.stdout, /changed bytes, writable mode, and symlink rejected/)
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

test('planned release validates accepted UI v4 ancestry before any resume mutation', () => {
  const run = (sha, withUiDowngradeCheck = false) => spawnSync(bashExecutable, ['-s'], {
    input: [
      'set -euo pipefail',
      `. '${gitBashPath(resolve(root, 'deploy/selectel/ci-release.sh'))}'`,
      `APP_ROOT=${shellQuote(root)}`,
      `PRODUCT_SHA=${sha}`,
      'ACCEPTED_UI_V4_SHA=afdb408f8bbf22b564c86bb8d33a83261f55cc48',
      'die() { printf "ERROR: %s\\n" "$*" >&2; exit 9; }',
      'git_memoly() { case "$1" in fetch) echo READ_ONLY_FETCH ;; rev-parse) printf "%s\\n" "$PRODUCT_SHA" ;; *) return 90 ;; esac; }',
      'git_root() { git -c "safe.directory=$APP_ROOT" -C "$APP_ROOT" "$@"; }',
      'validate_planned_source',
      withUiDowngradeCheck ? [redeployDefinitions, `require_accepted_ui_target ${sha}`].join('\n') : '',
      'echo MUTATION_BOUNDARY',
    ].filter(Boolean).join('\n'),
    encoding: 'utf8', timeout: 10_000,
  })
  const old = run(rollback180)
  assert.equal(old.status, 9, old.stdout + old.stderr)
  assert.doesNotMatch(old.stdout, /MUTATION_BOUNDARY/)
  assert.match(old.stderr, /accepted UI v4/)

  const acceptedSha = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).stdout.trim()
  const current = run(acceptedSha, true)
  assert.equal(current.status, 0, current.stdout + current.stderr)
  assert.match(current.stdout, /MUTATION_BOUNDARY/)
})

function runStaticRollback({ marker, badLabel, badId, incompatible = false, bunfigChanged = false, rollbackTag, curlFailures = 0 } = {}) {
  const fixture = mkdtempSync(resolve(root, 'tests', '.uim-static-rollback-'))
  const server = resolve(fixture, 'server')
  const bin = resolve(fixture, 'bin')
  const previous = rollbackTag ?? rollbackV4
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
if [[ " $* " == *" merge-base --is-ancestor afdb408f8bbf22b564c86bb8d33a83261f55cc48 "* ]]; then
  [[ "$*" == *" 4b4edc0992803b84c919aadb835e8d2e21095c51"* ]] && exit 0
  exit 1
fi
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
    SERVER_ROOT: gitBashPath(server),
    APP_ROOT: gitBashPath(root),
    COMPOSE_FILE: gitBashPath(resolve(server, 'compose.yml')),
    ROLLBACK_ENV: gitBashPath(resolve(server, 'rollback.env')),
    FORWARD_MARKER: gitBashPath(resolve(server, 'b2.marker')),
    MM0_FORWARD_MARKER: gitBashPath(resolve(server, 'mm0.marker')),
    SERVER_EDGE_CADDYFILE: gitBashPath(resolve(server, 'gateway', 'Caddyfile')),
    COMPOSE_PROJECT: 'memoly',
    PUBLIC_URL: 'http://example.invalid',
    STATIC_EVENT_LOG: gitBashPath(eventLog),
    STATIC_CURL_COUNTER: gitBashPath(curlCounter),
    STATIC_CURRENT_SHA: current,
    STATIC_INCOMPATIBLE: String(incompatible),
    STATIC_BUNFIG_CHANGED: String(bunfigChanged),
    STATIC_BAD_LABEL_TAG: badLabel ?? '',
    STATIC_BAD_ID_SERVICE: badId ?? '',
    STATIC_CURL_FAILURES: String(curlFailures),
  }
  const shellEnv = Object.entries(env).map(([name, value]) => `export ${name}=${shellQuote(value)}`).join('\n')
  try {
    const result = spawnSync(bashExecutable, ['-s'], {
      cwd: root,
      input: `${shellEnv}\nPATH=${shellQuote(bin)}:$PATH\nset -- rollback-static\nsource ${shellQuote(resolve(root, 'deploy/selectel/redeploy.sh'))}\nmain "$@"\n`,
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

test('static rollback rejects pre-v4 UI before static service mutation', () => {
  const result = runStaticRollback({ rollbackTag: rollback180 })
  assert.notEqual(result.status, 0, result.output)
  assert.match(result.output, /UI downgrade is forbidden/)
  assert.doesNotMatch(result.events, /UP:/)
})

slowTest('UI rollback rejects forward markers, incompatible trees, bad labels, and image ID mismatches before promotion', () => {
  for (const options of [
    { marker: 'b2.marker' },
    { marker: 'mm0.marker' },
    { incompatible: true },
    { bunfigChanged: true },
    { badLabel: rollbackV4 },
    { badId: 'backend' },
  ]) {
    const result = runStaticRollback(options)
    assert.notEqual(result.status, 0, result.output)
    assert.doesNotMatch(result.events, /^UP:/m, result.events)
  }
})

slowTest('UI rollback restores the previously running static image after public readiness fails', () => {
  const result = runStaticRollback({ curlFailures: 30 })
  assert.notEqual(result.status, 0, result.output)
  assert.deepEqual(result.events.trim().split('\n'), [
    `UP:static:${result.previous}`,
    `UP:static:${result.current}`,
  ])
  assert.match(result.output, /previously running static image was restored/)
})

const rollbackBaseline = 'e383d79269a3595f4c6cabedf167335aea042cf3'
const rollback180 = '3fce2739205da927b95eb3379b1d066b61282965'
const rollbackV4 = '4b4edc0992803b84c919aadb835e8d2e21095c51'
const rollbackHealthy = '33a0054c3c71372aa5509ee8ebfa4578ad512ea1'
const maxVideoRecoveryBackend = 'd2999cca6e4e5980cc2277de7453440353f5b392'
const maxVideoRecoveryWebapp = 'd2999cca6e4e5980cc2277de7453440353f5b392'
const maxVideoRecoveryBackendId = 'sha256:cb1f1e3aca79452701d7410e5bccef7e93a1eda08de5c36cfab19202f0632309'
const maxVideoRecoveryWebappId = 'sha256:6d77034ed1be4f8fea0d86ee7f0fb8fdfebb5706c5c4358d8b608d7e32f1e62d'
const maxVideoRecoveryRuntime = 'b3afd175383307713f5a86470db755b621c9eec0ff93fcfff4e97e1150d41dc9'
const legacyBackendId = 'sha256:0f461127ce0c7a6438a0fd36b91a1c5252c3f3b35adaf72162f476f1142e93c9'
const legacyWebappId = 'sha256:3bc840c248da2c13d93f7d307c2f52e1104af43d49bf0bad9c00d11377cc236a'
const candidateBackendId = 'sha256:d8fada3265507cc8ee1ae76b83bf851187aaad19c126b3f4fec4cead92c9106c'
const candidateWebappId = 'sha256:9a31bb3f071ae2f11654671fce4a262a37fb4a039e7d7f3c422ed824a7787a66'
const v4BackendId = 'sha256:400f49886253aeb1d23d3688de5d5cce20fba3b4b1c20a82a9d6453ecb7d2bdc'
const v4WebappId = 'sha256:70682430fd480dfddb3d3df0431665ea71d8018c0a0993993b8ffb6360baadf9'
const healthyBackendId = 'sha256:50ef108db452f8da24a159161edb0510ed3fe5612275ac701bf883327315dfd9'
const healthyWebappId = 'sha256:63be673e1a57af5faaeafa6b3d3136314808b8826640873f5cafa4f4f9bebe74'
const runtimeFingerprints = {
  legacy: '3d021aa1eb5160c8022ad5da3189ee30d6738bcb967f752458bef38145509857',
  comments: '5a8c7cfe1839c8ed44434f80ddf7a83e1e9f6c43154a249f3b214ca3d25b5e02',
  diagnostic: '2be6fc2b96f4731c4ea3821b50f112c01d8e9a62da57eeb6675f8513fd26b088',
  selectel: '9afbb1656016effbac74a367b23a7608494b7834e8091f375d20fea858e4c468',
  comux: 'ae2c05a046080f4ea72c2ca70db131eaa866c05bf5444e50070f92273f7b0f87',
  feedPhoto: '9c848684f56ce26f57af81136d1dfc351d4a1c52776dcfc41d1291e8e46a6fda',
}
const reviewedAlbumsProductionBlobs = [
  ['backend/prisma/migrations/20261023110000_memoly_albums/migration.sql', '300ed2e36f6974588a929dff34efe1234e0fb7c4'],
  ['backend/prisma/migrations/20261023120000_album_entry_tombstones_year_uniqueness/migration.sql', '6219657f99482108fb99ce17cbabe848980e7e9d'],
  ['backend/prisma/migrations/20261023130000_album_source_operation_receipts/migration.sql', 'acc9a6596e672bb134c31cc3c5451be1754f570b'],
  ['backend/prisma/schema.prisma', '1f491f708ffc60ee727b814f0e2b2a1c5753c6bd'],
  ['backend/src/app.ts', '0faaaeb230cf5d5a3c5629306548a54efdc09202'],
  ['backend/src/modules/albums/application/album-repository.ts', '06682eb9e6a65c3d078712645fa2ab6747ac87f1'],
  ['backend/src/modules/albums/application/album-service.ts', 'e8e77c9dc3526cfdb55c5f1a123dd6bc9f07064d'],
  ['backend/src/modules/albums/application/album-types.ts', 'ca4263c7c9b166cdf1298ba41c136b12d76988e5'],
  ['backend/src/modules/albums/domain/errors.ts', '28bf28f8634d04e04da771c4650b2dd072cf58f7'],
  ['backend/src/modules/albums/index.ts', 'eb7a94f3ff17452bcfa533785409e9520226847d'],
  ['backend/src/modules/albums/infrastructure/prisma-album-repository.ts', '5251b43df84173f51c1ff0275124a81d5faba5d2'],
  ['backend/src/modules/albums/transport/routes.ts', '98f87dfe126fa2a60b7ea5886225a143eac770e3'],
  ['backend/src/modules/memories/application/album-source-ports.ts', '446a0a1b9e89f265341f2fb8b2788666b0e9b1c9'],
  ['backend/src/modules/memories/application/ports.ts', '96a47aaed4980874c89cc50236a7fec1166454d7'],
  ['backend/src/modules/memories/index.ts', 'ff63cef6ff050f8f807e54c1384d8c51ec40576b'],
  ['backend/src/modules/memories/infrastructure/album-memory-source-catalog.ts', '055968ffd6b7ff2a60835769265243f9ba0f79c7'],
  ['bun.lock', '1e6ca895f4498c94b59ae1b4e9e97d5a99a59409'],
  ['packages/contracts/src/albums.ts', '02728e7a37bf2ded770e086d8d7feecb7e28f1c8'],
  ['packages/contracts/src/errors.ts', '27349f54b21299d8e71bcba7c4dba13ccffa5783'],
  ['packages/contracts/src/index.ts', 'd9968474cd93fd32d5b91d5d1bb2177b314dd091'],
  ['webapp/package.json', '1202c550eaa3a6cbd90fbd9f5a9c4b30080cec8a'],
  ['webapp/public/assets/fonts/Comfortaa-OFL.txt', '1ecc8c6edc4c6624e40b073ea17d177a5641b9e3'],
  ['webapp/src/App.tsx', 'cb7c21023d6d94033e996f7e2352948235506c5f'],
  ['webapp/src/components/BottomNavigation.tsx', '57644cdc55cd16ca94ddf268e75efeca4c87ba5d'],
  ['webapp/src/components/ChildHeader.tsx', '1f7078cbc38204f7ba296711a5f1d3661cbe83d5'],
  ['webapp/src/components/ui-v2/ChildHeaderV2.css', '1161cc95a5c003d89d8ed432aac8a7c85c7735be'],
  ['webapp/src/components/ui-v2/ChildHeaderV2.tsx', '4e88167ccdfe0c85e1807c52f265df2d6e17bf5f'],
  ['webapp/src/components/ui-v2/shared-skin.css', '5388c7da8d0a37a16b82c28b694928aa1b1e5535'],
  ['webapp/src/features/albums/AlbumEntryDetail.tsx', '7a7f0348913575fa85092ceea65e44c7b0ee3ff7'],
  ['webapp/src/features/albums/AlbumForms.tsx', 'ad4104ae92ec26cb995f520b8194f348152c51f4'],
  ['webapp/src/features/albums/AlbumsPage.tsx', '225cfdd6fb9ccc0f2f722ec75702648b2d202ace'],
  ['webapp/src/features/albums/ComposerHost.tsx', '68ab9a74544d32f8f1fb8ee5107b06789f0d399c'],
  ['webapp/src/features/albums/EntryEditor.tsx', '673897347f8bd7543802618fdeda201d88cfb476'],
  ['webapp/src/features/albums/SourcePicker.tsx', 'ad228d1c001a8bc9b9aeae1b1d48fc25b53182a9'],
  ['webapp/src/features/albums/SourcePreview.tsx', '7b1f910379a897d52873143e72dc0e2a1c0d2bfd'],
  ['webapp/src/features/albums/WorkshopGallery.tsx', 'e75c38888204279365dcac76c6a058a0ee5cac17'],
  ['webapp/src/features/albums/albums.css', 'c78100e52d48c5d281f990fecd11194ef983f2e0'],
  ['webapp/src/features/albums/api.ts', '16202ec4fe71ab829671ab30e08bc000a1d2fd3f'],
  ['webapp/src/features/albums/index.ts', '3fa66040d4d7441fae38ab4dce5fa1851d32f5a5'],
  ['webapp/src/features/albums/model.ts', '18a7ab1c13cf82c4d66be8ec52762a883104eda5'],
  ['webapp/src/features/composer/ComposerForm.tsx', '1fbbebb92536122469d6ce3cb09d90161859175f'],
  ['webapp/src/features/composer/NoteComposer.tsx', 'c534376687dafa8c008514b0e87106d26d6ea351'],
  ['webapp/src/features/composer/PhotoComposer.tsx', 'ccddd7350dd472eec169347e6d3c968d9d48ccc4'],
  ['webapp/src/features/family/ChildAvatar.tsx', '4ddf89fa7226a3a3ea000eceaa798e978361edf8'],
  ['webapp/src/features/family/ChildProfile.css', '93e89a50d3a66673f023cfa541fa1dbaaa1342f0'],
  ['webapp/src/features/family/FamilyHubPage.tsx', '40964e4dfeaae1b7a5215fe3c55bdb2394332f73'],
  ['webapp/src/features/family/FamilyOnboarding.tsx', '2ae2d0b6288ee446f884e134f2a22aefafac9bf1'],
  ['webapp/src/features/family/FamilyScreen.tsx', '5367cb6da8f03fd7cb517053656be493e72f270a'],
  ['webapp/src/features/family/family-hub.css', '50f6ccb272456209bd44fd48d7ba6f383980c7f0'],
  ['webapp/src/features/family/useChildAvatar.ts', 'f2c3a017ed01ee2117493c2412edea0a219d0a6b'],
  ['webapp/src/features/feed/FeedPage.tsx', '11e30b06060652703401123a77dccab4efe9a4f7'],
  ['webapp/src/features/feed/index.ts', 'fdd3167bc180d873801926c893550dd4fb4db83a'],
  ['webapp/src/features/feed/presentation/FeedPresentation.tsx', 'ad76a6f911d29afc310c3e954d62c9dce72f38a6'],
  ['webapp/src/features/feed/presentation/MemoryCardPresentation.tsx', '146bef666016a7faf311bed861db798cf77af046'],
  ['webapp/src/features/feed/presentation/memoly-feed.css', 'fee8d9ded865635455fe684c112f513134a6ca13'],
  ['webapp/src/features/feed/use-memory-seen-observer.ts', 'abc81f827cba1224c4d4c76987be8a6d9c2394f1'],
  ['webapp/src/features/feed/video-presentation.tsx', 'c3d3fd1f12bb7493d002448d61deae81d391b768'],
  ['webapp/src/features/max-video-upload/VideoComposer.tsx', '7291ca902315bf27cd0bf117649b989814d556ce'],
  ['webapp/src/features/memoly-ui/FamilyPresentation.tsx', '86528665625ae140ed84652a3db73b3baad60b11'],
  ['webapp/src/features/memoly-ui/MemberProfile.tsx', '95f7744ae73783c53fb5770fdd313063fb3b7abb'],
  ['webapp/src/features/welcome/WelcomeSplash.tsx', '60388d4b83e4b4fd46e9c82f7213a43ae2fa0a0d'],
  ['webapp/src/features/welcome/welcome-splash.css', '18174a67d1aad32d10c509a93e576ccbfadf3936'],
  ['webapp/src/index.css', '8d088751c71a08c43252f31fb1990db124657147'],
  ['webapp/src/main.tsx', '5468ed089f85d2f243e2a893264f104d199687b3'],
  ['webapp/src/platform/app-zoom.ts', '496ccf4476ec9f8794d965001d5801ed4ec96b29'],
  ['webapp/src/platform/max/host-bridge.ts', '3fdcd8ad8759bf0fa3391f95f1c48d4d732d8fdd'],
  ['webapp/src/platform/media/avatar-resource-pool.ts', '2e04a01ba8ead3c4e5e2c3985e654226f4b5243f'],
  ['webapp/src/platform/media/use-private-image-url.ts', '73a376f7d919dbad664eec30ddfa903fe8b0313b'],
  ['webapp/src/platform/persistence/private-cache.ts', '302b1f5a95b8ad092b255a936959e5d6e324180c'],
]
const reviewedAvatarTimerFixBlob = 'e97e72aebc8df97a90990a481de36fd78e77483e'
const reviewedStorybookManifestBlob = '52a87894fbcc32b5ab0fa0e2c5217d85b3214cd2'
const reviewedStorybookLockBlob = '67d34b3065b163092b09e4b91c42274405fe7823'
const reviewedMediaUiBlobs = [
  ['bun.lock', '36bcc71d60db020a4e65fe9cb8b7559b17625916'],
  ['webapp/package.json', '9f907f4cba1a99b7a6e7dcc82f1d6f84da4bdfec'],
  ['webapp/src/App.tsx', 'de773296cb4a7e021ebc640f4f9075bce11ca9b5'],
  ['webapp/src/components/ui-v2/ChildHeaderV2.css', '44816e178118bb2436a4e5fe951ae44bd6a2ccbd'],
  ['webapp/src/components/ui-v2/ChildHeaderV2.tsx', '1b387846246848e9b769297b28cbab33862d92ff'],
  ['webapp/src/components/ui-v2/shared-skin.css', '55fd96fefcfca1add8ed3f87c2d17bf1dbc8649d'],
  ['webapp/src/features/family/ChildProfile.css', '93e89a50d3a66673f023cfa541fa1dbaaa1342f0'],
  ['webapp/src/features/family/FamilyOnboarding.tsx', '2ae2d0b6288ee446f884e134f2a22aefafac9bf1'],
  ['webapp/src/features/family/FamilyScreen.tsx', '6b86aafa30182075b5703b538be8a43f9d9aa76a'],
  ['webapp/src/features/feed/FeedPage.tsx', 'ce6d53fef6f739703392cc2cb8061f2be8859fca'],
  ['webapp/src/features/feed/video-presentation.tsx', 'c3d3fd1f12bb7493d002448d61deae81d391b768'],
  ['webapp/src/features/feed/presentation/memoly-feed.css', '13ebe687faae12eec77a068d078bffffb52238f2'],
  ['webapp/src/features/feed/use-memory-seen-observer.ts', 'abc81f827cba1224c4d4c76987be8a6d9c2394f1'],
  ['webapp/src/features/memoly-ui/FamilyPresentation.tsx', 'a5784a62b4df8d4554fc99633ba3c060f62b8a52'],
  ['webapp/src/features/memoly-ui/MemberProfile.tsx', '95f7744ae73783c53fb5770fdd313063fb3b7abb'],
]
const reviewedPrivatePhotoProductionBlobs = [
  ['bun.lock', '294e9b17d83b38fa6b14feeee949bcac7921ce4e'],
  ['backend/prisma/migrations/20261023150000_album_private_photos/migration.sql', '1a3232d1ee4d53c23205580a5faa13ded2a524d2'],
  ['backend/prisma/schema.prisma', '5e66d187c9b98165928acdd22548785777ee11c0'],
  ['backend/src/jobs.ts', 'b4774dbb15c993fee4b9985dea185808ceb584f0'],
  ['backend/src/modules/albums/index.ts', '8c8ae9e62b96eabdd7771e4b97d0363e3f068439'],
  ['backend/src/modules/albums/infrastructure/composed-album-source-catalog.ts', '3ca86aa8b21e63813df360fd26d7dbf273b9d47b'],
  ['backend/src/modules/albums/infrastructure/prisma-album-repository.ts', '382c809fa85efbd0d7c2b6db02c5e3bef7b39773'],
  ['backend/src/modules/media/application/ports.ts', '01e0881e7ffbafde73dbc14d4472dd54bdb7b4ed'],
  ['backend/src/modules/media/index.ts', '1e04ca12ded1ddca5cd0639a9700ea9cdff244a2'],
  ['backend/src/modules/media/infrastructure/prisma-album-photo-source-catalog.ts', 'c1a4a71a12505e1a6ba0192cb38187f30674cc18'],
  ['backend/src/modules/media/infrastructure/prisma-media-repository.ts', '3f36b7836601c228b0f01b0d87f4d11e667da8f7'],
  ['backend/src/modules/memories/index.ts', '974276ac646c9038a1805b6a8f24c6422983bbfd'],
  ['backend/src/modules/memories/infrastructure/prisma-memory-repository.ts', '150072bdbb48a87f473e39a5dff55fcc03663586'],
  ['backend/src/modules/memories/infrastructure/source-memory-publisher.ts', '9404465526d36838a52197a8f600cff7372119db'],
  ['packages/contracts/src/albums.ts', '163dbe2fe344331fd21bc7481e003b56fbb3efbc'],
  ['webapp/src/features/albums/AlbumEntryDetail.tsx', '0320fd50d15b4d68326e81beeeb23a806f064638'],
  ['webapp/src/features/albums/AlbumsPage.tsx', '240d12a4482033002ab1fb6e7e3b8dc3d5cf5211'],
  ['webapp/src/features/albums/ComposerHost.tsx', '70f434256c7235dab2921dc7835b0d7e2887e407'],
  ['webapp/src/features/albums/EntryEditor.tsx', '0668701c8f58e4a82c45def2ce8f4392f64c67cc'],
  ['webapp/src/features/albums/model.ts', 'db14f185e628d83fc4ebbe05fa4b08b3dca446e4'],
  ['webapp/src/features/composer/PhotoComposer.tsx', '1bba733803603e99bba84e80e6d89c0d60ee8470'],
  ['webapp/src/features/feed/FeedPage.tsx', '5afb5b3b9280ca572f925eee76bc0f176d36dfcf'],
  ['webapp/src/features/memoly-ui/AddSheetPresentation.tsx', '7187fbcdd05fa4f9e9ac46db7104d215fd301d06'],
  ['webapp/src/platform/app-zoom.ts', 'c1bb21a6cb8bd072f779b662b5a5c628ccbb3af9'],
]
const reviewedWishlistProductionBlobs = [
  ['backend/prisma/migrations/20261023120000_gift_wishlist/migration.sql', 'bd538f14b50266bff3ad939243ef974cbf2b6291'],
  ['backend/prisma/migrations/20261024120000_gift_photo_recovery_guard/migration.sql', '01fbd39bed168dd7082c1eb3ce2a940e57c01f06'],
  ['backend/prisma/schema.prisma', 'ea0ed15d90ba5c8a79b1b42d2ef6fa04ce34fcbe'],
  ['backend/src/app.ts', '2793eab07c2131cae8d29f1b55a79e4ac8ad5033'],
  ['backend/src/jobs.ts', '27ed3eec8a245dd81dbf99cc49ec83bb0bd0c504'],
  ['backend/src/modules/families/application/family-service.ts', 'cde35b90bb7991e3d3b65df9cc009db766163490'],
  ['backend/src/modules/gifts/application/gift-service.ts', '699500bcea287cf31f0f9068141f912f51b69c60'],
  ['backend/src/modules/gifts/application/ports.ts', '9678165d143337e24f0423f1a80755f2ec1d3631'],
  ['backend/src/modules/gifts/domain/errors.ts', '02a51793e602c362cf4fe9b27d4b5caddec0e60b'],
  ['backend/src/modules/gifts/domain/gift-rules.ts', 'd85cab7d9c1d78c6db9afaf6c817b72fe8d57ae5'],
  ['backend/src/modules/gifts/index.ts', '3592984c1b5e549afb9a726f50428bc3fe7c2566'],
  ['backend/src/modules/gifts/infrastructure/prisma-gift-repository.ts', '964d78b903c82bf4eca5f8331f88e297a60af21e'],
  ['backend/src/modules/gifts/transport/errors.ts', 'a15d325062fc30c553b49908e7ba5c1a7c5c3def'],
  ['backend/src/modules/gifts/transport/routes.ts', '44500ad2258b02166bd90aa871c7289ab9267d8a'],
  ['backend/src/modules/media/application/media-service.ts', '4a4199888c7976e26810c130335018c6f2138653'],
  ['backend/src/modules/media/application/ports.ts', '5132bf16679ff17f2e59e11322d4d1955e4b1e2e'],
  ['backend/src/modules/media/infrastructure/prisma-media-repository.ts', 'aa7e102090c686dc003229b49be090c14fa7f2f8'],
  ['packages/contracts/src/gifts.ts', 'bef4a5c1452d9678d13a3f2f954c5e1ba8755c6a'],
  ['packages/contracts/src/index.ts', '6a42045b46a434c5f95d550e8e5b38c863bb2fc3'],
  ['packages/contracts/src/media.ts', '92c4a169515dea3d7dda0e387c74c1a7fae82190'],
  ['webapp/public/assets/icons/gift-active@2x.webp', 'c94e7206795e8573761052f232052b2cacef1278'],
  ['webapp/public/assets/icons/gift-active@3x.webp', 'c020942a472fb60660dffe96fda87a47ce49d239'],
  ['webapp/public/assets/icons/gift-default@2x.webp', '2072d352de34e4f6b2b2d22edf068d237103d877'],
  ['webapp/public/assets/icons/gift-default@3x.webp', '8720943beeb474ffdd7481d805a8c799fcee627c'],
  ['webapp/public/assets/icons/gift-white@2x.webp', '73377ba98f5acbc93e78ce902bbf5221f04acb0c'],
  ['webapp/public/assets/icons/gift-white@3x.webp', '6c7edaf9894f477889d2db26abb30df25cddc3e2'],
  ['webapp/src/App.tsx', 'adb48eecf2ac766005f6d4672152bf4c5281556e'],
  ['webapp/src/components/BottomNavigation.tsx', '88d36149b66d86116d3f22e8d1ae66508e7b0185'],
  ['webapp/src/components/MemolyBottomSheet.tsx', '70c895652fd20465797adde164789d2ac1405993'],
  ['webapp/src/components/ui-v2/shared-skin.css', 'deb25ae9424cdc3ec3b8d7a9a7cc62cbc997d84c'],
  ['webapp/src/components/webp-icon-types.ts', 'aee2f4c65431ba7b6a6e1492db1027430440bc52'],
  ['webapp/src/features/albums/AlbumsPage.tsx', 'ab83274d4395749b65639a6b5b9ecb7b724b5a88'],
  ['webapp/src/features/composer/index.ts', '910428c9617fc8aa5a79f9faa6e4002caf4efcfb'],
  ['webapp/src/features/family/FamilyScreen.tsx', '40d127c38d3d476b1ca59f68bb35b660614806cd'],
  ['webapp/src/features/family/api.ts', '5491a286b234e36d8f2501acf984e01c87143f00'],
  ['webapp/src/features/feed/FeedPage.tsx', '5a8f552ea85f3021c4d9871c1974c75eff0cb881'],
  ['webapp/src/features/feed/components/FeedShell.tsx', '35db262c02c906dc5d7f64b07a1ca171fff1950b'],
  ['webapp/src/features/feed/presentation/FeedPresentation.tsx', '090f9758e2f20661031ea8f4abab9fb24d455842'],
  ['webapp/src/features/gifts/GiftCard.tsx', 'ccbaaf29fa79dba4b0fdacebe54f813411df4300'],
  ['webapp/src/features/gifts/GiftForm.tsx', '472d45785fa8a9121933bec75bf30ccb802205f5'],
  ['webapp/src/features/gifts/GiftsPage.tsx', '9b0df56a7822140676e5bb0f17f0e49345053a4c'],
  ['webapp/src/features/gifts/api.ts', '4c61f1d2d0a9bd2f148d0af7719221f36dc42b07'],
  ['webapp/src/features/gifts/gifts.css', 'bc0a014dc870e862e22ece8074f1f4a336119d73'],
  ['webapp/src/features/gifts/index.ts', 'c72f0cd25a7dc997dd046e38d7edf0cc6deac8d9'],
  ['webapp/src/features/gifts/model.ts', 'cb2b048aec4d76b37ae90885577eb7b12417be65'],
  ['webapp/src/features/gifts/queries.ts', '4ff5a8ea221db8ba81e289352ae7664df50f6eec'],
  ['webapp/src/platform/external-link.ts', '91f8e1578be0ddb0b1b14d2a5fb57c7d367f58fa'],
  ['webapp/src/platform/host-bridge.ts', '4fc26ca7eb1168589f0089d0c915b075a446e3f0'],
  ['webapp/src/platform/max/host-bridge.ts', '5c96df647667e5af9ec74cd49980682268dc5664'],
  ['webapp/src/platform/persistence/private-cache.ts', 'bba2bf1b469b2cec0831212a0daa2ef1891129d9'],
  ['webapp/src/platform/telegram/host-bridge.ts', '9e31299f82c80ed24aaab51a7db42278a9c94089'],
  ['webapp/src/styles/tokens.css', '717b7fbfabd767a0b7282ca6712ef30acac3dbe0'],
]
const reviewedChildrenProductionBlobs = [
  ["backend/prisma/migrations/20261024100000_memory_child_tags/migration.sql", "dec80953c8d7b8b2e059f776693abd2ece52264b"],
  ["backend/prisma/schema.prisma", "243e44d0eaa21b2fa8f3a80982a4858efaca105c"],
  ["backend/src/bot-family-target.ts", "1e4aef273f1c76fa45bb54fb31b7de0333bd1a86"],
  ["backend/src/modules/albums/application/album-repository.ts", "a3b990d4c2163f3f56dcfbcb726f7819dd9a12e9"],
  ["backend/src/modules/albums/application/album-service.ts", "ef86488789fc5f6f837bdebdf889f252b4c0f245"],
  ["backend/src/modules/albums/infrastructure/prisma-album-repository.ts", "67765c6e0e951b3d91dd1bed2610d404895bdb35"],
  ["backend/src/modules/families/application/family-service.ts", "bb5edd09a8ac17a92dfd52b4800c1013a3a50ff4"],
  ["backend/src/modules/families/transport/routes.ts", "020836c3cfdd0ae855a731cdb93f16233b1818c9"],
  ["backend/src/modules/gifts/infrastructure/prisma-gift-repository.ts", "2ba35cd13993f18c063d98ba191b9f646186043f"],
  ["backend/src/modules/max/application/direct-video-upload.ts", "f8d6239702fc6d2c0a958167637bd0bf782459cf"],
  ["backend/src/modules/max/application/ports.ts", "4a0dadafd65a337e5ae9e7892575958d81f9cce4"],
  ["backend/src/modules/max/infrastructure/prisma-max-direct-upload-repository.ts", "874f73b3617e4ba7759bc65d432c9c6d6aecc226"],
  ["backend/src/modules/max/infrastructure/process-image.ts", "72654d2a3224ee10b0bcf018f7c1f890483c525f"],
  ["backend/src/modules/max/infrastructure/process-task.ts", "63ba3f103f280d1cb6693bff16119d14a755f32c"],
  ["backend/src/modules/max/infrastructure/process-video.ts", "943d78e6e9583c6b21d7ed53c8946b784e8a23b9"],
  ["backend/src/modules/max/infrastructure/process-voice.ts", "1c9933b8f412b0161d1622c55d1b58ef3796bf7c"],
  ["backend/src/modules/max/infrastructure/source-target.ts", "bed4b277b239f6c004ac3e963b3abaa98ef566a0"],
  ["backend/src/modules/max/transport/direct-video-upload-routes.ts", "05356766bd2cdae61695972bdaf1f7e6d5a0a1d3"],
  ["backend/src/modules/memories/application/memory-service.ts", "ea8fce2106513b4ee0290a673e1caa56bc0ff63e"],
  ["backend/src/modules/memories/application/ports.ts", "da65c7682dc0639cf4d9a25a66d0e8da48559195"],
  ["backend/src/modules/memories/domain/memory-cursor.ts", "fb0040779ce68c8138175323100a80c15b8720cd"],
  ["backend/src/modules/memories/infrastructure/child-tags.ts", "ed42cb2532d25d0a294161d67e133d4d2efcf851"],
  ["backend/src/modules/memories/infrastructure/prisma-memory-repository.ts", "263fa4dc0be5cfee246462f4e594d67ae937c894"],
  ["backend/src/modules/memories/infrastructure/source-memory-publisher.ts", "2e65ce49640b132307800f866720b37a8a859de4"],
  ["backend/src/modules/memories/transport/routes.ts", "aea3cd93a325d3a336b9f96ecb9207fd52658175"],
  ["backend/src/storage/config.ts", "084a5524361a97d92aa6e919e08d589cbe9e744d"],
  ["packages/contracts/src/albums.ts", "c4adfcafd433691c7b788285d0410b7fce78fac9"],
  ["packages/contracts/src/children.ts", "5fdcb651c34420f116e861bbfa69c15711a470a4"],
  ["packages/contracts/src/families.ts", "9d483ea47fd51ac49db9d3a638d7efdf117ce9cd"],
  ["packages/contracts/src/index.ts", "6b26f609a2b262ddbf0ae4abd67a83e68900decc"],
  ["packages/contracts/src/memories.ts", "58e54611a4cdfb6080e6b12bff2d6aaa02893737"],
  ["webapp/src/App.tsx", "81c84fd5ad545b7175c78b0d90138b54dd1e666f"],
  ["webapp/src/components/ui-v2/ChildTagPicker.css", "fe82d72c77980969888a085536af68a1bda1c592"],
  ["webapp/src/components/ui-v2/ChildTagPicker.tsx", "0125e27316ba18d0318da78fc111d585749cac36"],
  ["webapp/src/components/ui-v2/FamilyHeaderV2.css", "541f890fe0b9fccd57e86c75687363fb950e5ecf"],
  ["webapp/src/components/ui-v2/FamilyHeaderV2.tsx", "1474e778b72823113ff4c06572e9b88e544d5b0c"],
  ["webapp/src/components/ui-v2/child-count.ts", "e5682ed49adb617cbbbdbb152ca0801ce397b27c"],
  ["webapp/src/components/ui-v2/child-tags.ts", "b805b9e88a0828c61b1b77a40d3251e0d94c5dc7"],
  ["webapp/src/features/albums/AlbumForms.tsx", "60ffdc377c12c2ffbe863081b0e57460454ec4a9"],
  ["webapp/src/features/albums/AlbumsPage.tsx", "5e1feb67eb9b72a79344b56f55aefe71fb9fd6ef"],
  ["webapp/src/features/albums/ComposerHost.tsx", "8a4ff3bff973cb2b4a8c41198f6641756a0f8f63"],
  ["webapp/src/features/albums/albums.css", "f1df0ce02eecb6389ed28fe4fe73b24262f834aa"],
  ["webapp/src/features/albums/child-groups.ts", "7c66110fca705174e208fa58137018ef70362e0b"],
  ["webapp/src/features/composer/ComposerForm.tsx", "dd5f76cb1922a1f04d1cc80a38a3cf7dbcb3247d"],
  ["webapp/src/features/composer/NoteComposer.tsx", "2c119fa86b370e4ecf1aa28959747f7460368359"],
  ["webapp/src/features/composer/PhotoComposer.tsx", "f44150dcd4d6c9b7d1953b4106787c100f26cebb"],
  ["webapp/src/features/composer/api.ts", "bc5dc8591e1cd3cc9b56e6196b936e33f0076f2e"],
  ["webapp/src/features/composer/index.ts", "4c6c334f09ff40d6c25184631449d9c6b7b696d1"],
  ["webapp/src/features/family/ChildAvatar.tsx", "0bc6fda3ece33dffc20c0d8fb43a9efca3d4ca72"],
  ["webapp/src/features/family/ChildProfile.css", "1d63b1d6e433673b94223be585755fad41f28ca0"],
  ["webapp/src/features/family/FamilyChildAvatar.tsx", "78289e492e88678d5da83b139f5f1a6231a5eff4"],
  ["webapp/src/features/family/FamilyOnboarding.tsx", "6d9eab41cb55e3909a5a76ae55e05839205ebf63"],
  ["webapp/src/features/family/FamilyScreen.tsx", "c85ffd8d9a617fd448f30c19514c7121520c5be8"],
  ["webapp/src/features/family/api.ts", "74aa7dea0d2c79194eb380c1606d200d1389f121"],
  ["webapp/src/features/family/index.ts", "0b457c8bb21e0da01adc6d4857aa832cff43b28a"],
  ["webapp/src/features/family/model.ts", "aaa46248a2aa437443add224c6b4eec7fadd851b"],
  ["webapp/src/features/feed/ChildAlbumsStrip.tsx", "640daa15417bdd3ecc61694e45e9ffe19e24de2b"],
  ["webapp/src/features/feed/FeedPage.tsx", "8b3cc3f47351b57a3c7f746155900562c7b668af"],
  ["webapp/src/features/feed/MemoryChildTagsEditor.tsx", "0b4a0d69b68d86cf77c5a2f3564aa3a7cdce6e38"],
  ["webapp/src/features/feed/api.ts", "cfbaeb3ddff98064ae6f244c80deec7f9200146c"],
  ["webapp/src/features/feed/child-albums.ts", "2969f4b3eac0e0fe2eed2e2f3c6287fcd8c1ad9c"],
  ["webapp/src/features/feed/child-filter.ts", "3c367b3bb45b07ebd9c000e60a5b5f34c1980909"],
  ["webapp/src/features/feed/child-tag-editor.css", "2c561f94017797bb15994f6e04d05245b65acb5c"],
  ["webapp/src/features/feed/child-tag-editor.ts", "c1c78c4bc1b71d25970b65a5e1a50939cf8fb491"],
  ["webapp/src/features/feed/components/ChildFilterChips.tsx", "b111c64b1c5480b68d4a73c70e2ba169ba56eade"],
  ["webapp/src/features/feed/components/index.ts", "be71e51c0088d6364c05afc46f30a28fdd62606a"],
  ["webapp/src/features/feed/index.ts", "2cb323d09c9337a5c662a9cf73e8a04457ceb812"],
  ["webapp/src/features/feed/presentation/FeedPresentation.tsx", "538ccc0fbd443ca3584e5a3739fbcec17c3163ec"],
  ["webapp/src/features/feed/presentation/child-pages.css", "0c2e390ea2d864bc63ac1d15e635124f344abe64"],
  ["webapp/src/features/feed/queries.ts", "3e16b480483bef0e066eadc64ed8c7189ec25b21"],
  ["webapp/src/features/max-video-upload/VideoComposer.tsx", "af08c194484e2d525fa443fe8cb32eb36cacb7dd"],
  ["webapp/src/features/max-video-upload/api.ts", "c767ab2a71bec6ea0db2231019d9c337936d9a2c"],
  ["webapp/src/features/memoly-ui/FamilyChildrenSection.tsx", "5f97bb05c577d03cb9709794a27a5260445bd529"],
  ["webapp/src/features/memoly-ui/FamilyPresentation.tsx", "ee4ac1d5b4ac68097a1da21188621c5f0253601f"],
  ["webapp/src/features/memoly-ui/family-management.css", "75971390da6b023d234ddb1fe5bf32f3405624cf"],
  ["webapp/src/platform/persistence/private-cache.ts", "4d0d3a7bc80e28e94c5d57e70bbf7d06cfe6f84f"],
]
const reviewedGiftUrlProductionBlobs = [
  ['backend/package.json', 'fa5532cf516c37784cb39fe6add9c49ec51c5a91'],
  ['backend/src/app.ts', 'a040659f173d212b3b4a7a302bec3c9d71231195'],
  ['backend/src/modules/gifts/application/gift-service.ts', 'ca2258fd76ecbf22bb3c5d197532402f1f7a346a'],
  ['backend/src/modules/gifts/application/ports.ts', '749489c5195fa84bef30d71e6759db6f9468cd2b'],
  ['backend/src/modules/gifts/index.ts', '03454d9e69bff878ed47d993b33afb701da097dd'],
  ['backend/src/modules/gifts/infrastructure/gift-metadata.ts', 'e9f89be56a858b511ee4f654aed3120f77d743a9'],
  ['backend/src/modules/gifts/transport/routes.ts', 'c5c2125617e143369ebbb7cc7257d85687275389'],
  ['bun.lock', '9667dc24e5aa1a711ddb7ad27ad377565a26802a'],
  ['packages/contracts/src/gifts.ts', 'a8d39239af8aef964bd03c494929d46d38d8fc0f'],
  ['webapp/src/features/gifts/GiftForm.tsx', '39e2f6b6cc3310f033954a6d439316122f68745c'],
  ['webapp/src/features/gifts/api.ts', '25beaa70cf86a9b67d86b5fbbbe7031de87dc766'],
  ['webapp/src/features/gifts/model.ts', '514aa6a16e2f388da6e796385623de5b9f38fb15'],
]
const reviewedFamilyNavigationBlobs = [
  ['webapp/src/components/ui-v2/ChildHeaderV2.tsx', 'ffd55a9be7dee111148a48a6f7336e88c89ad387'],
  ['webapp/src/components/ui-v2/ChildHeaderV2.css', 'd648a7ad8ca15553f78e3adca5a5ac08c2d641ff'],
  ['webapp/src/features/family/FamilyHubPage.tsx', 'ad70bd6401f76123dc052c638e919aef1e4b3e90'],
  ['webapp/src/features/family/family-hub.css', '50f6ccb272456209bd44fd48d7ba6f383980c7f0'],
]
const reviewedSharedHeaderChildAvatarBlobs = [
  ['webapp/src/App.tsx', '5cbce19d0bb8120fff799019475edff3263b009c'],
  ['webapp/src/components/ChildHeader.tsx', '1f7078cbc38204f7ba296711a5f1d3661cbe83d5'],
  ['webapp/src/components/ui-v2/ChildHeaderV2.css', '1161cc95a5c003d89d8ed432aac8a7c85c7735be'],
  ['webapp/src/components/ui-v2/ChildHeaderV2.tsx', '4e88167ccdfe0c85e1807c52f265df2d6e17bf5f'],
  ['webapp/src/features/family/ChildAvatar.tsx', '88275705aac27eed5b052af2a80bd26693a72f90'],
  ['webapp/src/features/family/FamilyHubPage.tsx', '0f5d771a42141fee67846a1983a747f63b6aa875'],
  ['webapp/src/features/family/FamilyScreen.tsx', 'f54acce9477ba0426b8f7e266e88cfcbc99ba70c'],
  ['webapp/src/features/family/useChildAvatar.ts', '23b230a2d1c148b2ac1a90fa2a69404225f606a1'],
  ['webapp/src/features/feed/FeedPage.tsx', '83554b1a019d7d94f3c933eadeb6b5b489e35a8a'],
  ['webapp/src/features/feed/presentation/FeedPresentation.tsx', '87794042c2afceebe7c4fa90027e26d55a7bef70'],
  ['webapp/src/features/feed/presentation/memoly-feed.css', '982ba5c6ca0d4bd7ee6935ad0dd09117a752c4ea'],
  ['webapp/src/features/memoly-ui/FamilyPresentation.tsx', '86528665625ae140ed84652a3db73b3baad60b11'],
  ['webapp/src/platform/media/use-private-image-url.ts', 'da84fe42067ff0f463b132fae5a509d88083a120'],
]
const reviewedSingleAvatarSourceBlobs = [
  ['webapp/src/App.tsx', 'b8c1b8a75e66b735a49221ba7dc693e3a0efd3e8'],
  ['webapp/src/features/family/ChildAvatar.tsx', '4ddf89fa7226a3a3ea000eceaa798e978361edf8'],
  ['webapp/src/features/family/FamilyHubPage.tsx', '40964e4dfeaae1b7a5215fe3c55bdb2394332f73'],
  ['webapp/src/features/family/useChildAvatar.ts', 'f2c3a017ed01ee2117493c2412edea0a219d0a6b'],
  ['webapp/src/features/feed/FeedPage.tsx', '086f8ad4784b975830a4f581598edb3f15c987bc'],
  ['webapp/src/features/feed/presentation/MemoryCardPresentation.tsx', '146bef666016a7faf311bed861db798cf77af046'],
  ['webapp/src/features/feed/presentation/memoly-feed.css', '7d8d5b43278b26c23fabb07a2704d01d614d13b5'],
  ['bun.lock', '64112c805296ec42b124d3c11f1cdc3e73228a60'],
  ['webapp/src/platform/media/avatar-resource-pool.ts', '2e04a01ba8ead3c4e5e2c3985e654226f4b5243f'],
  ['webapp/src/platform/media/use-private-image-url.ts', '73a376f7d919dbad664eec30ddfa903fe8b0313b'],
  ['webapp/src/platform/persistence/private-cache.ts', '302b1f5a95b8ad092b255a936959e5d6e324180c'],
]
const reviewedWelcomeCta6Blobs = [
  ['bun.lock', '1e6ca895f4498c94b59ae1b4e9e97d5a99a59409'],
  ['webapp/package.json', '1202c550eaa3a6cbd90fbd9f5a9c4b30080cec8a'],
  ['webapp/public/assets/fonts/Comfortaa-OFL.txt', '1ecc8c6edc4c6624e40b073ea17d177a5641b9e3'],
  ['webapp/src/features/welcome/WelcomeSplash.tsx', '60388d4b83e4b4fd46e9c82f7213a43ae2fa0a0d'],
  ['webapp/src/features/welcome/welcome-splash.css', '18174a67d1aad32d10c509a93e576ccbfadf3936'],
]
const reviewedWelcomeOnceZoomBlobs = [
  ['webapp/src/features/feed/FeedPage.tsx', 'bc57fe068a43611efa80cc7fe5ffd29b3f3e6604'],
  ['webapp/src/features/feed/presentation/memoly-feed.css', 'fee8d9ded865635455fe684c112f513134a6ca13'],
  ['webapp/src/App.tsx', '648381db4d7aa5488a019254cf42d3cb436dbe1b'],
  ['webapp/src/index.css', '8d088751c71a08c43252f31fb1990db124657147'],
  ['webapp/src/main.tsx', '5468ed089f85d2f243e2a893264f104d199687b3'],
  ['webapp/src/platform/app-zoom.ts', '4561b0c501136d38473905497643247ab688bb03'],
]
const reviewedMemberAvatarProductionBlobs = [
  ['webapp/src/App.tsx', '3d6918955368efb06348bd7ff324bfd365e7f15d'],
  ['webapp/src/features/avatar/index.ts', 'a60d1edb610a7b889085c6bd3f6823814e5a6ce9'],
  ['webapp/src/features/avatar/member-avatar-directory-context.ts', '92efe6e33ae5d364a3708b5f18bc64fa1db75073'],
  ['webapp/src/features/avatar/member-avatar-directory-query.ts', '03e0b7ebccbde17487070d467971ac4fd2689591'],
  ['webapp/src/features/avatar/member-avatar-directory.tsx', '8e6b374bca94b803133035a4bdaeee991325ef61'],
  ['webapp/src/features/avatar/member-avatar.tsx', 'ec69fcf879605b7a211aeedc41bce206095aa35d'],
  ['webapp/src/features/comments/CommentItem.tsx', '6b39b43930876b42e1c4cbf983d77b4962718ed7'],
  ['webapp/src/features/comments/CommentsPanel.tsx', 'ef42d54bb60f83ed92c3cd05ad90715a4d71cfae'],
  ['webapp/src/features/feed/FeedPage.tsx', 'dde42e52092ff5f885994f611ef772e3018042ce'],
  ['webapp/src/features/feed/presentation/MemoryCardPresentation.tsx', 'c9b2c93d8cb0e44230bed1c43d0c0064c2dd3e4f'],
  ['webapp/src/features/feed/shared-author-avatars.tsx', '5c54e771539f2cdbdcdc6f086f33b1c87f9985be'],
  ['webapp/src/features/memoly-ui/FamilyPresentation.tsx', '693d4f584c13a0db66a3d64f023781b2bc65118c'],
  ['webapp/src/features/memoly-ui/MemberProfile.tsx', 'fc9fde2931149b48925d3a76cb9551773d262d90'],
  ['webapp/src/platform/persistence/private-cache.ts', 'db62855b99016fd50b0070a76c54064699e5e6fa'],
]
const reviewedFamilyInviteEntryProductionBlobs = [
  ['backend/src/modules/families/application/family-service.ts', 'a53db0d019c693609423ee4ebf09254c4e34ddc4'],
  ['backend/src/modules/max/infrastructure/deliver-response.ts', '9ee442ba871a91fd905c962fa599d1971ecbced5'],
  ['webapp/src/App.tsx', '32f0b69fd500725d8a0a730339e2459f792b5eac'],
  ['webapp/src/platform/host-bridge.ts', '10e0e6c1d8ce4e3c8bc9adf17d6c0d372ddfd3f5'],
  ['webapp/src/platform/max/host-bridge.ts', '26b0ed32b383b5b760c0c91912080f2823ac7db4'],
]
const fixtureWorktrees = []
const fixtureSourceCache = new Map()

function currentGitHead() {
  const result = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' })
  assert.equal(result.status, 0, result.stderr)
  return result.stdout.trim()
}

function productionRuntimeFingerprint(cwd, revision = 'HEAD') {
  const result = spawnSync(bashExecutable, ['-s'], {
    cwd: root,
    input: `${redeployDefinitions}\nAPP_ROOT=${shellQuote(cwd)}\nrollback_runtime_fingerprint ${revision}\n`,
    encoding: 'utf8',
  })
  if (result.status !== 0) throw new Error(result.stdout + result.stderr)
  return result.stdout.trim().split('\n').at(-1)
}

function productionCompatibilityFingerprint(cwd) {
  const result = spawnSync(bashExecutable, ['-s'], {
    cwd: root,
    input: `${redeployDefinitions}\nAPP_ROOT=${shellQuote(cwd)}\nrollback_compatibility_fingerprint HEAD\n`,
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
	if (role === 'candidate') role = 'comments'
	if (fixtureSourceCache.has(role)) return fixtureSourceCache.get(role)
	if (role === 'albums') {
	  const anchor = 'dc26ad9bb5ebcfe64643414fad90d53fcb3b1c92'
	  const anchorRuntime = '2be6fc2b96f4731c4ea3821b50f112c01d8e9a62da57eeb6675f8513fd26b088'
	  const expectedCompatibility = '5ba8daeb5a1d8a3f538f9f24adff103f440afbd7de9fbe0e5b1eee1d772bd8b1'
	  assert.equal(productionRuntimeFingerprint(root, anchor), anchorRuntime)
	  mkdirSync(resolve(root, '.scratch'), { recursive: true })
	  const directory = mkdtempSync(resolve(root, '.scratch', 'rollback-albums-worktree-'))
	  const added = spawnSync('git', ['worktree', 'add', '--detach', directory, anchor], { cwd: root, encoding: 'utf8' })
	  if (added.status !== 0) throw new Error(added.stdout + added.stderr)
	  fixtureWorktrees.push(directory)
	  const source = commitFrozenSourceFiles({ root: directory, sha: anchor }, reviewedAlbumsProductionBlobs,
	    'freeze reviewed album runtime production blobs')
	  assert.equal(productionCompatibilityFingerprint(source.root), expectedCompatibility)
	  assert.equal(productionRuntimeFingerprint(source.root, anchor), anchorRuntime)
	  fixtureSourceCache.set(role, source)
	  return source
	}
	if (role === 'privatePhotos') {
	  const anchor = 'dc26ad9bb5ebcfe64643414fad90d53fcb3b1c92'
	  const anchorRuntime = '2be6fc2b96f4731c4ea3821b50f112c01d8e9a62da57eeb6675f8513fd26b088'
	  const expectedCompatibility = 'f4b2ef2d6df8ab0135c24102d56b7facbed4fc09eaf467eb93fef6b55781749f'
	  assert.equal(productionRuntimeFingerprint(root, anchor), anchorRuntime)
	  mkdirSync(resolve(root, '.scratch'), { recursive: true })
	  const directory = mkdtempSync(resolve(root, '.scratch', 'rollback-private-photos-worktree-'))
	  const added = spawnSync('git', ['worktree', 'add', '--detach', directory, anchor], { cwd: root, encoding: 'utf8' })
	  if (added.status !== 0) throw new Error(added.stdout + added.stderr)
	  fixtureWorktrees.push(directory)
	  const source = commitFrozenSourceFiles({ root: directory, sha: anchor },
	    [...reviewedAlbumsProductionBlobs, ...reviewedPrivatePhotoProductionBlobs],
	    'freeze reviewed private-photo runtime production blobs')
	  assert.equal(productionCompatibilityFingerprint(source.root), expectedCompatibility)
	  assert.equal(productionRuntimeFingerprint(source.root, anchor), anchorRuntime)
	  fixtureSourceCache.set(role, source)
	  return source
	}
  const expected = runtimeFingerprints[role]
  const fallback = role === 'selectel' ? '91f48719309e20456b1659092a1bf209c3aa3653'
    : role === 'comux' ? rollbackHealthy
      : role === 'feedPhoto' ? 'dc3201096998f366a88a296d13914abf6047604b'
        : role === 'diagnostic' ? 'dc26ad9bb5ebcfe64643414fad90d53fcb3b1c92'
          : role === 'comments' ? 'a353f01a8354e42f71473b1917f99c9a97181680' : rollback180
  assert.equal(productionRuntimeFingerprint(root, fallback), expected, `${role} fallback source has the wrong runtime fingerprint`)
  mkdirSync(resolve(root, '.scratch'), { recursive: true })
  const directory = mkdtempSync(resolve(root, '.scratch', `rollback-${role}-worktree-`))
  const added = spawnSync('git', ['worktree', 'add', '--detach', directory, fallback], { cwd: root, encoding: 'utf8' })
  if (added.status !== 0) throw new Error(added.stdout + added.stderr)
  fixtureWorktrees.push(directory)
  const head = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: directory, encoding: 'utf8' }).stdout.trim()
  assert.equal(head, fallback)
  assert.equal(spawnSync('git', ['status', '--porcelain'], { cwd: directory, encoding: 'utf8' }).stdout.trim(), '')
  assert.equal(productionRuntimeFingerprint(directory, head), expected)
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

function commitSourceFile(source, relativePath, contents, message) {
  writeFileSync(resolve(source.root, relativePath), contents)
  const env = { ...process.env, GIT_AUTHOR_NAME: 'Rollback Test', GIT_AUTHOR_EMAIL: 'rollback-test@example.invalid',
    GIT_COMMITTER_NAME: 'Rollback Test', GIT_COMMITTER_EMAIL: 'rollback-test@example.invalid' }
  const add = spawnSync('git', ['add', '--', relativePath], { cwd: source.root, env, encoding: 'utf8' })
  if (add.status !== 0) throw new Error(add.stdout + add.stderr)
  const commit = spawnSync('git', ['-c', 'user.name=Rollback Test', '-c', 'user.email=rollback-test@example.invalid',
    'commit', '--quiet', '-m', message, '--', relativePath], { cwd: source.root, env, encoding: 'utf8' })
  if (commit.status !== 0) throw new Error(commit.stdout + commit.stderr)
  const sha = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: source.root, encoding: 'utf8' }).stdout.trim()
  assert.equal(spawnSync('git', ['status', '--porcelain'], { cwd: source.root, encoding: 'utf8' }).stdout.trim(), '')
  return { ...source, sha }
}

function commitFrozenSourceFiles(source, files, message) {
  const paths = []
  for (const [relativePath, blob] of files) {
    mkdirSync(dirname(resolve(source.root, relativePath)), { recursive: true })
    writeFileSync(resolve(source.root, relativePath), frozenGitBlobBytes(blob, relativePath))
    paths.push(relativePath)
  }
  const env = { ...process.env, GIT_AUTHOR_NAME: 'Rollback Test', GIT_AUTHOR_EMAIL: 'rollback-test@example.invalid',
    GIT_COMMITTER_NAME: 'Rollback Test', GIT_COMMITTER_EMAIL: 'rollback-test@example.invalid' }
  const add = spawnSync('git', ['add', '--', ...paths], { cwd: source.root, env, encoding: 'utf8' })
  if (add.status !== 0) throw new Error(add.stdout + add.stderr)
  const commit = spawnSync('git', ['-c', 'user.name=Rollback Test', '-c', 'user.email=rollback-test@example.invalid',
    'commit', '--quiet', '-m', message], { cwd: source.root, env, encoding: 'utf8' })
  if (commit.status !== 0) throw new Error(commit.stdout + commit.stderr)
  const sha = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: source.root, encoding: 'utf8' }).stdout.trim()
  assert.equal(spawnSync('git', ['status', '--porcelain'], { cwd: source.root, encoding: 'utf8' }).stdout.trim(), '')
  return { ...source, sha }
}

function commitFrozenSourceFilesFromHead(source, files, message) {
  const paths = []
  for (const [relativePath, expectedBlob] of files) {
    const result = spawnSync('git', ['show', `HEAD:${relativePath}`], { cwd: root, encoding: null })
    if (result.status !== 0) throw new Error(`frozen source ${relativePath} is unavailable: ${result.stderr.toString('utf8')}`)
    const actualBlob = spawnSync('git', ['hash-object', '--stdin'], { cwd: root, input: result.stdout, encoding: 'utf8' })
    if (actualBlob.status !== 0) throw new Error(`cannot hash frozen source ${relativePath}: ${actualBlob.stderr}`)
    assert.equal(actualBlob.stdout.trim(), expectedBlob, `HEAD no longer contains the reviewed frozen blob for ${relativePath}`)
    mkdirSync(dirname(resolve(source.root, relativePath)), { recursive: true })
    writeFileSync(resolve(source.root, relativePath), result.stdout)
    paths.push(relativePath)
  }
  const env = { ...process.env, GIT_AUTHOR_NAME: 'Rollback Test', GIT_AUTHOR_EMAIL: 'rollback-test@example.invalid',
    GIT_COMMITTER_NAME: 'Rollback Test', GIT_COMMITTER_EMAIL: 'rollback-test@example.invalid' }
  const add = spawnSync('git', ['add', '--', ...paths], { cwd: source.root, env, encoding: 'utf8' })
  if (add.status !== 0) throw new Error(add.stdout + add.stderr)
  const commit = spawnSync('git', ['-c', 'user.name=Rollback Test', '-c', 'user.email=rollback-test@example.invalid',
    'commit', '--quiet', '-m', message], { cwd: source.root, env, encoding: 'utf8' })
  if (commit.status !== 0) throw new Error(commit.stdout + commit.stderr)
  const sha = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: source.root, encoding: 'utf8' }).stdout.trim()
  assert.equal(spawnSync('git', ['status', '--porcelain'], { cwd: source.root, encoding: 'utf8' }).stdout.trim(), '')
  return { ...source, sha }
}

function frozenGitBlob(hash, description) {
  const result = spawnSync('git', ['cat-file', 'blob', hash], { cwd: root, encoding: 'utf8' })
  if (result.status !== 0) throw new Error(`frozen ${description} fixture is unavailable: ${result.stderr}`)
  return result.stdout
}

function frozenGitBlobBytes(hash, description) {
  const result = spawnSync('git', ['cat-file', 'blob', hash], { cwd: root })
  if (result.status !== 0) throw new Error(`frozen ${description} fixture is unavailable: ${result.stderr.toString('utf8')}`)
  return result.stdout
}

const frozenAvatarTimerFixSource = () => frozenGitBlob(reviewedAvatarTimerFixBlob, 'avatar timer')
const frozenStorybookManifest = () => frozenGitBlob(reviewedStorybookManifestBlob, 'Storybook manifest')
const frozenStorybookLock = () => frozenGitBlob(reviewedStorybookLockBlob, 'Storybook lockfile')

afterAll(() => {
  for (const directory of fixtureWorktrees.reverse()) {
    const result = spawnSync('git', ['worktree', 'remove', directory], { cwd: root, encoding: 'utf8' })
    if (result.status !== 0) throw new Error(result.stdout + result.stderr)
  }
}, { timeout: 60_000 })
const redeployDefinitions = `. ${shellQuote(resolve(root, 'deploy/selectel/redeploy.sh'))}`

function runApplicationRollback(options = {}) {
  mkdirSync(resolve(root, '.scratch'), { recursive: true })
  const fixture = mkdtempSync(resolve(root, '.scratch/rollback-guard-'))
  const server = resolve(fixture, 'server')
  const backup = resolve(server, 'backups/compose.pre-selectel-fixture')
  mkdirSync(backup, { recursive: true })
  chmodSync(resolve(server, 'backups'), 0o700)
  mkdirSync(resolve(server, 'gateway'))
  for (const [name, content] of [['compose.yml', 'services: {}\n'], ['Caddyfile', 'before\n'], ['Caddyfile.static', 'static\n']]) {
    writeFileSync(resolve(backup, name), content)
  }
  writeFileSync(resolve(server, '.selectel-config-backup'), gitBashPath(backup) + '\n', { mode: 0o600 })
  writeFileSync(resolve(server, 'gateway/Caddyfile'), 'before\n')
  writeFileSync(resolve(server, 'compose.yml'), 'services: {}\n')
  writeFileSync(resolve(server, 'rollback.env'), [
    'PREVIOUS_BACKEND_IMAGE_TAG=' + (options.target ?? rollbackBaseline),
    'PREVIOUS_WEBAPP_IMAGE_TAG=' + (options.webappTarget ?? rollbackBaseline),
    'MEMOLY_DB_ROLLBACK_ALLOWED=false', '',
  ].join('\n'), { mode: 0o600 })
  const source = options.sourceRootOverride
    ? { root: options.sourceRootOverride, sha: options.sourceShaOverride }
    : rollbackSource(options.source ?? 'legacy')
  const target = options.target ?? rollbackBaseline
  const candidatePair = target === rollback180
  const v4Pair = target === rollbackV4
  const healthyPair = target === rollbackHealthy
  const maxVideoPair = target === maxVideoRecoveryBackend && options.webappTarget === maxVideoRecoveryWebapp
  if (options.marker) writeFileSync(resolve(server, options.marker), 'unfinished\n')
  if (options.noBackup) rmSync(resolve(backup, 'compose.yml'))
  const backendTargetLabel = options.badLabel || options.badBackendLabel ? 'wrong' : target
  const webappTargetLabel = options.badLabel || options.badWebappLabel ? 'wrong' : (options.webappTarget ?? target)
  const events = resolve(fixture, 'events')
  const env = {
    SERVER_ROOT: server, APP_ROOT: source.root, BACKUPS_DIR: resolve(server, 'backups'), PRODUCT_SHA: source.sha, SCRIPT_DIR: resolve(root, 'deploy/selectel'),
    COMPOSE_FILE: resolve(server, 'compose.yml'), ROLLBACK_ENV: resolve(server, 'rollback.env'),
    CONFIG_BACKUP_MARKER: resolve(server, '.selectel-config-backup'),
    SERVER_EDGE_CADDYFILE: resolve(server, 'gateway/Caddyfile'), SERVER_STATIC_CADDYFILE: resolve(server, 'Caddyfile.static'),
    FORWARD_MARKER: resolve(server, 'b2.marker'), MM0_FORWARD_MARKER: resolve(server, 'mm0.marker'),
    MEMOLY_PRODUCT_SHA: options.producer ?? source.sha,
    SELECTEL_ALBUMS_LEDGER_PHASE: options.albumPhase ?? '',
    SELECTEL_CI_RELEASE: String(options.ciRelease ?? false),
    SELECTEL_DEPLOY_LOCK_FD: options.lockFd ?? '',
    FIXTURE_ALBUMS_LEDGER_PHASE: options.fixtureAlbumPhase ?? 'complete',
    RUNNING_BACKEND_IMAGE_TAG: options.runningBackend ?? rollbackBaseline,
    RUNNING_WEBAPP_IMAGE_TAG: options.runningWebapp ?? rollbackBaseline,
    RUN_MIGRATION: String(options.runMigration ?? false),
    MAX_BOT_TOKEN: '', MAX_WEBHOOK_SECRET: '', MAX_INBOX_ENCRYPTION_KEY: '',
    MEMOLY_PUBLIC_HOST: 'example.invalid', PUBLIC_URL: 'http://example.invalid',
    FIXTURE_EVENTS: events, FIXTURE_PENDING: String(options.pending ?? false),
    FIXTURE_STATE_ERROR: String(options.stateError ?? false),
    FIXTURE_UNREAD: String(options.unread ?? true), FIXTURE_MULTIPLE: String(options.multiple ?? true),
    FIXTURE_MIGRATION_HISTORY_MISMATCH: String(options.historyMismatch ?? false),
    FIXTURE_MIGRATION_HISTORY_ERROR: String(options.historyError ?? false),
    FIXTURE_BACKEND_ID: options.badImage ? 'sha256:' + 'f'.repeat(64) : (maxVideoPair ? maxVideoRecoveryBackendId : healthyPair ? healthyBackendId : v4Pair ? v4BackendId : candidatePair ? candidateBackendId : legacyBackendId),
    FIXTURE_WEBAPP_ID: options.badWebappImage ? 'sha256:' + 'e'.repeat(64) : maxVideoPair ? maxVideoRecoveryWebappId : healthyPair ? healthyWebappId : v4Pair ? v4WebappId : candidatePair ? candidateWebappId : legacyWebappId,
    FIXTURE_LABEL: backendTargetLabel, FIXTURE_BACKEND_LABEL: backendTargetLabel, FIXTURE_WEBAPP_LABEL: webappTargetLabel,
    FIXTURE_AUTH_RESPONSE: options.badAuthResponse ? '502' : '',
    FIXTURE_BACKEND_STOPPED: String(options.stoppedBackend ?? false),
    FIXTURE_PARENT_SECRET_FAILURE: String(options.parentSecretFailure ?? false),
    FIXTURE_RUNNING_BACKEND_TAG: options.runningBackend ?? (maxVideoPair ? maxVideoRecoveryBackend : rollbackBaseline),
    FIXTURE_PROMOTION_FAIL: String(options.promotionFail ?? false),
    ROLLBACK_AUTH_GATE: options.operatorGate ?? '',
  }
  const mocks = [
    'FIXTURE_TOP_BASHPID=$BASHPID',
    'stat() { case "$2" in %u) printf "0\\n" ;; %a) printf "600\\n" ;; %i) printf "1\\n" ;; *) return 2 ;; esac; }',
    'install() { local target=${!#}; if [ "$1" = -d ]; then mkdir -p "$target"; else : > "$target"; fi; }',
    'chmod() { :; }',
    `load_runtime_secrets() { if [ "$FIXTURE_PARENT_SECRET_FAILURE" = true ] && [ "$BASHPID" = "$FIXTURE_TOP_BASHPID" ]; then echo PARENT_SECRET_INIT_FAILED >> "$FIXTURE_EVENTS"; return 1; fi; export MAX_BOT_TOKEN=synthetic-test-token MAX_WEBHOOK_SECRET=synthetic-test-secret MAX_INBOX_ENCRYPTION_KEY=synthetic-test-key; ${options.trackRollbackOrder ? 'echo SECRET_INIT >> "$FIXTURE_EVENTS";' : ''} }`,
    'gateway_preflight() { :; }',
    'docker() {',
    ' case "$*" in',
    ' *"image inspect --format {{.Id}}"*memoly-backend*) echo "$FIXTURE_BACKEND_ID" ;;',
    ' *"image inspect --format {{.Id}}"*memoly-webapp*) echo "$FIXTURE_WEBAPP_ID" ;;',
    ' *"org.opencontainers.image.revision"*memoly-backend*) echo "$FIXTURE_BACKEND_LABEL" ;;',
    ' *"org.opencontainers.image.revision"*memoly-webapp*) echo "$FIXTURE_WEBAPP_LABEL" ;;',
    ' *"image inspect --format "*org.opencontainers.image.revision*) echo "$FIXTURE_LABEL" ;;',
    ' *"inspect --format {{.Config.Image}}|{{.Image}}"*) echo "memoly-backend:$FIXTURE_RUNNING_BACKEND_TAG|$FIXTURE_BACKEND_ID" ;;',
    ' *"service=backend"*) [ "$FIXTURE_BACKEND_STOPPED" = true ] || echo backend-container ;;',
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
    '     if [[ "$*" == *"MEMOLY_EXPECTED_BASELINE_MIGRATIONS="* ]]; then echo "ALBUM_HISTORY:${MEMOLY_ALBUMS_LEDGER_PHASE:-missing}" >> "$FIXTURE_EVENTS"; [ "$FIXTURE_MIGRATION_HISTORY_MISMATCH" = false ] && [ "$FIXTURE_MIGRATION_HISTORY_ERROR" = false ]; return; fi',
    '     if [[ "$*" == *"MEMOLY_EXPECTED_MIGRATION_CHECKSUMS="* ]]; then echo HISTORY_ATTESTATION:present >> "$FIXTURE_EVENTS"; else echo HISTORY_ATTESTATION:missing >> "$FIXTURE_EVENTS"; return 1; fi',
    '     [ "$FIXTURE_MIGRATION_HISTORY_MISMATCH" = false ] && [ "$FIXTURE_MIGRATION_HISTORY_ERROR" = false ]; return',
    '   fi',
    '   echo "STATE unread=$FIXTURE_UNREAD multiple=$FIXTURE_MULTIPLE" >> "$FIXTURE_EVENTS"',
    '   [ "$FIXTURE_STATE_ERROR" = false ]; return',
    ' fi',
    ' if [ "$1" = up ]; then echo "UP:$MEMOLY_BACKEND_IMAGE_TAG:$*" >> "$FIXTURE_EVENTS"; echo "PAIR:$MEMOLY_BACKEND_IMAGE_TAG:$MEMOLY_WEBAPP_IMAGE_TAG" >> "$FIXTURE_EVENTS"; [ "$FIXTURE_PROMOTION_FAIL" = false ];',
    ' elif [ "$1" = ps ]; then printf "backend\\nworker\\nscheduler\\nstatic\\n"; fi',
    '}',
    'activate_gateway() { cp "$EDGE_CANDIDATE" "$SERVER_EDGE_CADDYFILE"; echo GATE >> "$FIXTURE_EVENTS"; }',
    ...(options.maxVideoMocks ? [
      'rollback_control_installed_inputs_match() { :; }',
      'rollback_verify_max_video_migration_history() { echo present; }',
      'rollback_verify_max_video_recovery_readiness() { echo MAX_READINESS >> "$FIXTURE_EVENTS"; }',
      'rollback_apply_max_video_recovery() { [ -n "${MAX_BOT_TOKEN:-}" ] || { echo RECOVERY_SECRET_MISSING >> "$FIXTURE_EVENTS"; return 1; }; echo MAX_INVERSE >> "$FIXTURE_EVENTS"; }',
    ] : []),
    ...(options.trackRollbackOrder ? [
      'wait_backend_internal() { echo BACKEND_INTERNAL_READY >> "$FIXTURE_EVENTS"; }',
    ] : []),
    'curl() {',
    ' if [[ "$*" == *"/api/v1/auth/max"* ]]; then',
    ...(options.trackRollbackOrder ? ['  echo AUTH_ROUTE_CHECK >> "$FIXTURE_EVENTS";'] : []),
    '  if [ -n "$FIXTURE_AUTH_RESPONSE" ]; then printf "%s" "$FIXTURE_AUTH_RESPONSE"; elif grep -q rollback_auth_maintenance "$SERVER_EDGE_CADDYFILE"; then printf 503; else printf 404; fi',
    ' fi',
    ' return 0',
    '}',
    ...(options.action === 'prepare_rollback' ? [
      'bash() {',
      ' if [ "$1" = "$APP_ROOT/deploy/selectel/redeploy.sh" ]; then',
      '   shift',
      `   ( . "${options.redeployFromScriptDir ? '$SCRIPT_DIR/redeploy.sh' : '$APP_ROOT/deploy/selectel/redeploy.sh'}"; ${options.maxVideoMocks ? 'rollback_control_installed_inputs_match() { :; }; rollback_verify_max_video_migration_history() { echo present; }; rollback_verify_max_video_recovery_readiness() { echo MAX_READINESS >> "$FIXTURE_EVENTS"; }; rollback_apply_max_video_recovery() { echo MAX_INVERSE >> "$FIXTURE_EVENTS"; };' : ''} ${options.albumHistoryMocks ? 'rollback_verify_albums_migration_history() { echo "ALBUM_HISTORY:$1" >> "$FIXTURE_EVENTS"; return 0; };' : ''} require_command() { case "$1" in curl|flock|git|readlink|stat|docker) return 0 ;; *) command -v "$1" >/dev/null ;; esac; }; acquire_deploy_lock() { :; }; load_runtime_secrets() { export MAX_BOT_TOKEN=synthetic-test-token MAX_WEBHOOK_SECRET=synthetic-test-secret MAX_INBOX_ENCRYPTION_KEY=synthetic-test-key; }; main "$@" )`,
      ' else command bash "$@"; fi',
      '}',
    ] : []),
  ].join('\n')
  const lockSetup = options.syntheticLock ? [
    'exec 9>"$SERVER_ROOT/.selectel-deploy.lock"',
    'SELECTEL_CI_RELEASE=true; SELECTEL_DEPLOY_LOCK_FD=9; export SELECTEL_CI_RELEASE SELECTEL_DEPLOY_LOCK_FD',
    'readlink() { case "$*" in "-f -- $SERVER_ROOT/.selectel-deploy.lock"|"/proc/self/fd/9") printf "%s\\n" "$SERVER_ROOT/.selectel-deploy.lock" ;; *) command readlink "$@" ;; esac; }',
    'flock() { :; }',
  ].join('\n') : ''
  const trigger = options.failure ? [
    'LEGACY_MEMBERSHIP_RUNTIME=false; LEGACY_MM0_RUNTIME=false; QUIESCE_STARTED=false; PROMOTION_STARTED=true',
    'bash() { if [ "$2" = rollback ]; then ( rollback ); else command bash "$@"; fi; }',
    'trap release_failure EXIT',
    '(exit 42)',
  ].join('\n') : (options.action ?? 'rollback')
  const assignments = Object.entries(env).map(([name, value]) => name + '=' + shellQuote(value)).join('\n')
  try {
    const result = spawnSync(bashExecutable, ['-s'], {
      input: [`. ${shellQuote(resolve(root, 'deploy/selectel/ci-release.sh'))}`,
        redeployDefinitions, assignments, mocks, lockSetup, trigger].join('\n'), encoding: 'utf8', timeout: options.processTimeoutMs ?? 30_000,
    })
    return { ...result, output: result.stdout + result.stderr,
      events: existsSync(events) ? readFileSync(events, 'utf8') : '',
      caddy: readFileSync(resolve(server, 'gateway/Caddyfile'), 'utf8'),
      rollbackEnv: readFileSync(resolve(server, 'rollback.env'), 'utf8'),
      rollbackBackups: readdirSync(resolve(server, 'backups')).filter((name) => name.startsWith('rollback-env.before-')) }
  } finally { rmSync(fixture, { recursive: true, force: true }) }
}

slowTest('legacy UI target fails rollback readiness without changing services', () => {
  const result = runApplicationRollback({ target: rollback180, webappTarget: rollback180, source: 'candidate', action: 'rollback_readiness' })
  assert.notEqual(result.status, 0, result.output)
  assert.match(result.events, /STATE/)
  assert.doesNotMatch(result.events, /UP:|GATE/)
  assert.match(result.output, /UI downgrade is forbidden/)
  assert.doesNotMatch(result.caddy, /rollback_auth_maintenance/)
  assert.equal(result.caddy, 'before\n')
})

slowTest('measured comments source to legacy UI remains technical-only and attests exact migration history', () => {
  const result = runApplicationRollback({ target: rollback180, webappTarget: rollback180, source: 'comments', action: 'verify_application_rollback' })
  assert.equal(result.status, 0, result.output)
  assert.match(result.events, /HISTORY_ATTESTATION:present/)
  assert.match(result.events, /STATE.*\nHISTORY_ATTESTATION:present/)
  assert.doesNotMatch(result.events, /UP:|GATE/)
  assert.doesNotMatch(result.output, /readiness verified/)
  assert.doesNotMatch(result.caddy, /rollback_auth_maintenance/)
})

test('exact COM-UX runtime is accepted only with the pinned v4 pair and changed webapp trees fail closed', {
  timeout: process.platform === 'win32' ? 120_000 : 60_000,
}, () => {
  const compatible = runApplicationRollback({ target: rollbackV4, webappTarget: rollbackV4,
    source: 'comux', action: 'verify_application_rollback' })
  assert.equal(compatible.status, 0, compatible.output)
  assert.match(compatible.events, /STATE.*\nHISTORY_ATTESTATION:present/)
  assert.doesNotMatch(compatible.events, /UP:|GATE/)

  const restored = runApplicationRollback({ failure: true, target: rollbackV4,
    webappTarget: rollbackV4, source: 'comux' })
  assert.equal(restored.status, 42, restored.output)
  assert.match(restored.output, /Application rollback complete; additive migrations remain applied with normal authentication routing/)

  const changedSource = commitSourceChange(rollbackSource('comux'),
    'webapp/src/platform/media/use-private-image-url.ts', '\n// altered webapp fingerprint fixture\n',
    'mutate COM-UX webapp runtime')
  const changed = runApplicationRollback({ target: rollbackV4, webappTarget: rollbackV4,
    sourceRootOverride: changedSource.root, sourceShaOverride: changedSource.sha })
  assert.notEqual(changed.status, 0, changed.output)
  assert.match(changed.output, /application runtime differs from the verified rollback source/)
  assert.doesNotMatch(changed.events, /UP:|GATE/)
})

slowTest('test-only edits keep the verified runtime compatible with its immutable rollback artifact', () => {
  let source = createSourceWorktree('feedPhoto')
  for (const [path, marker] of [
    ['webapp/e2e/comments.spec.ts', '\n// test-only compatibility fixture\n'],
    ['webapp/tests/ui-v2-header.test.tsx', '\n// test-only compatibility fixture\n'],
    ['backend/src/http/security.test.ts', '\n// test-only compatibility fixture\n'],
    ['backend/scripts/test-integration.mjs', '\n// test-runner-only compatibility fixture\n'],
    ['backend/scripts/test-files.mjs', '\n// test-runner-only compatibility fixture\n'],
    ['backend/scripts/test-unit.mjs', '\n// test-runner-only compatibility fixture\n'],
    ['backend/scripts/test-live.mjs', '\n// test-runner-only compatibility fixture\n'],
  ]) source = commitSourceChange(source, path, marker, 'modify test-only compatibility input')

  const result = runApplicationRollback({ target: rollbackHealthy, webappTarget: rollbackHealthy,
    sourceRootOverride: source.root, sourceShaOverride: source.sha })
  assert.equal(result.status, 0, result.output)
  assert.match(result.output, /Application rollback complete/)
  assert.match(result.events, /GATE\nUP:.*backend worker scheduler static/)
})

slowTest('timer fix and Storybook security update have one exact 33a recovery compatibility attestation', () => {
  let source = createSourceWorktree('feedPhoto')
  source = commitSourceFile(source, 'webapp/src/platform/media/avatar-resource-pool.ts',
    frozenAvatarTimerFixSource(),
    'apply exact avatar timer binding fix')
  source = commitSourceFile(source, 'package.json', frozenStorybookManifest(), 'upgrade Storybook security pins')
  source = commitSourceFile(source, 'bun.lock', frozenStorybookLock(), 'refresh Storybook lockfile')
  source = commitSourceFile(source, 'deploy/selectel/redeploy.sh',
    readFileSync(resolve(root, 'deploy/selectel/redeploy.sh'), 'utf8'), 'apply attested rollback compatibility profile')

  const compatible = runApplicationRollback({ target: rollbackHealthy, webappTarget: rollbackHealthy,
    sourceRootOverride: source.root, sourceShaOverride: source.sha,
    action: 'rollback_readiness', processTimeoutMs: 60_000 })
  assert.equal(compatible.status, 0, compatible.output)

  const drifted = commitSourceChange(source, 'webapp/src/platform/media/avatar-resource-pool.ts',
    '\n// unrelated executable drift\n', 'introduce unapproved runtime drift')
  const rejected = runApplicationRollback({ target: rollbackHealthy, webappTarget: rollbackHealthy,
    sourceRootOverride: drifted.root, sourceShaOverride: drifted.sha,
    action: 'rollback_readiness', processTimeoutMs: 60_000 })
  assert.notEqual(rejected.status, 0, rejected.output)
  assert.match(rejected.output, /application runtime differs from the verified rollback source/)
})

slowTest('repeat release preserves the verified recovery pair and refuses an invalid prior pair before mutation', () => {
  let source = createSourceWorktree('feedPhoto')
  source = commitSourceFile(source, 'webapp/src/platform/media/avatar-resource-pool.ts',
    frozenAvatarTimerFixSource(),
    'apply exact avatar timer binding fix')
  source = commitSourceFile(source, 'package.json', frozenStorybookManifest(), 'upgrade Storybook security pins')
  source = commitSourceFile(source, 'bun.lock', frozenStorybookLock(), 'refresh Storybook lockfile')
  source = commitSourceFile(source, 'deploy/selectel/redeploy.sh',
    readFileSync(resolve(root, 'deploy/selectel/redeploy.sh'), 'utf8'), 'apply attested rollback compatibility profile')

  const preserved = runApplicationRollback({ target: rollbackHealthy, webappTarget: rollbackHealthy,
    runningBackend: 'dc3201096998f366a88a296d13914abf6047604b',
    runningWebapp: 'dc3201096998f366a88a296d13914abf6047604b',
    sourceRootOverride: source.root, sourceShaOverride: source.sha,
    action: 'prepare_rollback', processTimeoutMs: 60_000 })
  assert.equal(preserved.status, 0, preserved.output)
  assert.match(preserved.output, /preserving the verified designated rollback pair/)
  assert.match(preserved.rollbackEnv, new RegExp(`^PREVIOUS_BACKEND_IMAGE_TAG=${rollbackHealthy}$`, 'm'))
  assert.equal(preserved.rollbackBackups.length, 1)

  const unknown = 'cccccccccccccccccccccccccccccccccccccccc'
  const rejected = runApplicationRollback({ target: unknown, webappTarget: unknown,
    runningBackend: 'dc3201096998f366a88a296d13914abf6047604b',
    runningWebapp: 'dc3201096998f366a88a296d13914abf6047604b',
    sourceRootOverride: source.root, sourceShaOverride: source.sha,
    action: 'prepare_rollback', processTimeoutMs: 60_000 })
  assert.notEqual(rejected.status, 0, rejected.output)
  assert.match(rejected.output, /neither the running images nor the designated rollback pair passed recovery verification/)
  assert.doesNotMatch(rejected.events, /UP:|GATE/)
  assert.doesNotMatch(rejected.output, /Rollback prepared:/)
  assert.match(rejected.rollbackEnv, new RegExp(`^PREVIOUS_BACKEND_IMAGE_TAG=${unknown}$`, 'm'))
  assert.deepEqual(rejected.rollbackBackups, [])
})

slowTest('exact dc26 comments diagnostic source preserves the designated 33a recovery and rejects drift', () => {
  const source = rollbackSource('diagnostic')
  const runningPair = 'f6'.repeat(20)
  const compatible = runApplicationRollback({ target: rollbackHealthy, webappTarget: rollbackHealthy,
    runningBackend: runningPair, runningWebapp: runningPair,
    sourceRootOverride: source.root, sourceShaOverride: source.sha,
    action: 'rollback_readiness' })
  assert.equal(compatible.status, 0, compatible.output)
  assert.match(compatible.output, /Application rollback readiness verified/)
  assert.doesNotMatch(compatible.events, /UP:|GATE/)

  const preserved = runApplicationRollback({ target: rollbackHealthy, webappTarget: rollbackHealthy,
    runningBackend: runningPair, runningWebapp: runningPair,
    sourceRootOverride: source.root, sourceShaOverride: source.sha,
    action: 'prepare_rollback', redeployFromScriptDir: true })
  assert.equal(preserved.status, 0, preserved.output)
  assert.match(preserved.output, /preserving the verified designated rollback pair/)
  assert.match(preserved.rollbackEnv, new RegExp(`^PREVIOUS_BACKEND_IMAGE_TAG=${rollbackHealthy}$`, 'm'))
  assert.equal(preserved.rollbackBackups.length, 1)
  assert.doesNotMatch(preserved.events, /UP:|GATE/)

  const changedSource = commitSourceChange(source,
    'webapp/src/platform/diagnostics/bootstrap.js',
    '\n// diagnostic production source drift fixture\n', 'mutate comments diagnostic runtime')
  const changed = runApplicationRollback({ target: rollbackHealthy, webappTarget: rollbackHealthy,
    runningBackend: runningPair, runningWebapp: runningPair,
    sourceRootOverride: changedSource.root, sourceShaOverride: changedSource.sha,
    action: 'prepare_rollback', redeployFromScriptDir: true })
  assert.notEqual(changed.status, 0, changed.output)
  assert.match(changed.output, /application runtime differs from the verified rollback source/)
  assert.doesNotMatch(changed.events, /UP:|GATE/)
  assert.match(changed.rollbackEnv, new RegExp(`^PREVIOUS_BACKEND_IMAGE_TAG=${rollbackHealthy}$`, 'm'))
  assert.equal(changed.rollbackEnv, [
    `PREVIOUS_BACKEND_IMAGE_TAG=${rollbackHealthy}`,
    `PREVIOUS_WEBAPP_IMAGE_TAG=${rollbackHealthy}`,
    'MEMOLY_DB_ROLLBACK_ALLOWED=false', '',
  ].join('\n'))
  assert.deepEqual(changed.rollbackBackups, [])
})

slowTest('exact media UI source preserves the designated 33a recovery and rejects executable drift', () => {
  let source = createSourceWorktree('diagnostic')
  source = commitFrozenSourceFiles(source, reviewedMediaUiBlobs, 'apply exact media UI source blobs')
  assert.equal(productionCompatibilityFingerprint(source.root),
    '98ec68669e8a64cac59ca55bd34e3585cc5fbf24d3c48d6976196118ae1a762a')

  const runningPair = 'f6'.repeat(20)
  const compatible = runApplicationRollback({ target: rollbackHealthy, webappTarget: rollbackHealthy,
    runningBackend: runningPair, runningWebapp: runningPair,
    sourceRootOverride: source.root, sourceShaOverride: source.sha,
    action: 'rollback_readiness' })
  assert.equal(compatible.status, 0, compatible.output)
  assert.match(compatible.output, /Application rollback readiness verified/)
  assert.doesNotMatch(compatible.events, /UP:|GATE/)

  const preserved = runApplicationRollback({ target: rollbackHealthy, webappTarget: rollbackHealthy,
    runningBackend: runningPair, runningWebapp: runningPair,
    sourceRootOverride: source.root, sourceShaOverride: source.sha,
    action: 'prepare_rollback', redeployFromScriptDir: true })
  assert.equal(preserved.status, 0, preserved.output)
  assert.match(preserved.output, /preserving the verified designated rollback pair/)
  assert.match(preserved.rollbackEnv, new RegExp(`^PREVIOUS_BACKEND_IMAGE_TAG=${rollbackHealthy}$`, 'm'))
  assert.match(preserved.rollbackEnv, new RegExp(`^PREVIOUS_WEBAPP_IMAGE_TAG=${rollbackHealthy}$`, 'm'))
  assert.equal(preserved.rollbackBackups.length, 1)
  assert.doesNotMatch(preserved.events, /UP:|GATE/)

  const drifted = commitSourceChange(source, 'webapp/src/features/feed/FeedPage.tsx',
    '\n// unmeasured executable source drift\n', 'mutate media UI executable source')
  const rejected = runApplicationRollback({ target: rollbackHealthy, webappTarget: rollbackHealthy,
    runningBackend: runningPair, runningWebapp: runningPair,
    sourceRootOverride: drifted.root, sourceShaOverride: drifted.sha,
    action: 'prepare_rollback', redeployFromScriptDir: true })
  assert.notEqual(rejected.status, 0, rejected.output)
  assert.match(rejected.output, /application runtime differs from the verified rollback source/)
  assert.doesNotMatch(rejected.events, /UP:|GATE/)
  assert.equal(rejected.rollbackEnv, [
    `PREVIOUS_BACKEND_IMAGE_TAG=${rollbackHealthy}`,
    `PREVIOUS_WEBAPP_IMAGE_TAG=${rollbackHealthy}`,
    'MEMOLY_DB_ROLLBACK_ALLOWED=false', '',
  ].join('\n'))
  assert.deepEqual(rejected.rollbackBackups, [])
})

slowTest('exact family navigation source preserves the designated 33a recovery and rejects drift before mutation', () => {
  let source = createSourceWorktree('diagnostic')
  source = commitFrozenSourceFiles(source, reviewedMediaUiBlobs, 'apply exact media UI source blobs')
  source = commitFrozenSourceFiles(source, reviewedFamilyNavigationBlobs, 'apply exact family navigation source blobs')
  assert.equal(productionCompatibilityFingerprint(source.root),
    'a208551a5f5925445d71bedc322d669d04bf76196d90332cc0816e7c7c3a70c6')

  const runningPair = 'f6'.repeat(20)
  const compatible = runApplicationRollback({ target: rollbackHealthy, webappTarget: rollbackHealthy,
    runningBackend: runningPair, runningWebapp: runningPair,
    sourceRootOverride: source.root, sourceShaOverride: source.sha,
    action: 'rollback_readiness' })
  assert.equal(compatible.status, 0, compatible.output)
  assert.match(compatible.output, /Application rollback readiness verified/)
  assert.doesNotMatch(compatible.events, /UP:|GATE/)

  const preserved = runApplicationRollback({ target: rollbackHealthy, webappTarget: rollbackHealthy,
    runningBackend: runningPair, runningWebapp: runningPair,
    sourceRootOverride: source.root, sourceShaOverride: source.sha,
    action: 'prepare_rollback', redeployFromScriptDir: true })
  assert.equal(preserved.status, 0, preserved.output)
  assert.match(preserved.output, /preserving the verified designated rollback pair/)
  assert.match(preserved.rollbackEnv, new RegExp(`^PREVIOUS_BACKEND_IMAGE_TAG=${rollbackHealthy}$`, 'm'))
  assert.match(preserved.rollbackEnv, new RegExp(`^PREVIOUS_WEBAPP_IMAGE_TAG=${rollbackHealthy}$`, 'm'))
  assert.equal(preserved.rollbackBackups.length, 1)
  assert.doesNotMatch(preserved.events, /UP:|GATE/)

  const drifted = commitSourceChange(source, 'webapp/src/features/family/FamilyHubPage.tsx',
    '\n// unmeasured family navigation source drift\n', 'mutate family navigation executable source')
  const rejected = runApplicationRollback({ target: rollbackHealthy, webappTarget: rollbackHealthy,
    runningBackend: runningPair, runningWebapp: runningPair,
    sourceRootOverride: drifted.root, sourceShaOverride: drifted.sha,
    action: 'prepare_rollback', redeployFromScriptDir: true })
  assert.notEqual(rejected.status, 0, rejected.output)
  assert.match(rejected.output, /application runtime differs from the verified rollback source/)
  assert.doesNotMatch(rejected.events, /UP:|GATE/)
  assert.equal(rejected.rollbackEnv, [
    `PREVIOUS_BACKEND_IMAGE_TAG=${rollbackHealthy}`,
    `PREVIOUS_WEBAPP_IMAGE_TAG=${rollbackHealthy}`,
    'MEMOLY_DB_ROLLBACK_ALLOWED=false', '',
  ].join('\n'))
  assert.deepEqual(rejected.rollbackBackups, [])
})

slowTest('exact shared header and child avatar source preserves the designated 33a recovery and rejects drift before mutation', () => {
  let source = createSourceWorktree('diagnostic')
  source = commitFrozenSourceFiles(source, reviewedMediaUiBlobs, 'apply exact media UI source blobs')
  source = commitFrozenSourceFiles(source, reviewedFamilyNavigationBlobs, 'apply exact family navigation source blobs')
  source = commitFrozenSourceFiles(source, reviewedSharedHeaderChildAvatarBlobs,
    'apply exact shared header and child avatar source blobs')
  assert.equal(productionCompatibilityFingerprint(source.root),
    'b3efa841bf22d2703c462d3fcf58f039c55784a3dc0dd695f3e81ce14dcece04')

  const runningPair = 'f6'.repeat(20)
  const compatible = runApplicationRollback({ target: rollbackHealthy, webappTarget: rollbackHealthy,
    runningBackend: runningPair, runningWebapp: runningPair,
    sourceRootOverride: source.root, sourceShaOverride: source.sha,
    action: 'rollback_readiness' })
  assert.equal(compatible.status, 0, compatible.output)
  assert.match(compatible.output, /Application rollback readiness verified/)
  assert.doesNotMatch(compatible.events, /UP:|GATE/)

  const preserved = runApplicationRollback({ target: rollbackHealthy, webappTarget: rollbackHealthy,
    runningBackend: runningPair, runningWebapp: runningPair,
    sourceRootOverride: source.root, sourceShaOverride: source.sha,
    action: 'prepare_rollback', redeployFromScriptDir: true })
  assert.equal(preserved.status, 0, preserved.output)
  assert.match(preserved.output, /preserving the verified designated rollback pair/)
  assert.match(preserved.rollbackEnv, new RegExp(`^PREVIOUS_BACKEND_IMAGE_TAG=${rollbackHealthy}$`, 'm'))
  assert.match(preserved.rollbackEnv, new RegExp(`^PREVIOUS_WEBAPP_IMAGE_TAG=${rollbackHealthy}$`, 'm'))
  assert.equal(preserved.rollbackBackups.length, 1)
  assert.doesNotMatch(preserved.events, /UP:|GATE/)

  const drifted = commitSourceChange(source, 'webapp/src/features/family/ChildAvatar.tsx',
    '\n// unmeasured child avatar source drift\n', 'mutate shared header and child avatar runtime')
  const rejected = runApplicationRollback({ target: rollbackHealthy, webappTarget: rollbackHealthy,
    runningBackend: runningPair, runningWebapp: runningPair,
    sourceRootOverride: drifted.root, sourceShaOverride: drifted.sha,
    action: 'prepare_rollback', redeployFromScriptDir: true })
  assert.notEqual(rejected.status, 0, rejected.output)
  assert.match(rejected.output, /application runtime differs from the verified rollback source/)
  assert.doesNotMatch(rejected.events, /UP:|GATE/)
  assert.equal(rejected.rollbackEnv, [
    `PREVIOUS_BACKEND_IMAGE_TAG=${rollbackHealthy}`,
    `PREVIOUS_WEBAPP_IMAGE_TAG=${rollbackHealthy}`,
    'MEMOLY_DB_ROLLBACK_ALLOWED=false', '',
  ].join('\n'))
  assert.deepEqual(rejected.rollbackBackups, [])
})

slowTest('exact cropped-channel avatar source preserves designated 33a recovery and rejects drift before mutation', () => {
  let source = createSourceWorktree('diagnostic')
  source = commitFrozenSourceFiles(source, reviewedMediaUiBlobs, 'apply exact media UI source blobs')
  source = commitFrozenSourceFiles(source, reviewedFamilyNavigationBlobs, 'apply exact family navigation source blobs')
  source = commitFrozenSourceFiles(source, reviewedSharedHeaderChildAvatarBlobs,
    'apply exact shared header and child avatar source blobs')
  source = commitFrozenSourceFiles(source, reviewedSingleAvatarSourceBlobs,
    'apply exact cropped-channel avatar production blobs')
  assert.equal(productionCompatibilityFingerprint(source.root),
    '0236c2944f1e4c978b4da387dbc6758b330cd1f6d36fe54cf84b65eefab3ace0')

  const runningPair = 'f6'.repeat(20)
  const compatible = runApplicationRollback({ target: rollbackHealthy, webappTarget: rollbackHealthy,
    runningBackend: runningPair, runningWebapp: runningPair,
    sourceRootOverride: source.root, sourceShaOverride: source.sha,
    action: 'rollback_readiness' })
  assert.equal(compatible.status, 0, compatible.output)
  assert.match(compatible.output, /Application rollback readiness verified/)
  assert.doesNotMatch(compatible.events, /UP:|GATE/)

  const preserved = runApplicationRollback({ target: rollbackHealthy, webappTarget: rollbackHealthy,
    runningBackend: runningPair, runningWebapp: runningPair,
    sourceRootOverride: source.root, sourceShaOverride: source.sha,
    action: 'prepare_rollback', redeployFromScriptDir: true })
  assert.equal(preserved.status, 0, preserved.output)
  assert.match(preserved.output, /preserving the verified designated rollback pair/)
  assert.match(preserved.rollbackEnv, new RegExp(`^PREVIOUS_BACKEND_IMAGE_TAG=${rollbackHealthy}$`, 'm'))
  assert.match(preserved.rollbackEnv, new RegExp(`^PREVIOUS_WEBAPP_IMAGE_TAG=${rollbackHealthy}$`, 'm'))
  assert.equal(preserved.rollbackBackups.length, 1)
  assert.doesNotMatch(preserved.events, /UP:|GATE/)

  const drifted = commitSourceChange(source, 'webapp/src/features/family/ChildAvatar.tsx',
    '\n// unmeasured single-source child avatar runtime drift\n', 'mutate single-source child avatar runtime')
  const rejected = runApplicationRollback({ target: rollbackHealthy, webappTarget: rollbackHealthy,
    runningBackend: runningPair, runningWebapp: runningPair,
    sourceRootOverride: drifted.root, sourceShaOverride: drifted.sha,
    action: 'prepare_rollback', redeployFromScriptDir: true })
  assert.notEqual(rejected.status, 0, rejected.output)
  assert.match(rejected.output, /application runtime differs from the verified rollback source/)
  assert.doesNotMatch(rejected.events, /UP:|GATE/)
  assert.equal(rejected.rollbackEnv, [
    `PREVIOUS_BACKEND_IMAGE_TAG=${rollbackHealthy}`,
    `PREVIOUS_WEBAPP_IMAGE_TAG=${rollbackHealthy}`,
    'MEMOLY_DB_ROLLBACK_ALLOWED=false', '',
  ].join('\n'))
  assert.deepEqual(rejected.rollbackBackups, [])
})

slowTest('exact Welcome CTA and once-zoom source preserves 33a recovery and rejects production drift before mutation', () => {
  let source = createSourceWorktree('diagnostic')
  source = commitFrozenSourceFiles(source, reviewedMediaUiBlobs, 'apply exact media UI source blobs')
  source = commitFrozenSourceFiles(source, reviewedFamilyNavigationBlobs, 'apply exact family navigation source blobs')
  source = commitFrozenSourceFiles(source, reviewedSharedHeaderChildAvatarBlobs,
    'apply exact shared header and child avatar source blobs')
  source = commitFrozenSourceFiles(source, reviewedSingleAvatarSourceBlobs,
    'apply exact cropped-channel avatar production blobs')
  mkdirSync(resolve(source.root, 'webapp/public/assets/fonts'), { recursive: true })
  source = commitFrozenSourceFiles(source, reviewedWelcomeCta6Blobs,
    'apply exact Welcome CTA 6 production blobs')
  source = commitFrozenSourceFiles(source, reviewedWelcomeOnceZoomBlobs,
    'apply exact Welcome once-zoom production blobs')
  assert.equal(productionCompatibilityFingerprint(source.root),
    '66c95074db67e743e0a96e9db65c758e13e7ae89de4cbc8cd5a64b67cca17d65')

  const runningPair = 'f6'.repeat(20)
  const compatible = runApplicationRollback({ target: rollbackHealthy, webappTarget: rollbackHealthy,
    runningBackend: runningPair, runningWebapp: runningPair,
    sourceRootOverride: source.root, sourceShaOverride: source.sha,
    action: 'rollback_readiness', processTimeoutMs: 60_000 })
  assert.equal(compatible.status, 0, compatible.output)
  assert.match(compatible.output, /Application rollback readiness verified/)
  assert.doesNotMatch(compatible.events, /UP:|GATE/)

  const preserved = runApplicationRollback({ target: rollbackHealthy, webappTarget: rollbackHealthy,
    runningBackend: runningPair, runningWebapp: runningPair,
    sourceRootOverride: source.root, sourceShaOverride: source.sha,
    action: 'prepare_rollback', redeployFromScriptDir: true, processTimeoutMs: 60_000 })
  assert.equal(preserved.status, 0, preserved.output)
  assert.match(preserved.output, /preserving the verified designated rollback pair/)
  assert.match(preserved.rollbackEnv, new RegExp(`^PREVIOUS_BACKEND_IMAGE_TAG=${rollbackHealthy}$`, 'm'))
  assert.match(preserved.rollbackEnv, new RegExp(`^PREVIOUS_WEBAPP_IMAGE_TAG=${rollbackHealthy}$`, 'm'))
  assert.equal(preserved.rollbackBackups.length, 1)
  assert.doesNotMatch(preserved.events, /UP:|GATE/)

  for (const [path, marker] of [
    ['webapp/src/App.tsx', '\n// unreviewed app production drift\n'],
    ['webapp/src/platform/app-zoom.ts', '\n// unreviewed zoom production drift\n'],
  ]) {
    const driftRoot = mkdtempSync(resolve(root, '.scratch', 'rollback-welcome-once-zoom-drift-'))
    const driftCheckout = spawnSync('git', ['worktree', 'add', '--detach', driftRoot, source.sha], { cwd: root, encoding: 'utf8' })
    if (driftCheckout.status !== 0) throw new Error(driftCheckout.stdout + driftCheckout.stderr)
    fixtureWorktrees.push(driftRoot)
    const drifted = commitSourceChange({ root: driftRoot, sha: source.sha }, path, marker,
      `mutate ${path} production source`)
    const rejected = runApplicationRollback({ target: rollbackHealthy, webappTarget: rollbackHealthy,
      runningBackend: runningPair, runningWebapp: runningPair,
      sourceRootOverride: drifted.root, sourceShaOverride: drifted.sha,
      action: 'prepare_rollback', redeployFromScriptDir: true, processTimeoutMs: 60_000 })
    assert.notEqual(rejected.status, 0, rejected.output)
    assert.match(rejected.output, /application runtime differs from the verified rollback source/)
    assert.doesNotMatch(rejected.events, /UP:|GATE/)
    assert.equal(rejected.rollbackEnv, [
      `PREVIOUS_BACKEND_IMAGE_TAG=${rollbackHealthy}`,
      `PREVIOUS_WEBAPP_IMAGE_TAG=${rollbackHealthy}`,
      'MEMOLY_DB_ROLLBACK_ALLOWED=false', '',
    ].join('\n'))
    assert.deepEqual(rejected.rollbackBackups, [])
  }
})

test('the immutable Selectel source ref retains its comments compatibility profile', () => {
  const result = spawnSync(bashExecutable, ['-s'], {
    cwd: root,
    input: `${redeployDefinitions}\nAPP_ROOT=${shellQuote(root)}\nrollback_source_compatibility_profile 91f48719309e20456b1659092a1bf209c3aa3653 3fce2739205da927b95eb3379b1d066b61282965\n`,
    encoding: 'utf8', timeout: 10_000,
  })
  assert.equal(result.status, 0, result.stdout + result.stderr)
  assert.equal(result.stdout.trim(), 'comments')
})

test('exact feed-photo runtime is accepted only with the healthy 33a pair, image IDs and unchanged backend runtime', {
  timeout: process.platform === 'win32' ? 180_000 : 60_000,
}, () => {
  const compatible = runApplicationRollback({ target: rollbackHealthy, webappTarget: rollbackHealthy,
    source: 'feedPhoto', action: 'verify_application_rollback', processTimeoutMs: 60_000 })
  assert.equal(compatible.status, 0, compatible.output)
  assert.match(compatible.events, /STATE.*\nHISTORY_ATTESTATION:present/)
  assert.doesNotMatch(compatible.events, /UP:|GATE/)

  const wrongImage = runApplicationRollback({ target: rollbackHealthy, webappTarget: rollbackHealthy,
    source: 'feedPhoto', badImage: true, processTimeoutMs: 60_000 })
  assert.notEqual(wrongImage.status, 0, wrongImage.output)
  assert.match(wrongImage.output, /rollback backend image differs from the verified production artifact/)
  assert.doesNotMatch(wrongImage.events, /UP:|GATE/)

  const changedSource = commitSourceChange(rollbackSource('feedPhoto'),
    'webapp/src/platform/media/use-private-image-url.ts', '\n// altered feed-photo source fixture\n',
    'mutate feed-photo webapp runtime')
  const changed = runApplicationRollback({ target: rollbackHealthy, webappTarget: rollbackHealthy,
    sourceRootOverride: changedSource.root, sourceShaOverride: changedSource.sha, processTimeoutMs: 60_000 })
  assert.notEqual(changed.status, 0, changed.output)
  assert.match(changed.output, /application runtime differs from the verified rollback source/)
  assert.doesNotMatch(changed.events, /UP:|GATE/)
})

slowTest('comments rollback rejects unknown migration history and history query failures before promotion', () => {
  for (const options of [{ historyMismatch: true }, { historyError: true }]) {
    const result = runApplicationRollback({ target: rollback180, webappTarget: rollback180, source: 'comments', action: 'verify_application_rollback', ...options })
    assert.notEqual(result.status, 0, JSON.stringify(options) + result.output)
    assert.match(result.events, /HISTORY_ATTESTATION:present/)
    assert.doesNotMatch(result.events, /UP:|GATE/)
  }
})

test('albums recovery uses frozen production blobs and confines the pending-ledger phase to guarded readiness', {
  timeout: process.platform === 'win32' ? 180_000 : 60_000,
}, () => {
  const source = rollbackSource('albums')
  const profile = spawnSync(bashExecutable, ['-s'], {
    cwd: root,
    input: `${redeployDefinitions}\nAPP_ROOT=${shellQuote(source.root)}\nMEMOLY_PRODUCT_SHA=${source.sha}\nrollback_source_compatibility_profile "$MEMOLY_PRODUCT_SHA" ${rollbackHealthy}\n`,
    encoding: 'utf8', timeout: 30_000,
  })
  assert.equal(profile.status, 0, profile.stdout + profile.stderr)
  assert.equal(profile.stdout.trim().split('\n').at(-1), 'albums')

  const complete = runApplicationRollback({ sourceRootOverride: source.root, sourceShaOverride: source.sha,
    target: rollbackHealthy, webappTarget: rollbackHealthy, action: 'verify_application_rollback' })
  assert.equal(complete.status, 0, complete.output)
  assert.match(complete.events, /ALBUM_HISTORY:complete/)
  assert.doesNotMatch(complete.events, /UP:|GATE/)

  const unguardedPrefix = runApplicationRollback({ sourceRootOverride: source.root, sourceShaOverride: source.sha,
    target: rollbackHealthy, webappTarget: rollbackHealthy, action: 'rollback_readiness', albumPhase: 'pre-sql' })
  assert.notEqual(unguardedPrefix.status, 0, unguardedPrefix.output)
  assert.match(unguardedPrefix.output, /pre-SQL migration readiness is restricted to the guarded CI release/)
  assert.doesNotMatch(unguardedPrefix.events, /ALBUM_HISTORY:|UP:|GATE/)

  const rollbackIgnoresPrefix = runApplicationRollback({ sourceRootOverride: source.root, sourceShaOverride: source.sha,
    target: rollbackHealthy, webappTarget: rollbackHealthy, action: 'rollback', albumPhase: 'pre-sql' })
  assert.equal(rollbackIgnoresPrefix.status, 0, rollbackIgnoresPrefix.output)
  assert.match(rollbackIgnoresPrefix.events, /ALBUM_HISTORY:complete/)

  const noMigrationClearsInheritedPhase = runApplicationRollback({ sourceRootOverride: source.root,
    sourceShaOverride: source.sha, target: rollbackHealthy, webappTarget: rollbackHealthy,
    action: 'prepare_rollback', albumPhase: 'pre-sql', redeployFromScriptDir: true, albumHistoryMocks: true })
  assert.equal(noMigrationClearsInheritedPhase.status, 0, noMigrationClearsInheritedPhase.output)
  assert.match(noMigrationClearsInheritedPhase.events, /ALBUM_HISTORY:complete/)
  assert.doesNotMatch(noMigrationClearsInheritedPhase.events, /ALBUM_HISTORY:pre-sql/)

  const migrationUsesLockedPrefixPhase = runApplicationRollback({ sourceRootOverride: source.root,
    sourceShaOverride: source.sha, target: rollbackHealthy, webappTarget: rollbackHealthy,
    action: 'prepare_rollback', runMigration: true, syntheticLock: true, redeployFromScriptDir: true,
    processTimeoutMs: 60_000, albumHistoryMocks: true })
  assert.equal(migrationUsesLockedPrefixPhase.status, 0, migrationUsesLockedPrefixPhase.output)
  assert.match(migrationUsesLockedPrefixPhase.events, /ALBUM_HISTORY:pre-sql/)
})

test('albums migration ledger accepts only exact reviewed prefixes and complete post-SQL state', {
  timeout: process.platform === 'win32' ? 180_000 : 60_000,
}, () => {
  const { program, baseline, candidate } = albumsMigrationHistoryProgram()
  const rowsFor = (count) => candidate.trim().split('\n').slice(0, count).map((line) => {
    const [migration_name, checksum] = line.split(':')
    return { migration_name, checksum, finished_at: '2026-10-23T00:00:00.000Z', rolled_back_at: null }
  })
  const verify = (phase, rows) => runAlbumsMigrationHistoryVerifier({ program, baseline, candidate, phase, rows })
  for (const count of [49, 50, 51, 52]) assert.equal(verify('pre-sql', rowsFor(count)).status, 0, `pre-SQL prefix ${count}`)
  assert.equal(verify('complete', rowsFor(52)).status, 0, 'post-SQL complete catalog')
  assert.notEqual(verify('pre-sql', rowsFor(48)).status, 0, 'missing baseline migration')
  assert.notEqual(verify('pre-sql', [...rowsFor(52), {
    migration_name: '20990101000000_unrelated', checksum: 'a'.repeat(64), finished_at: 'done', rolled_back_at: null,
  }]).status, 0, 'unrelated migration')
  assert.notEqual(verify('pre-sql', rowsFor(51).filter((_, index) => index !== 10)).status, 0, 'interior hole')
  assert.notEqual(verify('pre-sql', [{ ...rowsFor(49)[0], checksum: 'f'.repeat(64) }, ...rowsFor(49).slice(1)]).status, 0, 'changed checksum')
  assert.notEqual(verify('pre-sql', [{ ...rowsFor(49)[0], finished_at: null }, ...rowsFor(49).slice(1)]).status, 0, 'unfinished migration')
  assert.notEqual(verify('pre-sql', [{ ...rowsFor(49)[0], rolled_back_at: '2026-10-23T00:00:00.000Z' }, ...rowsFor(49).slice(1)]).status, 0, 'rolled-back migration')
  assert.notEqual(verify('pre-sql', [rowsFor(49)[0], rowsFor(49)[0], ...rowsFor(49).slice(2)]).status, 0, 'duplicate name')
  assert.notEqual(verify('complete', rowsFor(51)).status, 0, 'incomplete post-SQL catalog')
  assert.notEqual(verify('unknown', rowsFor(52)).status, 0, 'unknown phase')
})

test('private-photo recovery pins only its frozen source and accepts the exact 53-migration catalog', {
  timeout: process.platform === 'win32' ? 180_000 : 60_000,
}, () => {
  const source = rollbackSource('privatePhotos')
  const profile = spawnSync(bashExecutable, ['-s'], {
    cwd: root,
    input: `${redeployDefinitions}\nAPP_ROOT=${shellQuote(source.root)}\nMEMOLY_PRODUCT_SHA=${source.sha}\nrollback_source_compatibility_profile "$MEMOLY_PRODUCT_SHA" ${rollbackHealthy}\n`,
    encoding: 'utf8', timeout: 30_000,
  })
  assert.equal(profile.status, 0, profile.stdout + profile.stderr)
  assert.equal(profile.stdout.trim().split('\n').at(-1), 'albums')

  const { program, baseline, candidate } = albumsMigrationHistoryProgram('privatePhotos')
  const rowsFor = (count) => candidate.trim().split('\n').slice(0, count).map((line) => {
    const [migration_name, checksum] = line.split(':')
    return { migration_name, checksum, finished_at: '2026-10-23T00:00:00.000Z', rolled_back_at: null }
  })
  const verify = (phase, rows) => runAlbumsMigrationHistoryVerifier({ program, baseline, candidate, phase, rows })
  for (const count of [49, 50, 51, 52, 53]) assert.equal(verify('pre-sql', rowsFor(count)).status, 0, `pre-SQL prefix ${count}`)
  assert.equal(verify('complete', rowsFor(53)).status, 0, 'post-SQL complete private-photo catalog')
  assert.notEqual(verify('complete', rowsFor(52)).status, 0, 'post-SQL catalog missing private-photo migration')
  assert.notEqual(verify('pre-sql', [{ ...rowsFor(53)[0], checksum: 'f'.repeat(64) }, ...rowsFor(53).slice(1)]).status, 0,
    'changed baseline checksum')
  assert.notEqual(verify('pre-sql', [...rowsFor(52), { ...rowsFor(53)[52], finished_at: null }]).status, 0,
    'unfinished private-photo migration')
  assert.notEqual(verify('pre-sql', [...rowsFor(52), { ...rowsFor(53)[52], rolled_back_at: '2026-10-23T00:00:00.000Z' }]).status, 0,
    'rolled-back private-photo migration')
  assert.notEqual(verify('pre-sql', [...rowsFor(53), rowsFor(53)[52]]).status, 0, 'duplicate private-photo migration')
  assert.notEqual(verify('unknown', rowsFor(53)).status, 0, 'unknown phase')

  const driftDirectory = mkdtempSync(resolve(root, '.scratch', 'rollback-private-photos-drift-'))
  const driftAdded = spawnSync('git', ['worktree', 'add', '--detach', driftDirectory, source.sha], { cwd: root, encoding: 'utf8' })
  if (driftAdded.status !== 0) throw new Error(driftAdded.stdout + driftAdded.stderr)
  fixtureWorktrees.push(driftDirectory)
  const mutated = commitFrozenSourceFiles({ root: driftDirectory, sha: source.sha },
    [['backend/src/modules/media/infrastructure/prisma-media-repository.ts', '53b1e92e154dde778454061b5e40d60a6b081538']],
    'restore the anchored media repository blob to simulate production drift')
  const rejected = spawnSync(bashExecutable, ['-s'], {
    cwd: root,
    input: `${redeployDefinitions}\nAPP_ROOT=${shellQuote(mutated.root)}\nMEMOLY_PRODUCT_SHA=${mutated.sha}\nrollback_source_compatibility_profile "$MEMOLY_PRODUCT_SHA" ${rollbackHealthy}\n`,
    encoding: 'utf8', timeout: 30_000,
  })
  assert.notEqual(rejected.status, 0, 'production source mutation must invalidate the exact fingerprint')

  const wrongName = spawnSync('git', ['mv', '--',
    'backend/prisma/migrations/20261023150000_album_private_photos',
    'backend/prisma/migrations/20261023150000_unknown_private_photos'],
  { cwd: source.root, encoding: 'utf8' })
  assert.equal(wrongName.status, 0, wrongName.stdout + wrongName.stderr)
  const wrongNameCommit = spawnSync('git', ['-c', 'user.name=Rollback Test', '-c', 'user.email=rollback-test@example.invalid',
    'commit', '--quiet', '-m', 'simulate an unreviewed migration suffix'], { cwd: source.root, encoding: 'utf8' })
  assert.equal(wrongNameCommit.status, 0, wrongNameCommit.stdout + wrongNameCommit.stderr)
  const unknownSuffixSha = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: source.root, encoding: 'utf8' }).stdout.trim()
  const badCatalog = spawnSync(bashExecutable, ['-s'], {
    cwd: root,
    input: `${redeployDefinitions}\nAPP_ROOT=${shellQuote(source.root)}\nMEMOLY_PRODUCT_SHA=${unknownSuffixSha}\nrollback_verify_albums_migration_history pre-sql\n`,
    encoding: 'utf8', timeout: 30_000,
  })
  assert.notEqual(badCatalog.status, 0, 'unknown migration suffix must be rejected before invoking compose')
})

function migrationHistoryVerifierSource(expected) {
  const capture = resolve(root, '.scratch', `migration-ledger-program-${process.pid}.mjs`)
  const result = spawnSync(bashExecutable, ['-s'], {
    cwd: root,
    input: [
      'set -euo pipefail',
      `. '${gitBashPath(resolve(root, 'deploy/selectel/redeploy.sh'))}'`,
      'compose() { printf "%s" "${!#}" > "$CAPTURE_SCRIPT"; }',
      `rollback_verify_migration_history ${shellLiteral(expected)}`,
    ].join('\n'),
    encoding: 'utf8', env: { ...process.env, CAPTURE_SCRIPT: gitBashPath(capture) }, timeout: 10_000,
  })
  assert.equal(result.status, 0, result.stderr || result.stdout)
  const program = readFileSync(capture, 'utf8')
  rmSync(capture, { force: true })
  return program
}

function runMigrationHistoryVerifier({ expected, rows }) {
  const fixture = mkdtempSync(resolve(root, '.scratch', 'migration-ledger-module-'))
  const moduleDir = resolve(fixture, 'node_modules/pg')
  mkdirSync(moduleDir, { recursive: true })
  writeFileSync(resolve(moduleDir, 'package.json'), '{"type":"module","exports":"./index.js"}\n')
  writeFileSync(resolve(moduleDir, 'index.js'), `export class Client {
    async connect() {}
    async query() { return { rows: JSON.parse(process.env.FIXTURE_MIGRATION_ROWS) } }
    async end() {}
  }\n`)
  const verifier = migrationHistoryVerifierSource(expected)
  const result = spawnSync('node', ['--input-type=module', '--eval', verifier], {
    cwd: fixture,
    encoding: 'utf8',
    env: {
      ...process.env,
      MEMOLY_EXPECTED_MIGRATION_CHECKSUMS: expected,
      FIXTURE_MIGRATION_ROWS: JSON.stringify(rows),
    },
    timeout: 10_000,
  })
  rmSync(fixture, { recursive: true, force: true })
  return result
}

function albumsMigrationHistoryProgram(sourceRole = 'albums') {
  mkdirSync(resolve(root, '.scratch'), { recursive: true })
  const source = rollbackSource(sourceRole)
  const captureProgram = resolve(root, '.scratch', `albums-ledger-program-${process.pid}.mjs`)
  const captureCatalog = resolve(root, '.scratch', `albums-ledger-catalog-${process.pid}.txt`)
  const result = spawnSync(bashExecutable, ['-s'], {
    cwd: root,
    input: [
      'set -euo pipefail',
      `. '${gitBashPath(resolve(root, 'deploy/selectel/redeploy.sh'))}'`,
      `APP_ROOT=${shellQuote(root)}`,
      `MEMOLY_PRODUCT_SHA=${source.sha}`,
      'compose() { printf "%s" "${!#}" > "$CAPTURE_PROGRAM"; printf "%s\n%%CANDIDATE%%\n%s" "$MEMOLY_EXPECTED_BASELINE_MIGRATIONS" "$MEMOLY_EXPECTED_CANDIDATE_MIGRATIONS" > "$CAPTURE_CATALOG"; }',
      'rollback_verify_albums_migration_history pre-sql',
    ].join('\n'),
    encoding: 'utf8', env: { ...process.env, CAPTURE_PROGRAM: gitBashPath(captureProgram), CAPTURE_CATALOG: gitBashPath(captureCatalog) },
    timeout: 120_000,
  })
  assert.equal(result.status, 0, result.stdout + result.stderr)
  const catalogs = readFileSync(captureCatalog, 'utf8').split('\n%CANDIDATE%\n')
  const program = readFileSync(captureProgram, 'utf8')
  rmSync(captureProgram, { force: true })
  rmSync(captureCatalog, { force: true })
  return { program, baseline: catalogs[0], candidate: catalogs[1] }
}

function runAlbumsMigrationHistoryVerifier({ program, baseline, candidate, phase, rows }) {
  const fixture = mkdtempSync(resolve(root, '.scratch', 'albums-migration-ledger-module-'))
  const moduleDir = resolve(fixture, 'node_modules/pg')
  mkdirSync(moduleDir, { recursive: true })
  writeFileSync(resolve(moduleDir, 'package.json'), '{"type":"module","exports":"./index.js"}\n')
  writeFileSync(resolve(moduleDir, 'index.js'), `export class Client {
    async connect() {}
    async query() { return { rows: JSON.parse(process.env.FIXTURE_MIGRATION_ROWS) } }
    async end() {}
  }\n`)
  const result = spawnSync('node', ['--input-type=module', '--eval', program], {
    cwd: fixture, encoding: 'utf8', env: { ...process.env,
      MEMOLY_EXPECTED_BASELINE_MIGRATIONS: baseline,
      MEMOLY_EXPECTED_CANDIDATE_MIGRATIONS: candidate,
      MEMOLY_ALBUMS_LEDGER_PHASE: phase,
      FIXTURE_MIGRATION_ROWS: JSON.stringify(rows),
    }, timeout: 10_000,
  })
  rmSync(fixture, { recursive: true, force: true })
  return result
}

function controlMigrationHistoryProgram() {
  mkdirSync(resolve(root, '.scratch'), { recursive: true })
  const captureProgram = resolve(root, '.scratch', `control-ledger-program-${process.pid}.mjs`)
  const captureCatalog = resolve(root, '.scratch', `control-ledger-catalog-${process.pid}.txt`)
  const controlCandidate = '92a4fb7d732339927fb3ac0c38c8bbe18f655ad4'
  assert.equal(spawnSync('git', ['cat-file', '-e', `${controlCandidate}^{commit}`], { cwd: root }).status, 0,
    'the accepted Control migration catalog source must remain reachable')
  const result = spawnSync(bashExecutable, ['-s'], {
    cwd: root,
    input: [
      'set -euo pipefail',
      `. '${gitBashPath(resolve(root, 'deploy/selectel/redeploy.sh'))}'`,
      `APP_ROOT=${shellQuote(root)}`,
      `MEMOLY_PRODUCT_SHA=${controlCandidate}`,
      'compose() { printf "%s" "${!#}" > "$CAPTURE_PROGRAM"; printf "%s\\n%%CANDIDATE%%\\n%s" "$MEMOLY_EXPECTED_BASELINE_MIGRATIONS" "$MEMOLY_EXPECTED_CANDIDATE_MIGRATIONS" > "$CAPTURE_CATALOG"; }',
      'rollback_verify_control_migration_history pre-sql',
    ].join('\n'),
    encoding: 'utf8', env: { ...process.env, CAPTURE_PROGRAM: gitBashPath(captureProgram), CAPTURE_CATALOG: gitBashPath(captureCatalog) },
    timeout: 120_000,
  })
  assert.equal(result.status, 0, result.stdout + result.stderr)
  const catalogs = readFileSync(captureCatalog, 'utf8').split('\n%CANDIDATE%\n')
  const program = readFileSync(captureProgram, 'utf8')
  rmSync(captureProgram, { force: true })
  rmSync(captureCatalog, { force: true })
  return { program, baseline: catalogs[0], candidate: catalogs[1] }
}

function runControlMigrationHistoryVerifier({ program, baseline, candidate, phase, rows }) {
  const fixture = mkdtempSync(resolve(root, '.scratch', 'control-migration-ledger-module-'))
  const moduleDir = resolve(fixture, 'node_modules/pg')
  mkdirSync(moduleDir, { recursive: true })
  writeFileSync(resolve(moduleDir, 'package.json'), '{"type":"module","exports":"./index.js"}\n')
  writeFileSync(resolve(moduleDir, 'index.js'), `export class Client {
    async connect() {}
    async query() { return { rows: JSON.parse(process.env.FIXTURE_MIGRATION_ROWS) } }
    async end() {}
  }\n`)
  const result = spawnSync('node', ['--input-type=module', '--eval', program], {
    cwd: fixture, encoding: 'utf8', env: { ...process.env,
      MEMOLY_EXPECTED_BASELINE_MIGRATIONS: baseline,
      MEMOLY_EXPECTED_CANDIDATE_MIGRATIONS: candidate,
      MEMOLY_CONTROL_LEDGER_PHASE: phase,
      FIXTURE_MIGRATION_ROWS: JSON.stringify(rows),
    }, timeout: 10_000,
  })
  rmSync(fixture, { recursive: true, force: true })
  return result
}

test('Control migration ledger accepts only the exact 56-to-57 catalog and complete state', {
  timeout: process.platform === 'win32' ? 180_000 : 60_000,
}, () => {
  const { program, baseline, candidate } = controlMigrationHistoryProgram()
  const names = (catalog) => catalog.trim().split('\n').map((line) => line.split(':'))
  const baselineRows = names(baseline)
  const candidateRows = names(candidate)
  assert.equal(baselineRows.length, 56)
  assert.equal(candidateRows.length, 57)
  assert.deepEqual(candidateRows.slice(0, 56).map(([name]) => name), baselineRows.map(([name]) => name))
  assert.equal(candidateRows[56][0], '20261025100000_control_observability')
  const rowsFor = (catalog, count) => names(catalog).slice(0, count).map(([migration_name, checksum]) => ({
    migration_name, checksum, finished_at: '2026-10-24T10:00:00.000Z', rolled_back_at: null,
  }))
  const verify = (phase, rows, expectedCandidate = candidate) => runControlMigrationHistoryVerifier({
    program, baseline, candidate: expectedCandidate, phase, rows,
  })
  assert.equal(verify('pre-sql', rowsFor(candidate, 56)).status, 0, 'exact completed baseline prefix before SQL')
  assert.equal(verify('pre-sql', rowsFor(candidate, 57)).status, 0, 'fully applied candidate before readiness')
  assert.equal(verify('complete', rowsFor(candidate, 57)).status, 0, 'exact complete candidate')
  assert.notEqual(verify('pre-sql', rowsFor(candidate, 55)).status, 0, 'short baseline')
  assert.notEqual(verify('complete', rowsFor(candidate, 56)).status, 0, 'incomplete candidate')
  assert.notEqual(verify('unknown', rowsFor(candidate, 57)).status, 0, 'unknown phase')
  assert.notEqual(verify('pre-sql', [{ ...rowsFor(candidate, 56)[0], checksum: 'f'.repeat(64) }, ...rowsFor(candidate, 56).slice(1)]).status, 0,
    'changed baseline checksum')
  assert.notEqual(verify('complete', [...rowsFor(candidate, 57).slice(0, 56), { ...rowsFor(candidate, 57)[56], finished_at: null }]).status, 0,
    'unfinished new migration')
  assert.notEqual(verify('complete', [...rowsFor(candidate, 57).slice(0, 56), { ...rowsFor(candidate, 57)[56], rolled_back_at: '2026-10-24T11:00:00.000Z' }]).status, 0,
    'rolled-back new migration')
  assert.notEqual(verify('complete', [...rowsFor(candidate, 57), rowsFor(candidate, 57)[56]]).status, 0, 'duplicate migration')
  const unknownSuffix = [...candidateRows]
  unknownSuffix[56] = ['20261025100000_unreviewed_control', ...unknownSuffix[56].slice(1)]
  assert.notEqual(verify('pre-sql', rowsFor(candidate, 57), unknownSuffix.map((row) => row.join(':')).join('\n') + '\n').status, 0,
    'unknown 57th migration')
})

test('comments migration catalog derives both Prisma newline checksums from committed SQL', () => {
  mkdirSync(resolve(root, '.scratch'), { recursive: true })
  const fixture = mkdtempSync(resolve(root, '.scratch/migration-checksum-fixture-'))
  const repo = resolve(fixture, 'source')
  mkdirSync(resolve(repo, 'backend/prisma/migrations/20261020100000_first'), { recursive: true })
  mkdirSync(resolve(repo, 'backend/prisma/migrations/20261021120000_second'), { recursive: true })
  const firstSql = 'CREATE TABLE first (id uuid);\n'
  const secondSql = 'CREATE TABLE second (id uuid);\r\n'
  writeFileSync(resolve(repo, 'backend/prisma/migrations/20261020100000_first/migration.sql'), firstSql)
  writeFileSync(resolve(repo, 'backend/prisma/migrations/20261021120000_second/migration.sql'), secondSql)
  const git = (...args) => {
    const result = spawnSync('git', args, { cwd: repo, encoding: 'utf8' })
    assert.equal(result.status, 0, result.stderr || result.stdout)
    return result.stdout.trim()
  }
  try {
    git('init', '--quiet')
    git('config', 'user.email', 'migration-checksums@example.invalid')
    git('config', 'user.name', 'Migration checksum fixture')
    git('add', 'backend/prisma/migrations')
    git('commit', '--quiet', '-m', 'migration checksum fixture')
    const hash = (sql) => createHash('sha256').update(sql).digest('hex')
    const normalizedSecondSql = secondSql.replaceAll('\r\n', '\n')
    const result = spawnSync(bashExecutable, ['-s'], {
      cwd: repo,
      input: `${redeployDefinitions}\nAPP_ROOT=${shellQuote(repo)}\nrollback_migration_catalog_checksums HEAD\n`,
      encoding: 'utf8',
      timeout: 10_000,
    })
    assert.equal(result.status, 0, result.stderr || result.stdout)
    assert.equal(result.stdout.trim(), [
      `20261020100000_first:${hash(firstSql)}:${hash(firstSql.replaceAll('\n', '\r\n'))}`,
      `20261021120000_second:${hash(normalizedSecondSql)}:${hash(secondSql)}`,
    ].join('\n'))
  } finally {
    rmSync(fixture, { recursive: true, force: true })
  }
})

slowTest('comments migration ledger accepts only exact source SQL with LF or CRLF checksums', () => {
  const firstSql = 'CREATE TABLE memories (id uuid);\n'
  const secondSql = 'CREATE TABLE comments (id uuid);\n'
  const sha = (sql) => createHash('sha256').update(sql).digest('hex')
  const expected = [
    `20261020100000_memories:${sha(firstSql)}:${sha(firstSql.replaceAll('\n', '\r\n'))}`,
    `20261021120000_comments:${sha(secondSql)}:${sha(secondSql.replaceAll('\n', '\r\n'))}`,
  ].join('\n')
  const result = runMigrationHistoryVerifier({
    expected,
    rows: [
      { migration_name: '20261020100000_memories', checksum: sha(firstSql), finished_at: 'now', rolled_back_at: null },
      { migration_name: '20261021120000_comments', checksum: sha(secondSql.replaceAll('\n', '\r\n')), finished_at: 'now', rolled_back_at: null },
    ],
  })
  assert.equal(result.status, 0, result.stderr || result.stdout)
})

slowTest('comments migration ledger rejects SQL drift, missing or extra migrations, and unfinished entries', () => {
  const sql = 'CREATE TABLE comments (id uuid);\n'
  const sha = (value) => createHash('sha256').update(value).digest('hex')
  const expected = `20261021120000_comments:${sha(sql)}:${sha(sql.replaceAll('\n', '\r\n'))}`
  const row = { migration_name: '20261021120000_comments', checksum: sha(sql), finished_at: 'now', rolled_back_at: null }
  for (const rows of [
    [{ ...row, checksum: sha(sql.replace('uuid', 'text')) }],
    [],
    [row, { ...row, migration_name: '20261022120000_extra' }],
    [{ ...row, migration_name: '20261021120000_different' }],
    [{ ...row, finished_at: null }],
  ]) {
    const result = runMigrationHistoryVerifier({ expected, rows })
    assert.notEqual(result.status, 0, `${JSON.stringify(rows)} unexpectedly passed`)
  }
  const secondSql = 'CREATE TABLE memories (id uuid);\n'
  const secondExpected = [
    expected,
    `20261020100000_memories:${sha(secondSql)}:${sha(secondSql.replaceAll('\n', '\r\n'))}`,
  ].join('\n')
  const duplicate = runMigrationHistoryVerifier({ expected: secondExpected, rows: [row, row] })
  assert.notEqual(duplicate.status, 0, 'duplicate completed migration names unexpectedly passed')
})

for (const [path, contents] of [
    ['backend/src/worker.ts', '\n// changed comments source fixture\n'],
    ['backend/prisma/schema.prisma', '\n// changed schema fixture\n'],
    ['packages/contracts/src/memories.ts', '\n// changed contract fixture\n'],
    ['bun.lock', '\n# changed dependency lock fixture\n'],
    ['backend/package.json', '\n// changed dependency manifest fixture\n'],
]) {
  slowTest(`comments rollback rejects source drift in ${path}`, () => {
    const source = commitSourceChange(createSourceWorktree('comments'), path, contents, 'mutate comments rollback source')
    const result = runApplicationRollback({ target: rollback180, webappTarget: rollback180,
      sourceRootOverride: source.root, sourceShaOverride: source.sha })
    assert.notEqual(result.status, 0, `${path}: ${result.output}`)
    assert.match(result.output, /application runtime differs from the verified rollback source/)
    assert.doesNotMatch(result.events, /UP:|GATE/)
  })
}

slowTest('comments rollback rejects protected service configuration drift', () => {
  const config = commitSourceChange(createSourceWorktree('comments'), 'deploy/selectel/Caddyfile.edge.template',
    '\n# changed protected configuration fixture\n', 'mutate comments service configuration')
  const result = runApplicationRollback({ target: rollback180, webappTarget: rollback180,
    sourceRootOverride: config.root, sourceShaOverride: config.sha })
  assert.notEqual(result.status, 0, result.output)
  assert.match(result.output, /rollback schema, dependencies or service configuration are incompatible/)
  assert.doesNotMatch(result.events, /UP:|GATE/)
})

for (const [name, options, rejection] of [
  ['refuses a different target runtime', { target: rollbackBaseline, webappTarget: rollbackBaseline }, /application runtime differs from the verified rollback source/],
  ['refuses a different immutable image ID', { badImage: true }, /rollback backend image differs from the verified production artifact/],
  ['refuses a mismatched OCI revision label', { badLabel: true }, /rollback backend image revision label mismatch/],
  ['refuses unfinished migration state', { pending: true }, /rollback target cannot confirm completed migrations/],
  ['refuses unknown compatibility state', { stateError: true }, /rollback data compatibility state is unknown or migration is unfinished/],
]) {
  slowTest(`comments rollback ${name} before promotion`, () => {
    const result = runApplicationRollback({ target: rollback180, webappTarget: rollback180,
      source: 'comments', ...options })
    assert.notEqual(result.status, 0, result.output)
    assert.match(result.output, rejection)
    assert.doesNotMatch(result.events, /UP:|GATE/)
  })
}

slowTest('current deploy-procedure source rolls back only to the pinned UI v4 artifact', () => {
  const result = runApplicationRollback({ target: rollbackV4, webappTarget: rollbackV4,
    source: 'selectel' })
  assert.equal(result.status, 0, result.output)
  assert.match(result.output, /rollback complete|Rollback complete|Application rollback complete/i)
  assert.doesNotMatch(result.output, /UI downgrade is forbidden/)
  assert.match(result.events, new RegExp(`GATE\\nUP:${rollbackV4}:.*backend worker scheduler static`))
  assert.doesNotMatch(result.caddy, /rollback_auth_maintenance/)

  const changedSource = commitSourceChange(createSourceWorktree('selectel'), 'backend/src/worker.ts',
    '\n// changed product runtime fixture\n', 'mutate new Selectel rollback source')
  const changed = runApplicationRollback({ target: rollbackV4, webappTarget: rollbackV4,
    sourceRootOverride: changedSource.root, sourceShaOverride: changedSource.sha,
    producer: changedSource.sha })
  assert.notEqual(changed.status, 0, changed.output)
  assert.match(changed.output, /application runtime differs from the verified rollback source/)
  assert.doesNotMatch(changed.events, /UP:|GATE/)
})

slowTest('compatibility fingerprint excludes test harness inputs and rejects production drift', () => {
  mkdirSync(resolve(root, '.scratch'), { recursive: true })
  const fixture = mkdtempSync(resolve(root, '.scratch', 'runtime-fingerprint-'))
  try {
    for (const [path, body] of [
      ['backend/src/app.ts', 'export const app = 1\n'],
      ['backend/scripts/real.test.ts', 'export const test = 1\n'],
      ['backend/scripts/test-support/probe.mjs', 'export const support = 1\n'],
      ['backend/scripts/test-integration.mjs', 'export const integration = 1\n'],
      ['backend/scripts/test-files.mjs', 'export const files = 1\n'],
      ['backend/scripts/test-unit.mjs', 'export const unit = 1\n'],
      ['backend/scripts/test-live.mjs', 'export const live = 1\n'],
      ['backend/src/race-regression-fixtures.ts', 'export const race = 1\n'],
      ['backend/src/zod-compile.probe.ts', 'export const probe = 1\n'],
      ['backend/src/modules/memories/infrastructure/comment-test-fixtures.ts', 'export const comments = 1\n'],
      ['backend/src/outbox/fake-outbox-prisma.ts', 'export const fake = 1\n'],
      ['backend/src/modules/media/fixtures/sample.heic', 'test fixture\n'],
      ['webapp/src/dev/FamilyMaxChannelFixturePage.tsx', 'export const fixture = 1\n'],
      ['webapp/src/dev/FamilyHubFixturePage.tsx', 'export const fixture = 1\n'],
      ['webapp/src/dev/DesignSystemFixturePage.tsx', 'export const fixture = 1\n'],
      ['webapp/tsconfig.e2e.json', '{}\n'],
      ['backend/src/modules/auth/transport/legacy-test-routes.ts', 'export const route = 1\n'],
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
    const initial = productionCompatibilityFingerprint(fixture)

    for (const path of [
      'backend/scripts/real.test.ts', 'backend/scripts/test-support/probe.mjs',
      'backend/scripts/test-integration.mjs', 'backend/scripts/test-files.mjs',
      'backend/scripts/test-unit.mjs', 'backend/scripts/test-live.mjs',
      'backend/src/race-regression-fixtures.ts', 'backend/src/zod-compile.probe.ts',
      'backend/src/modules/memories/infrastructure/comment-test-fixtures.ts',
      'backend/src/outbox/fake-outbox-prisma.ts', 'backend/src/modules/media/fixtures/sample.heic',
      'webapp/src/dev/FamilyMaxChannelFixturePage.tsx', 'webapp/src/dev/FamilyHubFixturePage.tsx',
      'webapp/src/dev/DesignSystemFixturePage.tsx',
      'webapp/e2e/comments.spec.ts', 'webapp/tests/playback.test.tsx',
      'webapp/visualtests/example.spec.ts', 'webapp/tsconfig.e2e.json',
    ]) {
      const target = resolve(fixture, path)
      mkdirSync(resolve(target, '..'), { recursive: true })
      writeFileSync(target, 'changed test-only input\n')
    }
    gitFixtureCommit(fixture, 'change excluded test support')
    assert.equal(productionCompatibilityFingerprint(fixture), initial)

    for (const path of ['backend/src/modules/auth/transport/legacy-test-routes.ts', 'backend/src/worker.ts']) {
      writeFileSync(resolve(fixture, path), 'production drift\n')
      gitFixtureCommit(fixture, `change production input ${path}`)
      assert.notEqual(productionCompatibilityFingerprint(fixture), initial, `${path} remains attested`)
    }
  } finally {
    rmSync(fixture, { recursive: true, force: true })
  }
})

slowTest('rollback guard reaches runtime and service-configuration incompatibility checks', () => {
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

slowTest('rollback guard reports unknown and dirty source states before promotion', () => {
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

slowTest('application rollback fails closed for unknown, incompatible, image, migration, DB and artifact states', () => {
  for (const options of [
    { target: 'f'.repeat(40) }, { producer: rollbackBaseline }, { target: 'f2731e02547fb1118e233c99c47b4ec7c5fc8ba6' },
    { webappTarget: 'a'.repeat(40) }, { stateError: true }, { pending: true },
    { marker: 'b2.marker' }, { marker: 'mm0.marker' }, { badImage: true }, { badLabel: true }, { noBackup: true },
  ]) {
    const result = runApplicationRollback({ target: rollbackV4, webappTarget: rollbackV4, source: 'selectel', ...options })
    assert.notEqual(result.status, 0, JSON.stringify(options) + result.output)
    assert.doesNotMatch(result.events, /UP:/, JSON.stringify(options) + result.events)
  }
})

slowTest('real ci-release failure branch completes guarded application restoration and retains failure status', () => {
  const result = runApplicationRollback({ failure: true, target: rollbackV4, webappTarget: rollbackV4, source: 'selectel' })
  assert.equal(result.status, 42, result.output)
  assert.match(result.output, /attempting application rollback/)
  assert.match(result.output, /Application rollback complete/)
  assert.doesNotMatch(result.output, /automatic application rollback failed/)
  assert.match(result.events, /GATE\nUP:.*backend worker scheduler static/)
  assert.doesNotMatch(result.caddy, /rollback_auth_maintenance/)
  const failed = runApplicationRollback({ failure: true, target: rollbackV4, webappTarget: rollbackV4,
    source: 'selectel', stateError: true })
  assert.equal(failed.status, 42, failed.output)
  assert.match(failed.output, /automatic application rollback failed/)
  assert.doesNotMatch(failed.events, /UP:/)

  const candidate = runApplicationRollback({ failure: true, source: 'candidate', target: rollback180, webappTarget: rollback180 })
  assert.equal(candidate.status, 42, candidate.output)
  assert.match(candidate.output, /UI downgrade is forbidden/)
  assert.match(candidate.output, /automatic application rollback failed/)
  assert.doesNotMatch(candidate.events, /UP:/)
  assert.doesNotMatch(candidate.caddy, /rollback_auth_maintenance/)

  const blocked = runApplicationRollback({ failure: true, source: 'selectel', target: rollbackV4,
    webappTarget: rollbackV4, badAuthResponse: true })
  assert.equal(blocked.status, 42, blocked.output)
  assert.match(blocked.output, /normal authentication routing is not active/)
  assert.doesNotMatch(blocked.events, /UP:/)

  const restorationFailure = runApplicationRollback({ failure: true, source: 'selectel', target: rollbackV4,
    webappTarget: rollbackV4, promotionFail: true })
  assert.equal(restorationFailure.status, 42, restorationFailure.output)
  assert.match(restorationFailure.output, /automatic application rollback failed/)
  assert.match(restorationFailure.events, /GATE\nUP:/)
})

test('normal promotion validates its prepared rollback UI before any mutation', () => {
  for (const failure of ['none', 'require_accepted_ui_target', 'verify_application_rollback', 'validate_database_target', 'backup_database']) {
    const result = spawnSync(bashExecutable, ['-s'], { encoding: 'utf8', input: [
      'set -euo pipefail',
      `. '${gitBashPath(resolve(root, 'deploy/selectel/redeploy.sh'))}'`,
      'MM0_BOUNDARY=false; FORWARD_MARKER=/nonexistent-selectel-marker',
      'die() { echo "DIE:$*"; exit 19; }',
      'read_static_rollback_tag() { PREVIOUS_WEBAPP_IMAGE_TAG=4b4edc0992803b84c919aadb835e8d2e21095c51; echo STEP:read_static_rollback_tag; }',
      `require_accepted_ui_target() { [ "${failure}" != require_accepted_ui_target ] && [ "$1" = 4b4edc0992803b84c919aadb835e8d2e21095c51 ] || return 42; echo STEP:require_accepted_ui_target; }`,
      ...['guard_membership_transition', 'preflight', 'backup_server_state', 'verify_application_rollback',
        'validate_database_target', 'backup_database', 'prepare_configuration', 'migration_status',
        'promote_backend', 'wait_backend_internal', 'promote_jobs', 'promote_static',
        'verify_static_internal', 'activate_gateway', 'readiness'].map((name) =>
        name + '() { echo STEP:' + name + '; return ' + (name === failure ? 42 : 0) + '; }'),
      'deploy',
    ].join('\n') })
    const output = result.stdout + result.stderr
    if (failure === 'none') {
      assert.equal(result.status, 0, output)
      assert.match(output, /STEP:read_static_rollback_tag\nSTEP:require_accepted_ui_target\nSTEP:guard_membership_transition/)
      assert.match(output, /STEP:verify_application_rollback\nSTEP:validate_database_target\nSTEP:backup_database\nSTEP:prepare_configuration/)
    } else {
      assert.notEqual(result.status, 0, output)
      assert.doesNotMatch(output, /STEP:promote_backend/)
      if (failure === 'require_accepted_ui_target') {
        assert.doesNotMatch(output, /STEP:guard_membership_transition|STEP:backup_server_state|STEP:prepare_configuration/)
      }
    }
  }
})

test('guarded full release forces complete ledger readiness after SQL and before promotion', () => {
  const runRelease = (failure = 'none') => {
    mkdirSync(resolve(root, '.scratch'), { recursive: true })
    const fixture = mkdtempSync(resolve(root, '.scratch', 'albums-release-order-'))
    const server = resolve(fixture, 'server')
    mkdirSync(server, { recursive: true })
    const events = resolve(fixture, 'events')
    const source = [
      `. ${shellQuote(resolve(root, 'deploy/selectel/ci-release.sh'))}`,
      `SERVER_ROOT=${shellQuote(server)}; APP_ROOT=${shellQuote(root)}; SCRIPT_DIR=${shellQuote(resolve(root, 'deploy/selectel'))}`,
      'PRODUCT_SHA=0000000000000000000000000000000000000000; RUN_MIGRATION=true; RELEASE_MODE=full; PREBUILT_IMAGES=true',
      'LEGACY_MEMBERSHIP_RUNTIME=false; LEGACY_MM0_RUNTIME=false; RESUMING_FORWARD_ONLY=false; RESUMING_MM0=false',
      'require_root() { :; }; require_command() { :; }; validate_inputs() { :; }; validate_frontend_recovery_path() { :; }',
      'validate_repository() { :; }; validate_planned_source() { :; }; capture_frontend_recovery_artifact() { :; }',
      'recover_forward_markers() { :; }; check_disk_space() { :; }; verify_rollback_file() { :; }; capture_running_images() { :; }',
      'fetch_and_checkout() { :; }; verify_frontend_recovery_artifact_unchanged() { :; }; validate_prebuilt_images() { :; }',
      'detect_membership_rollback_boundary() { :; }; detect_mm0_boundary() { :; }; prepare_rollback() { echo PREPARE >> "$FIXTURE_EVENTS"; [ "$FIXTURE_FAILURE" != pre ] || return 42; }',
      'flock() { :; }; bash() { local action=${!#}; echo "$action:${SELECTEL_ALBUMS_LEDGER_PHASE:-unset}:${SELECTEL_MAX_VIDEO_LEDGER_PHASE:-unset}" >> "$FIXTURE_EVENTS"; if [ "$action" = migrate ]; then SELECTEL_ALBUMS_LEDGER_PHASE=pre-sql; fi; if [ "$action" = rollback-readiness ] && [ "${SELECTEL_ALBUMS_LEDGER_PHASE:-}" = complete ] && [ "${SELECTEL_MAX_VIDEO_LEDGER_PHASE:-}" = complete ] && [ "$FIXTURE_FAILURE" = post ]; then return 42; fi; }',
      'promote_runtime() { echo PROMOTE >> "$FIXTURE_EVENTS"; }; verify_promoted_revision() { :; }; public_smoke() { :; }',
      'write_release_manifest() { :; }; write_control_release_receipt() { :; }; clear_release_markers() { :; }; archive_frontend_recovery_artifact() { :; }',
      'install_control_sampler() { echo CONTROL-SAMPLER-INSTALLED >> "$FIXTURE_EVENTS"; }',
      'SELECTEL_ALBUMS_LEDGER_PHASE=pre-sql; SELECTEL_MAX_VIDEO_LEDGER_PHASE=pre-sql; FIXTURE_EVENTS=' + shellQuote(events) + '; FIXTURE_FAILURE=' + shellQuote(failure),
      'main',
    ].join('\n')
    try {
      const result = spawnSync(bashExecutable, ['-s'], { cwd: root, input: source, encoding: 'utf8', timeout: 30_000 })
      const actual = existsSync(events) ? readFileSync(events, 'utf8').trim().split('\n').filter(Boolean) : []
      return { result, actual }
    } finally { rmSync(fixture, { recursive: true, force: true }) }
  }

  const success = runRelease()
  assert.equal(success.result.status, 0, success.result.stdout + success.result.stderr)
  const sequence = ['PREPARE', 'preflight:pre-sql:pre-sql', 'migrate:pre-sql:pre-sql', 'migration-status:pre-sql:pre-sql',
    'rollback-readiness:complete:complete', 'PROMOTE']
  let cursor = -1
  for (const expected of sequence) {
    const next = success.actual.indexOf(expected, cursor + 1)
    assert.notEqual(next, -1, `missing or out-of-order ${expected}: ${success.actual.join(', ')}`)
    cursor = next
  }

  const postFailure = runRelease('post')
  assert.notEqual(postFailure.result.status, 0, postFailure.result.stdout + postFailure.result.stderr)
  assert.ok(postFailure.actual.includes('rollback-readiness:complete:complete'), postFailure.actual.join(', '))
  assert.ok(postFailure.actual.includes('migration-status:pre-sql:pre-sql'), postFailure.actual.join(', '))
  assert.ok(!postFailure.actual.includes('PROMOTE'), postFailure.actual.join(', '))

  const preFailure = runRelease('pre')
  assert.notEqual(preFailure.result.status, 0, preFailure.result.stdout + preFailure.result.stderr)
  assert.ok(preFailure.actual.includes('PREPARE'), preFailure.actual.join(', '))
  assert.ok(!preFailure.actual.some((event) => event.startsWith('preflight:') || event.startsWith('migrate:') || event === 'PROMOTE'),
    preFailure.actual.join(', '))
})

function wishlistMigrationHistoryProgram(includeChild = false) {
  mkdirSync(resolve(root, '.scratch'), { recursive: true })
  const directory = mkdtempSync(resolve(root, '.scratch/wishlist-ledger-source-'))
  const added = spawnSync('git', ['worktree', 'add', '--detach', directory, 'b4cdbbc49500d0850a64075d1bfba683a9bd22ad'], { cwd: root, encoding: 'utf8' })
  if (added.status !== 0) throw new Error(added.stdout + added.stderr)
  fixtureWorktrees.push(directory)
  const migrations = [
    '20261023120000_gift_wishlist',
    '20261024120000_gift_photo_recovery_guard',
    ...(includeChild ? ['20261024100000_memory_child_tags'] : []),
  ]
  for (const name of migrations) {
    const target = resolve(directory, 'backend/prisma/migrations', name)
    mkdirSync(target, { recursive: true })
    writeFileSync(resolve(target, 'migration.sql'), readFileSync(resolve(root, 'backend/prisma/migrations', name, 'migration.sql')))
  }
  const staged = spawnSync('git', ['add', '--', ...migrations.map((name) => `backend/prisma/migrations/${name}/migration.sql`)], { cwd: directory, encoding: 'utf8' })
  if (staged.status !== 0) throw new Error(staged.stdout + staged.stderr)
  const committed = spawnSync('git', ['-c', 'user.name=Recovery Fixture', '-c', 'user.email=recovery-fixture@example.invalid', 'commit', '--quiet', '-m', 'create isolated wishlist migration catalog fixture'], { cwd: directory, encoding: 'utf8' })
  if (committed.status !== 0) throw new Error(committed.stdout + committed.stderr)
  const sha = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: directory, encoding: 'utf8' }).stdout.trim()
  const captureProgram = resolve(root, '.scratch', `wishlist-ledger-program-${process.pid}.mjs`)
  const captureCatalog = resolve(root, '.scratch', `wishlist-ledger-catalog-${process.pid}.txt`)
  const result = spawnSync(bashExecutable, ['-s'], {
    cwd: root,
    input: [
      'set -euo pipefail',
      `. '${gitBashPath(resolve(root, 'deploy/selectel/redeploy.sh'))}'`,
      `APP_ROOT=${shellQuote(directory)}`,
      `MEMOLY_PRODUCT_SHA=${sha}`,
      'compose() { printf "%s" "${!#}" > "$CAPTURE_SCRIPT"; printf "%s\n%%CANDIDATE%%\n%s" "$MEMOLY_EXPECTED_BASELINE_MIGRATIONS" "$MEMOLY_EXPECTED_CANDIDATE_MIGRATIONS" > "$CAPTURE_CATALOG"; }',
      'rollback_verify_wishlist_migration_history pre-sql',
    ].join('\n'),
    encoding: 'utf8',
    env: { ...process.env, CAPTURE_SCRIPT: gitBashPath(captureProgram), CAPTURE_CATALOG: gitBashPath(captureCatalog) },
    timeout: 120_000,
  })
  assert.equal(result.status, 0, result.stdout + result.stderr)
  const catalogs = readFileSync(captureCatalog, 'utf8').split('\n%CANDIDATE%\n')
  const program = readFileSync(captureProgram, 'utf8')
  rmSync(captureProgram, { force: true })
  rmSync(captureCatalog, { force: true })
  return { program, baseline: catalogs[0], candidate: catalogs[1], source: directory, sha }
}

function runWishlistMigrationHistoryVerifier({ program, baseline, candidate, phase, rows, queryError = false }) {
  const fixture = mkdtempSync(resolve(root, '.scratch', 'wishlist-migration-ledger-module-'))
  const moduleDir = resolve(fixture, 'node_modules/pg')
  mkdirSync(moduleDir, { recursive: true })
  writeFileSync(resolve(moduleDir, 'package.json'), '{"type":"module","exports":"./index.js"}\n')
  writeFileSync(resolve(moduleDir, 'index.js'), `export class Client {
    async connect() {}
    async query() { if (process.env.FIXTURE_MIGRATION_QUERY_ERROR === 'true') throw new Error('synthetic query failure'); return { rows: JSON.parse(process.env.FIXTURE_MIGRATION_ROWS) } }
    async end() {}
  }\n`)
  const result = spawnSync('node', ['--input-type=module', '--eval', program], {
    cwd: fixture,
    encoding: 'utf8',
    env: { ...process.env, MEMOLY_EXPECTED_BASELINE_MIGRATIONS: baseline,
      MEMOLY_EXPECTED_CANDIDATE_MIGRATIONS: candidate, MEMOLY_WISHLIST_LEDGER_PHASE: phase,
      FIXTURE_MIGRATION_QUERY_ERROR: String(queryError),
      FIXTURE_MIGRATION_ROWS: JSON.stringify(rows) },
    timeout: 10_000,
  })
  rmSync(fixture, { recursive: true, force: true })
  return result
}

test('wishlist recovery preserves exact 53/54/55 history semantics and child recovery accepts only exact 53/54/55/56 states', {
  timeout: process.platform === 'win32' ? 180_000 : 60_000,
}, () => {
  const oldSource = wishlistMigrationHistoryProgram()
  const childSource = wishlistMigrationHistoryProgram(true)
  const { program, baseline } = childSource
  const lines = (value) => value.trim().split('\n').map((line) => {
    const [migration_name, checksum] = line.split(':')
    return { migration_name, checksum, finished_at: '2026-10-24T00:00:00.000Z', rolled_back_at: null }
  })
  const baselineRows = lines(baseline)
  const oldCandidateRows = lines(oldSource.candidate)
  const candidateRows = lines(childSource.candidate)
  const giftRow = candidateRows.find(({ migration_name }) => migration_name === '20261023120000_gift_wishlist')
  const guardRow = candidateRows.find(({ migration_name }) => migration_name === '20261024120000_gift_photo_recovery_guard')
  assert.equal(baselineRows.length, 53)
  assert.equal(oldCandidateRows.length, 55)
  assert.equal(candidateRows.length, 56)
  assert.ok(giftRow)
  assert.ok(guardRow)
  const childRow = candidateRows.find(({ migration_name }) => migration_name === '20261024100000_memory_child_tags')
  assert.ok(childRow)
  const verify = (phase, rows, candidate = childSource.candidate) => runWishlistMigrationHistoryVerifier({ program, baseline, candidate, phase, rows })
  const oldVerify = (phase, rows) => runWishlistMigrationHistoryVerifier({ program, baseline, candidate: oldSource.candidate, phase, rows })
  const oldGift = oldCandidateRows.find(({ migration_name }) => migration_name === '20261023120000_gift_wishlist')
  const oldGuard = oldCandidateRows.find(({ migration_name }) => migration_name === '20261024120000_gift_photo_recovery_guard')
  assert.equal(oldVerify('pre-sql', baselineRows).status, 0, 'exact deployed baseline is accepted before SQL')
  assert.equal(oldVerify('pre-sql', [...baselineRows, oldGift]).status, 0, 'exact gift migration prefix is accepted before SQL')
  assert.equal(oldVerify('pre-sql', oldCandidateRows).status, 0, 'exact fully applied old candidate is accepted before SQL recovery')
  assert.equal(oldVerify('complete', oldCandidateRows).status, 0, 'exact 55-migration old state is accepted after SQL')
  assert.notEqual(oldVerify('complete', [...baselineRows, oldGift]).status, 0, 'old complete state missing recovery guard is rejected')
  assert.equal(verify('pre-sql', baselineRows).status, 0, 'exact deployed baseline is accepted before child SQL')
  assert.equal(verify('pre-sql', [...baselineRows, giftRow]).status, 0, 'exact 54 state is accepted before child SQL')
  assert.equal(verify('pre-sql', [...baselineRows, oldGift, oldGuard]).status, 0, 'deployed 55 state with later guard is accepted despite timestamp ordering')
  assert.equal(verify('pre-sql', candidateRows).status, 0, 'exact fully applied 56 candidate is accepted before SQL recovery')
  assert.equal(verify('complete', candidateRows).status, 0, 'exact 56-migration state is accepted after SQL')
  assert.notEqual(verify('complete', [...baselineRows, oldGift, oldGuard]).status, 0, 'complete child state missing child migration is rejected')
  assert.notEqual(verify('pre-sql', [...baselineRows, giftRow, { ...guardRow, migration_name: '20990101000000_unrelated' }]).status, 0, 'arbitrary extra migration is rejected')
  assert.notEqual(verify('pre-sql', [...baselineRows.slice(0, 9), ...baselineRows.slice(10), giftRow, guardRow, childRow]).status, 0, 'dropped baseline migration is rejected')
  assert.notEqual(verify('pre-sql', [{ ...baselineRows[0], checksum: 'f'.repeat(64) }, ...baselineRows.slice(1)]).status, 0, 'baseline checksum mutation is rejected')
  assert.notEqual(verify('pre-sql', candidateRows.map((row) => row.migration_name === childRow.migration_name
    ? { ...row, checksum: 'f'.repeat(64) } : row)).status, 0, 'child migration checksum mutation is rejected')
  assert.notEqual(verify('pre-sql', [baselineRows[0], baselineRows[0], ...baselineRows.slice(1, 51), giftRow, guardRow, childRow]).status, 0, 'duplicate migration is rejected')
  assert.notEqual(verify('pre-sql', candidateRows.map((row) => row.migration_name === childRow.migration_name
    ? { ...row, finished_at: null } : row)).status, 0, 'unfinished migration is rejected')
  assert.notEqual(verify('pre-sql', candidateRows.map((row) => row.migration_name === childRow.migration_name
    ? { ...row, rolled_back_at: '2026-10-24T00:01:00.000Z' } : row)).status, 0, 'rolled-back migration is rejected')
  assert.notEqual(verify('unknown', candidateRows).status, 0, 'unknown phase is rejected')
  assert.notEqual(runWishlistMigrationHistoryVerifier({ program, baseline, candidate: childSource.candidate, phase: 'complete', rows: candidateRows, queryError: true }).status, 0,
    'migration query errors are rejected')

  const fixture = mkdtempSync(resolve(root, '.scratch', 'wishlist-pre-sql-lock-'))
  try {
    const serverRoot = resolve(fixture, 'server')
    mkdirSync(serverRoot, { recursive: true })
    const lockProbe = spawnSync(bashExecutable, ['-s'], {
      cwd: root,
      input: [
        redeployDefinitions,
        `SERVER_ROOT=${shellQuote(serverRoot)}`,
        'SELECTEL_WISHLIST_LEDGER_PHASE=pre-sql',
        'SELECTEL_CI_RELEASE=true',
        'SELECTEL_DEPLOY_LOCK_FD=9',
        'verify_application_rollback() { echo VERIFY_MUST_NOT_RUN; }',
        'rollback_readiness',
      ].join('\n'),
      encoding: 'utf8', timeout: 30_000,
    })
    assert.notEqual(lockProbe.status, 0, lockProbe.stdout + lockProbe.stderr)
    assert.match(`${lockProbe.stdout}${lockProbe.stderr}`, /pre-SQL migration readiness lock/)
    assert.doesNotMatch(`${lockProbe.stdout}${lockProbe.stderr}`, /VERIFY_MUST_NOT_RUN/)
  } finally { rmSync(fixture, { recursive: true, force: true }) }
})

test('wishlist recovery profile is pinned to the exact executable inputs and dc26 target without producer reachability', {
  timeout: process.platform === 'win32' ? 180_000 : 60_000,
}, () => {
  const baseline = 'b4cdbbc49500d0850a64075d1bfba683a9bd22ad'
  const target = '33a0054c3c71372aa5509ee8ebfa4578ad512ea1'
  const expectedAnchor = 'dc26ad9bb5ebcfe64643414fad90d53fcb3b1c92'
  const expectedWishlistCompatibility = '9bc6fdc22b85fe68e04ab387c1d9ce3c4f8a01471c177f1b61d9ae07bbde13c8'
  const expectedGiftUrlCompatibility = 'fbffd1ed775d360a0308b39dad80feb903d865c8588b41a5a03bddb4b9c4efc4'
  const expectedAlbumPortalCompatibility = 'e0654e5c48ee35800754e7d784ad3b0af1bd5ff5cb7a860e4f3a063ee8609b67'
  assert.equal(productionRuntimeFingerprint(root, expectedAnchor),
    '2be6fc2b96f4731c4ea3821b50f112c01d8e9a62da57eeb6675f8513fd26b088')
  const sourceDirectory = mkdtempSync(resolve(root, '.scratch', 'rollback-wishlist-source-'))
  const sourceAdded = spawnSync('git', ['worktree', 'add', '--detach', sourceDirectory, baseline], { cwd: root, encoding: 'utf8' })
  if (sourceAdded.status !== 0) throw new Error(sourceAdded.stdout + sourceAdded.stderr)
  fixtureWorktrees.push(sourceDirectory)
  const wishlistSource = commitFrozenSourceFiles({ root: sourceDirectory, sha: baseline }, reviewedWishlistProductionBlobs,
    'materialize exact wishlist compatibility source from committed production blobs')
  assert.equal(productionCompatibilityFingerprint(wishlistSource.root), expectedWishlistCompatibility)
  assert.equal(spawnSync('git', ['rev-parse', `${wishlistSource.sha}^`], { cwd: wishlistSource.root, encoding: 'utf8' }).stdout.trim(), baseline)
  const source = commitFrozenSourceFiles(wishlistSource, reviewedGiftUrlProductionBlobs,
    'overlay exact gift URL metadata production blobs')
  assert.equal(productionCompatibilityFingerprint(source.root), expectedGiftUrlCompatibility)
  const albumPortalSource = commitFrozenSourceFiles(source,
    [['webapp/src/features/albums/albums.css', '294d51e2f3a46d5e61c890c00c47601bd95dd268']],
    'overlay exact album portal layering production blob')
  assert.equal(productionCompatibilityFingerprint(albumPortalSource.root), expectedAlbumPortalCompatibility)

  const profile = (source) => spawnSync(bashExecutable, ['-s'], {
    cwd: root,
    input: `${redeployDefinitions}\nAPP_ROOT=${shellQuote(source.root)}\nMEMOLY_PRODUCT_SHA=${source.sha}\nrollback_source_compatibility_profile "$MEMOLY_PRODUCT_SHA" ${target}\n`,
    encoding: 'utf8', timeout: 30_000,
  })
  const accepted = profile(source)
  assert.equal(accepted.status, 0, accepted.stdout + accepted.stderr)
  assert.equal(accepted.stdout.trim().split('\n').at(-1), 'wishlist')

  const acceptedAlbumPortal = profile(albumPortalSource)
  assert.equal(acceptedAlbumPortal.status, 0, acceptedAlbumPortal.stdout + acceptedAlbumPortal.stderr)
  assert.equal(acceptedAlbumPortal.stdout.trim().split('\n').at(-1), 'wishlist')

  const existingWishlist = profile(wishlistSource)
  assert.equal(existingWishlist.status, 0, existingWishlist.stdout + existingWishlist.stderr)
  assert.equal(existingWishlist.stdout.trim().split('\n').at(-1), 'wishlist')

  const driftDirectory = mkdtempSync(resolve(root, '.scratch', 'rollback-wishlist-drift-'))
  const driftAdded = spawnSync('git', ['worktree', 'add', '--detach', driftDirectory, source.sha], { cwd: root, encoding: 'utf8' })
  if (driftAdded.status !== 0) throw new Error(driftAdded.stdout + driftAdded.stderr)
  fixtureWorktrees.push(driftDirectory)
  const mutated = commitSourceChange({ root: driftDirectory, sha: source.sha },
    'backend/src/modules/gifts/application/gift-service.ts',
    '\n// synthetic release compatibility drift control\n', 'mutate a frozen gift production input')
  const rejected = profile(mutated)
  assert.notEqual(rejected.status, 0, 'changed production source must not inherit the wishlist recovery permission')

  const albumDriftDirectory = mkdtempSync(resolve(root, '.scratch', 'rollback-wishlist-album-drift-'))
  const albumDriftAdded = spawnSync('git', ['worktree', 'add', '--detach', albumDriftDirectory, albumPortalSource.sha], { cwd: root, encoding: 'utf8' })
  if (albumDriftAdded.status !== 0) throw new Error(albumDriftAdded.stdout + albumDriftAdded.stderr)
  fixtureWorktrees.push(albumDriftDirectory)
  const albumMutated = commitSourceChange({ root: albumDriftDirectory, sha: albumPortalSource.sha },
    'webapp/src/features/albums/albums.css',
    '\n/* synthetic album production compatibility drift control */\n', 'mutate a frozen album production input')
  const albumRejected = profile(albumMutated)
  assert.notEqual(albumRejected.status, 0, 'changed album production CSS must not inherit the wishlist recovery permission')
})

test('Control recovery permits only its exact current executable fingerprint and pinned host inputs on target 33a', {
  timeout: process.platform === 'win32' ? 240_000 : 90_000,
}, () => {
  const baseline = 'a7e1e0781d51ceb58fb1f7784c1a69f9c066fca4'
  const target = '33a0054c3c71372aa5509ee8ebfa4578ad512ea1'
  const expectedAnchor = 'dc26ad9bb5ebcfe64643414fad90d53fcb3b1c92'
  const expectedRuntime = '2be6fc2b96f4731c4ea3821b50f112c01d8e9a62da57eeb6675f8513fd26b088'
  const expectedCompatibility = 'b975c2a1a84bffe4a431408ac10da4cdabfbe343135d237abc2f5a6e4f0ec538'
  assert.equal(productionRuntimeFingerprint(root, expectedAnchor), expectedRuntime)
  const files = [
    ['backend/.env.example', '07d6bf4a7384d7f12fa0075cd3719ecef446e92a'],
    ['backend/prisma/migrations/20261025100000_control_observability/migration.sql', 'd96d578a5eeabc86eca437d4f744e0eb2db7eaac'],
    ['backend/prisma/schema.prisma', '939d86067b1e5d8b3a053bec980ffcfaea0d2aad'],
    ['backend/src/app.ts', '3a72798f1c9e9afa79fc4a3e90d007f8849d056b'],
    ['backend/src/env.ts', '3e6702dad1bd1ca9d62409d9e5db0fbeaaae63b1'],
    ['backend/src/job-schedules.json', 'f57bf2c0b480edc4209643b3ba1294cd0e84fb79'],
    ['backend/src/jobs.ts', '7b1769d757f1de971ca1ed6092c348f8c16957fc'],
    ['backend/src/modules/control/application/control-helpers.ts', '583d776719b6855f9a63c27dbaa6c84f90af886b'],
    ['backend/src/modules/control/index.ts', '6ac3d9371bb3d0d30ccb6ef4309fded5f1db0cf0'],
    ['backend/src/modules/control/infrastructure/control-collection.ts', '1e9e0b870dd802b4b136cca0e03d66dedadb0179'],
    ['backend/src/modules/control/infrastructure/control-read-repository.ts', '21df9c044bfd58fbe17fcad1e37b65bdc0e3c897'],
    ['backend/src/scheduler.ts', '33a8e40f525c760ea2d803123ca5c4ffa1a1a401'],
    ['backend/src/worker.ts', 'e1fceab1cd692b6649f10be7bfa2db8f19e0f3f3'],
    ['packages/contracts/src/control.ts', '1e458a2a717ef6e6447fb9475d3d9f74e4e27b80'],
    ['packages/contracts/src/index.ts', '975ba77ffb5068b2167d49387da4d90c3c9c6495'],
    ['webapp/control/index.html', '66fdf3d814cbfbfb4164b6b106a9c8bea3ba2b60'],
    ['webapp/src/App.tsx', '3f616bc419fc73eb7da7ec03bc77565316afe2bc'],
    ['webapp/src/components/ui/command.tsx', 'b3e700adee5551cd7bd666ee8b50bda7ec8af2b2'],
    ['webapp/src/components/ui/dialog.tsx', '61584b8490d13c4c022ce58c8c33b51079a201ff'],
    ['webapp/src/components/ui/select.tsx', 'f8082aae1f58159fc419423e4d9a56ae48262fca'],
    ['webapp/src/components/ui/sheet.tsx', '66c59f950d68b4ce9d3f229e893612b3d7b0d608'],
    ['webapp/src/control/ControlApp.tsx', 'f06612f17e82e5cba042e6a9af91e9a7a48eda8a'],
    ['webapp/src/control/control-api.ts', '9736c43b1d966c05bbbf4d20d83cafb89cbfa7a4'],
    ['webapp/src/control/control.css', '83bd2f101391a56fd56a32ed223b497e86742472'],
    ['webapp/src/control/main.tsx', '2c144606a1eb9c134a5627bd5f6584a4fc54e29c'],
    ['webapp/src/features/memoly-ui/SettingsSheet.tsx', '9d9bf8c317791f365c00a593cc11691d123bdf2c'],
    ['webapp/src/features/auth/index.ts', '9883ad57330b016a8b3fb3fc3a3d5fa575a4e81e'],
    ['webapp/src/platform/control-activity.ts', '71898872aeb1c910ab45ca6f65521bcaaa38b4e3'],
    ['webapp/vite.config.ts', '65f4e171cb9cf1835fdd94a0ed7d99f0b9b0b9aa'],
    ['deploy/selectel/control/sampler.py', 'fbbc06bc8b62d86f0fe7685ee6651adf7da48898'],
    ['deploy/selectel/control/memoly-control-sampler.service', '7b4b900ce078e47e1fedd59d9e6928ec8efc31a6'],
    ['deploy/selectel/control/memoly-control-sampler.timer', '5399165d2e405d443bffdc5c76c519a189707f90'],
    ['deploy/selectel/compose.yml.template', '977ed58350e849f52e530dde5976acb7b0ac6051'],
    ['deploy/selectel/Caddyfile.static.template', 'b97f014fa6882141f8d8d6038afb50f9757d9d83'],
    ['deploy/selectel/ci-release.sh', 'f11f9b7f0b8ec0b381ab0508b15a4e58cd539cad'],
  ]
  mkdirSync(resolve(root, '.scratch'), { recursive: true })
  const sourceDirectory = mkdtempSync(resolve(root, '.scratch', 'rollback-control-source-'))
  const added = spawnSync('git', ['worktree', 'add', '--detach', sourceDirectory, baseline], { cwd: root, encoding: 'utf8' })
  if (added.status !== 0) throw new Error(added.stdout + added.stderr)
  fixtureWorktrees.push(sourceDirectory)
  const source = commitFrozenSourceFiles({ root: sourceDirectory, sha: baseline }, files,
    'materialize exact Control recovery production and host-input blobs')
  assert.equal(productionCompatibilityFingerprint(source.root), expectedCompatibility)

  const profile = (candidate) => spawnSync(bashExecutable, ['-s'], {
    cwd: root,
    input: `${redeployDefinitions}\nAPP_ROOT=${shellQuote(candidate.root)}\nrollback_source_compatibility_profile ${candidate.sha} ${target}\n`,
    encoding: 'utf8', timeout: 30_000,
  })
  const accepted = profile(source)
  assert.equal(accepted.status, 0, accepted.stdout + accepted.stderr)
  assert.equal(accepted.stdout.trim().split('\n').at(-1), 'control')

  for (const [path, marker] of [
    ['backend/src/modules/control/infrastructure/control-collection.ts', '\n// synthetic Control source drift\n'],
    ['backend/prisma/migrations/20261025100000_control_observability/migration.sql', '\n-- synthetic migration drift\n'],
    ['deploy/selectel/compose.yml.template', '\n# synthetic compose drift\n'],
    ['deploy/selectel/Caddyfile.static.template', '\n# synthetic static Caddy drift\n'],
  ]) {
    const driftDirectory = mkdtempSync(resolve(root, '.scratch', 'rollback-control-drift-'))
    const driftAdded = spawnSync('git', ['worktree', 'add', '--detach', driftDirectory, source.sha], { cwd: root, encoding: 'utf8' })
    if (driftAdded.status !== 0) throw new Error(driftAdded.stdout + driftAdded.stderr)
    fixtureWorktrees.push(driftDirectory)
    const mutated = commitSourceChange({ root: driftDirectory, sha: source.sha }, path, marker,
      `mutate exact Control recovery input ${path}`)
    const rejected = profile(mutated)
    assert.notEqual(rejected.status, 0, `Control profile must reject changed source before any service mutation: ${path}`)
    assert.doesNotMatch(`${rejected.stdout}${rejected.stderr}`, /UP:|GATE/)
  }
})

test('member avatar frontend retains only the measured d299 MAX recovery pair', {
  timeout: process.platform === 'win32' ? 240_000 : 90_000,
}, () => {
  const baseline = maxVideoRecoveryBackend
  const target = maxVideoRecoveryBackend
  const expectedCompatibility = 'a4d194873593bc2c0770e8ee491e295075cf9f60a39550f3f7bbaaebb55b17f9'
  assert.equal(productionRuntimeFingerprint(root, baseline), maxVideoRecoveryRuntime)
  mkdirSync(resolve(root, '.scratch'), { recursive: true })
  const sourceDirectory = mkdtempSync(resolve(root, '.scratch', 'rollback-member-avatar-source-'))
  const added = spawnSync('git', ['worktree', 'add', '--detach', sourceDirectory, baseline], { cwd: root, encoding: 'utf8' })
  if (added.status !== 0) throw new Error(added.stdout + added.stderr)
  fixtureWorktrees.push(sourceDirectory)
  const source = commitFrozenSourceFilesFromHead({ root: sourceDirectory, sha: baseline }, reviewedMemberAvatarProductionBlobs,
    'apply exact member-avatar production blobs')
  const installed = commitSourceFile({ root: source.root, sha: source.sha }, 'deploy/selectel/ci-release.sh',
    readFileSync(resolve(root, 'deploy/selectel/ci-release.sh'), 'utf8'),
    'pin the exact accepted MAX rollback verifier installer')
  assert.equal(productionCompatibilityFingerprint(installed.root), expectedCompatibility)

  const profile = (candidate, rollbackTarget = target) => spawnSync(bashExecutable, ['-s'], {
    cwd: root,
    input: `${redeployDefinitions}\nAPP_ROOT=${shellQuote(candidate.root)}\nMEMOLY_PRODUCT_SHA=${candidate.sha}\nrollback_source_compatibility_profile "$MEMOLY_PRODUCT_SHA" ${rollbackTarget}\n`,
    encoding: 'utf8', timeout: 30_000,
  })
  const accepted = profile(installed)
  assert.equal(accepted.status, 0, accepted.stdout + accepted.stderr)
  assert.equal(accepted.stdout.trim().split('\n').at(-1), 'max-video')

  const oldTarget = profile(installed, rollbackHealthy)
  assert.notEqual(oldTarget.status, 0, 'the avatar candidate must not reuse the incompatible 33a pair')

  for (const [relativePath, marker] of [
    ['webapp/src/features/avatar/member-avatar-directory.tsx', '\n// synthetic member-avatar source drift\n'],
    ['backend/src/app.ts', '\n// synthetic backend production drift\n'],
    ['backend/prisma/schema.prisma', '\n// synthetic schema drift\n'],
  ]) {
    const driftDirectory = mkdtempSync(resolve(root, '.scratch', 'rollback-member-avatar-drift-'))
    const driftAdded = spawnSync('git', ['worktree', 'add', '--detach', driftDirectory, installed.sha], { cwd: root, encoding: 'utf8' })
    if (driftAdded.status !== 0) throw new Error(driftAdded.stdout + driftAdded.stderr)
    fixtureWorktrees.push(driftDirectory)
    const mutated = commitSourceChange({ root: driftDirectory, sha: installed.sha }, relativePath, marker,
      `mutate member-avatar recovery input ${relativePath}`)
    const rejected = profile(mutated)
    assert.notEqual(rejected.status, 0, `member-avatar MAX recovery must reject changed production input: ${relativePath}`)
  }
})

test('MAX family invite entry retains only its measured d299 recovery pair', {
  timeout: process.platform === 'win32' ? 240_000 : 90_000,
}, () => {
  const baseline = maxVideoRecoveryBackend
  const target = maxVideoRecoveryBackend
  const expectedCompatibility = '52a8f7e24bf62c8f5a8eeca4c0c3aed612198dabe473fabe8c797ce49d286190'
  assert.equal(productionRuntimeFingerprint(root, baseline), maxVideoRecoveryRuntime)
  mkdirSync(resolve(root, '.scratch'), { recursive: true })
  const sourceDirectory = mkdtempSync(resolve(root, '.scratch', 'rollback-family-invite-source-'))
  const added = spawnSync('git', ['worktree', 'add', '--detach', sourceDirectory, baseline], { cwd: root, encoding: 'utf8' })
  if (added.status !== 0) throw new Error(added.stdout + added.stderr)
  fixtureWorktrees.push(sourceDirectory)
  const avatarSource = commitFrozenSourceFiles({ root: sourceDirectory, sha: baseline }, reviewedMemberAvatarProductionBlobs,
    'reconstruct exact member-avatar production inputs')
  const source = commitFrozenSourceFilesFromHead(avatarSource, reviewedFamilyInviteEntryProductionBlobs,
    'freeze exact family-invite production input blobs')
  const installed = commitSourceFile({ root: source.root, sha: source.sha }, 'deploy/selectel/ci-release.sh',
    readFileSync(resolve(root, 'deploy/selectel/ci-release.sh'), 'utf8'),
    'pin the exact accepted MAX rollback verifier installer')
  assert.equal(productionCompatibilityFingerprint(installed.root), expectedCompatibility)

  const profile = (candidate, rollbackTarget = target) => spawnSync(bashExecutable, ['-s'], {
    cwd: root,
    input: `${redeployDefinitions}\nAPP_ROOT=${shellQuote(candidate.root)}\nMEMOLY_PRODUCT_SHA=${candidate.sha}\nrollback_source_compatibility_profile "$MEMOLY_PRODUCT_SHA" ${rollbackTarget}\n`,
    encoding: 'utf8', timeout: 30_000,
  })
  const accepted = profile(installed)
  assert.equal(accepted.status, 0, accepted.stdout + accepted.stderr)
  assert.equal(accepted.stdout.trim().split('\n').at(-1), 'max-video')

  const oldTarget = profile(installed, rollbackHealthy)
  assert.notEqual(oldTarget.status, 0, 'family-invite candidate must not reuse the incompatible 33a pair')

  for (const [relativePath, marker] of [
    ['webapp/src/platform/max/host-bridge.ts', '\n// synthetic invite bridge drift\n'],
    ['webapp/src/platform/host-bridge.ts', '\n// synthetic invite bridge contract drift\n'],
    ['webapp/src/App.tsx', '\n// synthetic invite auth UI drift\n'],
    ['backend/src/modules/families/application/family-service.ts', '\n// synthetic invite service drift\n'],
    ['backend/src/modules/max/infrastructure/deliver-response.ts', '\n// synthetic MAX delivery drift\n'],
    ['backend/prisma/schema.prisma', '\n// synthetic schema drift\n'],
    ['deploy/selectel/compose.yml.template', '\n# synthetic MAX host-input drift\n'],
  ]) {
    const driftDirectory = mkdtempSync(resolve(root, '.scratch', 'rollback-family-invite-drift-'))
    const driftAdded = spawnSync('git', ['worktree', 'add', '--detach', driftDirectory, installed.sha], { cwd: root, encoding: 'utf8' })
    if (driftAdded.status !== 0) throw new Error(driftAdded.stdout + driftAdded.stderr)
    fixtureWorktrees.push(driftDirectory)
    const mutated = commitSourceChange({ root: driftDirectory, sha: installed.sha }, relativePath, marker,
      `mutate exact family-invite recovery input ${relativePath}`)
    const rejected = profile(mutated)
    assert.notEqual(rejected.status, 0, `MAX family-invite recovery must reject changed source before mutation: ${relativePath}`)
    assert.doesNotMatch(`${rejected.stdout}${rejected.stderr}`, /UP:|GATE/)
  }
})

test('MAX video recovery accepts only its exact reconstructed executable profile', {
  timeout: process.platform === 'win32' ? 240_000 : 90_000,
}, () => {
  const baseline = maxVideoRecoveryBackend
  const target = maxVideoRecoveryBackend
  const expectedAnchor = maxVideoRecoveryBackend
  const expectedRuntime = maxVideoRecoveryRuntime
  const expectedCompatibility = 'ff5758a7a3adb23b028a96e56c6deda68e83bd2f7cad6b2e54c0bd8b5cfa5ca4'
  assert.equal(productionRuntimeFingerprint(root, expectedAnchor), expectedRuntime)
  const sourceDirectory = mkdtempSync(resolve(root, '.scratch', 'rollback-max-video-source-'))
  const added = spawnSync('git', ['worktree', 'add', '--detach', sourceDirectory, baseline], { cwd: root, encoding: 'utf8' })
  if (added.status !== 0) throw new Error(added.stdout + added.stderr)
  fixtureWorktrees.push(sourceDirectory)
  const source = commitSourceFile({ root: sourceDirectory, sha: baseline }, 'deploy/selectel/ci-release.sh',
    readFileSync(resolve(root, 'deploy/selectel/ci-release.sh'), 'utf8'),
    'pin the exact MAX rollback verifier installer')
  assert.equal(productionCompatibilityFingerprint(source.root), expectedCompatibility)

  const profile = (candidate) => spawnSync(bashExecutable, ['-s'], {
    cwd: root,
    input: `${redeployDefinitions}\nAPP_ROOT=${shellQuote(candidate.root)}\nMEMOLY_PRODUCT_SHA=${candidate.sha}\nrollback_source_compatibility_profile "$MEMOLY_PRODUCT_SHA" ${target}\n`,
    encoding: 'utf8', timeout: 30_000,
  })
  const accepted = profile(source)
  assert.equal(accepted.status, 0, accepted.stdout + accepted.stderr)
  assert.equal(accepted.stdout.trim().split('\n').at(-1), 'max-video')
  const oldTarget = spawnSync(bashExecutable, ['-s'], {
    cwd: root,
    input: `${redeployDefinitions}\nAPP_ROOT=${shellQuote(source.root)}\nMEMOLY_PRODUCT_SHA=${source.sha}\nrollback_source_compatibility_profile "$MEMOLY_PRODUCT_SHA" ${rollbackHealthy}\n`,
    encoding: 'utf8', timeout: 30_000,
  })
  assert.notEqual(oldTarget.status, 0, 'MAX video candidate must not roll back to the incompatible old UI/runtime pair')

  for (const [relativePath, marker] of [
    ['backend/src/modules/max/infrastructure/legacy-video-migration.ts', '\n// synthetic MAX recovery source drift\n'],
    ['backend/prisma/migrations/20261025120000_max_video_legacy_retention/migration.sql', '\n-- synthetic MAX retention migration drift\n'],
    ['deploy/selectel/ci-release.sh', '\n# synthetic MAX installer drift\n'],
  ]) {
    const driftDirectory = mkdtempSync(resolve(root, '.scratch', 'rollback-max-video-drift-'))
    const driftAdded = spawnSync('git', ['worktree', 'add', '--detach', driftDirectory, source.sha], { cwd: root, encoding: 'utf8' })
    if (driftAdded.status !== 0) throw new Error(driftAdded.stdout + driftAdded.stderr)
    fixtureWorktrees.push(driftDirectory)
    const mutated = commitSourceChange({ root: driftDirectory, sha: source.sha }, relativePath, marker,
      `mutate exact MAX video recovery input ${relativePath}`)
    const rejected = profile(mutated)
    assert.notEqual(rejected.status, 0, `MAX video recovery must reject changed production or migration input: ${relativePath}`)
  }

  const compatiblePair = { target: maxVideoRecoveryBackend, webappTarget: maxVideoRecoveryWebapp,
    sourceRootOverride: source.root, sourceShaOverride: source.sha, maxVideoMocks: true }
  const captured = runApplicationRollback({ ...compatiblePair, action: 'prepare_rollback', redeployFromScriptDir: true })
  assert.equal(captured.status, 0, captured.output)
  assert.match(captured.rollbackEnv, new RegExp(`^PREVIOUS_BACKEND_IMAGE_TAG=${maxVideoRecoveryBackend}$`, 'm'))
  assert.match(captured.rollbackEnv, new RegExp(`^PREVIOUS_WEBAPP_IMAGE_TAG=${maxVideoRecoveryWebapp}$`, 'm'))
  assert.equal(captured.rollbackBackups.length, 1)

  const recoveredPair = runApplicationRollback({ ...compatiblePair,
    runningBackend: '0486e79947f6612d0eed05207c1cd30d0c4ace65',
    runningWebapp: '0f2e8a432b5712d17b67d63f99439d16f33e7721', runMigration: true,
    ciRelease: true, syntheticLock: true, action: 'prepare_rollback', redeployFromScriptDir: true })
  assert.equal(recoveredPair.status, 0, recoveredPair.output)
  assert.match(recoveredPair.output, /exact accepted MAX recovery pair passed readiness/)
  assert.match(recoveredPair.rollbackEnv, new RegExp(`^PREVIOUS_BACKEND_IMAGE_TAG=${maxVideoRecoveryBackend}$`, 'm'))
  assert.match(recoveredPair.rollbackEnv, new RegExp(`^PREVIOUS_WEBAPP_IMAGE_TAG=${maxVideoRecoveryWebapp}$`, 'm'))
  assert.equal(recoveredPair.rollbackBackups.length, 1)

  const unavailableRecovery = runApplicationRollback({ ...compatiblePair, badImage: true,
    runningBackend: '0486e79947f6612d0eed05207c1cd30d0c4ace65',
    runningWebapp: '0f2e8a432b5712d17b67d63f99439d16f33e7721', runMigration: true,
    ciRelease: true, syntheticLock: true, action: 'prepare_rollback', redeployFromScriptDir: true })
  assert.notEqual(unavailableRecovery.status, 0, unavailableRecovery.output)
  assert.match(unavailableRecovery.output, /neither the running images nor the designated rollback pair passed recovery verification/)
  assert.match(unavailableRecovery.rollbackEnv, new RegExp(`^PREVIOUS_BACKEND_IMAGE_TAG=${maxVideoRecoveryBackend}$`, 'm'))
  assert.deepEqual(unavailableRecovery.rollbackBackups, [])

  const changedWebapp = runApplicationRollback({ ...compatiblePair, badWebappLabel: true, action: 'rollback_readiness' })
  assert.notEqual(changedWebapp.status, 0, changedWebapp.output)
  assert.match(changedWebapp.output, /rollback webapp image revision label mismatch/)
  assert.doesNotMatch(changedWebapp.events, /UP:|GATE/)

  const changedBackend = runApplicationRollback({ ...compatiblePair, badBackendLabel: true, action: 'rollback_readiness' })
  assert.notEqual(changedBackend.status, 0, changedBackend.output)
  assert.match(changedBackend.output, /rollback backend image revision label mismatch/)
  assert.doesNotMatch(changedBackend.events, /UP:|GATE/)

  const changedBackendImage = runApplicationRollback({ ...compatiblePair, badImage: true, action: 'rollback_readiness' })
  assert.notEqual(changedBackendImage.status, 0, changedBackendImage.output)
  assert.match(changedBackendImage.output, /rollback backend image differs from the verified production artifact/)
  assert.doesNotMatch(changedBackendImage.events, /UP:|GATE/)

  const changedWebappImage = runApplicationRollback({ ...compatiblePair, badWebappImage: true, action: 'rollback_readiness' })
  assert.notEqual(changedWebappImage.status, 0, changedWebappImage.output)
  assert.match(changedWebappImage.output, /rollback webapp image differs from the verified production artifact/)
  assert.doesNotMatch(changedWebappImage.events, /UP:|GATE/)

  const wrongPair = runApplicationRollback({ ...compatiblePair, webappTarget: rollbackHealthy, action: 'rollback_readiness' })
  assert.notEqual(wrongPair.status, 0, wrongPair.output)
  assert.match(wrongPair.output, /rollback target pair has no verified runtime compatibility attestation/)
  assert.doesNotMatch(wrongPair.events, /UP:|GATE/)

  const oldPair = runApplicationRollback({ ...compatiblePair, target: rollbackHealthy, webappTarget: rollbackHealthy,
    action: 'rollback_readiness' })
  assert.notEqual(oldPair.status, 0, oldPair.output)
  assert.match(oldPair.output, /application runtime differs from the verified rollback source/)
  assert.doesNotMatch(oldPair.events, /UP:|GATE/)

  const restored = runApplicationRollback({ ...compatiblePair, failure: true, stoppedBackend: true, trackRollbackOrder: true })
  assert.equal(restored.status, 42, restored.output)
  assert.match(restored.events, new RegExp(`SECRET_INIT[\\s\\S]*MAX_INVERSE[\\s\\S]*UP:${maxVideoRecoveryBackend}:.*backend[\\s\\S]*BACKEND_INTERNAL_READY[\\s\\S]*GATE[\\s\\S]*AUTH_ROUTE_CHECK[\\s\\S]*UP:${maxVideoRecoveryBackend}:.*worker scheduler static`))

  const missingParentSecrets = runApplicationRollback({ ...compatiblePair, parentSecretFailure: true })
  assert.notEqual(missingParentSecrets.status, 0, missingParentSecrets.output)
  assert.match(missingParentSecrets.events, /PARENT_SECRET_INIT_FAILED/)
  assert.doesNotMatch(missingParentSecrets.events, /MAX_INVERSE|UP:|GATE/)

  const exactRunningBackend = runApplicationRollback({ ...compatiblePair, trackRollbackOrder: true })
  assert.equal(exactRunningBackend.status, 0, exactRunningBackend.output)
  assert.match(exactRunningBackend.events, new RegExp(`BACKEND_INTERNAL_READY[\\s\\S]*GATE[\\s\\S]*AUTH_ROUTE_CHECK[\\s\\S]*UP:${maxVideoRecoveryBackend}:.*worker scheduler static`))

  const unexpectedRunningBackend = runApplicationRollback({ ...compatiblePair,
    runningBackend: 'a'.repeat(40), trackRollbackOrder: true })
  assert.notEqual(unexpectedRunningBackend.status, 0, unexpectedRunningBackend.output)
  assert.match(unexpectedRunningBackend.output, /running backend image revision label does not match its tag/)
  assert.doesNotMatch(unexpectedRunningBackend.events, /BACKEND_INTERNAL_READY|GATE|AUTH_ROUTE_CHECK|UP:/)
})

test('MAX video readiness is read-only and blocks unsafe held tombstones before service changes', () => {
  const run = (mode) => {
    const events = resolve(root, '.scratch', `max-video-readiness-${process.pid}-${mode}.log`)
    const script = [
      'set -euo pipefail', redeployDefinitions,
      `MEMOLY_PRODUCT_SHA=${currentGitHead()}`,
      `MAX_VIDEO_EVENTS=${shellQuote(events)}`,
      'docker() { if [ "$1" = image ]; then if [ "$4" = \'{{.Id}}\' ]; then echo sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa; else echo "$MEMOLY_PRODUCT_SHA"; fi; return 0; fi; printf "docker:%s\\n" "$*" >> "$MAX_VIDEO_EVENTS"; }',
      `compose() { printf "compose:%s\\n" "$*" >> "$MAX_VIDEO_EVENTS"; case "$*" in *legacy_video_retained_at*) [ "${mode}" != unsafe ] ;; *--recover-all*) [ "${mode}" != missing ] ;; *) return 0 ;; esac; }`,
      'rollback_verify_max_video_recovery_readiness',
    ].join('\n')
    const result = spawnSync(bashExecutable, ['-s'], { cwd: root, input: script, encoding: 'utf8', timeout: 30_000 })
    const output = existsSync(events) ? readFileSync(events, 'utf8') : ''
    return { result, output }
  }

  const ready = run('ready')
  assert.equal(ready.result.status, 0, ready.result.stderr || ready.result.stdout)
  assert.match(ready.output, /compose:run --rm --no-deps backend bun -e/)
  assert.match(ready.output, /compose:run --rm --no-deps backend bun scripts\/migrate-max-legacy-videos.ts --recover-all/)
  assert.doesNotMatch(ready.output, /docker:stop|compose:up/)

  const tombstoned = run('unsafe')
  assert.notEqual(tombstoned.result.status, 0)
  assert.match(tombstoned.result.stderr, /already tombstoned/)
  assert.doesNotMatch(tombstoned.output, /--recover-all|docker:stop|compose:up/)

  const missing = run('missing')
  assert.notEqual(missing.result.status, 0)
  assert.match(missing.result.stderr, /readiness failed/)
  assert.doesNotMatch(missing.output, /docker:stop|compose:up/)
})

test('MAX video apply uses the candidate image and preserves the recovery exit code', () => {
  const events = resolve(root, '.scratch', `max-video-apply-${process.pid}.log`)
  const script = [
    'set -euo pipefail', redeployDefinitions,
    `MEMOLY_PRODUCT_SHA=${currentGitHead()}`,
    `MAX_VIDEO_EVENTS=${shellQuote(events)}`,
    'rollback_verify_max_video_migration_history() { echo present; }',
    'docker() { if [ "$1" = image ]; then if [ "$4" = \'{{.Id}}\' ]; then echo sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa; else echo "$MEMOLY_PRODUCT_SHA"; fi; return 0; fi; if [ "$1" = ps ]; then case "$*" in *service=backend*) [ "${STOPPED_backend:-false}" = true ] || echo backend-id ;; *service=worker*) [ "${STOPPED_worker:-false}" = true ] || echo worker-id ;; *service=scheduler*) [ "${STOPPED_scheduler:-false}" = true ] || echo scheduler-id ;; esac; return 0; fi; if [ "$1" = stop ]; then case "$4" in backend-id) STOPPED_backend=true ;; worker-id) STOPPED_worker=true ;; scheduler-id) STOPPED_scheduler=true ;; esac; printf "stop:%s\\n" "$4" >> "$MAX_VIDEO_EVENTS"; return 0; fi; }',
    'compose() { printf "compose:%s\\n" "$*" >> "$MAX_VIDEO_EVENTS"; case "$*" in *--recover-all*--apply*) echo recovery-partial-failure; return 7 ;; *--recover-all*) return 0 ;; *max_video_legacy_retention*) return 0 ;; *) return 0 ;; esac; }',
    'readiness() { printf "current-readiness\\n" >> "$MAX_VIDEO_EVENTS"; }',
    'rollback_apply_max_video_recovery',
  ].join('\n')
  const result = spawnSync(bashExecutable, ['-s'], { cwd: root, input: script, encoding: 'utf8', timeout: 30_000 })
  const output = existsSync(events) ? readFileSync(events, 'utf8') : ''
  assert.equal(result.status, 7, `${result.stdout}${result.stderr}`)
  assert.match(output, /backend bun scripts\/migrate-max-legacy-videos.ts --recover-all --apply/)
  assert.match(output, /stop:backend-id[\s\S]*stop:worker-id[\s\S]*stop:scheduler-id[\s\S]*compose:up -d --no-deps --force-recreate backend worker scheduler[\s\S]*current-readiness/)
  assert.doesNotMatch(result.stderr, /recovery-partial-failure/)
  assert.doesNotMatch(output, /33a0054c3c71372aa5509ee8ebfa4578ad512ea1|rollback promotion/)
})

test('MAX video apply accepts silent candidate recovery only after readiness and ledger verification', () => {
  const events = resolve(root, '.scratch', `max-video-apply-success-${process.pid}.log`)
  const script = [
    'set -euo pipefail', redeployDefinitions,
    `MEMOLY_PRODUCT_SHA=${currentGitHead()}`,
    `MAX_VIDEO_EVENTS=${shellQuote(events)}`,
    'rollback_verify_max_video_migration_history() { echo present; }',
    'rollback_verify_max_video_recovery_readiness() { printf "readiness\\n" >> "$MAX_VIDEO_EVENTS"; }',
    'docker() { if [ "$1" = image ]; then if [ "$4" = \'{{.Id}}\' ]; then echo sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa; else echo "$MEMOLY_PRODUCT_SHA"; fi; return 0; fi; if [ "$1" = ps ]; then case "$*" in *service=backend*) [ "${STOPPED_backend:-false}" = true ] || echo backend-id ;; *service=worker*) [ "${STOPPED_worker:-false}" = true ] || echo worker-id ;; *service=scheduler*) [ "${STOPPED_scheduler:-false}" = true ] || echo scheduler-id ;; esac; return 0; fi; if [ "$1" = stop ]; then case "$4" in backend-id) STOPPED_backend=true ;; worker-id) STOPPED_worker=true ;; scheduler-id) STOPPED_scheduler=true ;; esac; printf "stop:%s\\n" "$4" >> "$MAX_VIDEO_EVENTS"; return 0; fi; }',
    'compose() { printf "compose:%s\\n" "$*" >> "$MAX_VIDEO_EVENTS"; return 0; }',
    'rollback_apply_max_video_recovery',
  ].join('\n')
  const result = spawnSync(bashExecutable, ['-s'], { cwd: root, input: script, encoding: 'utf8', timeout: 30_000 })
  const output = existsSync(events) ? readFileSync(events, 'utf8') : ''
  assert.equal(result.status, 0, `${result.stdout}${result.stderr}`)
  assert.match(output, /readiness[\s\S]*stop:backend-id[\s\S]*stop:worker-id[\s\S]*stop:scheduler-id[\s\S]*--recover-all --apply[\s\S]*max_video_legacy_retention[\s\S]*readiness/)
  assert.doesNotMatch(output, /33a0054c3c71372aa5509ee8ebfa4578ad512ea1/)
})

test('membership guard allows quiesced promotion only through exact complete MAX verification', () => {
  const script = linuxPath(resolve(root, 'deploy/selectel/redeploy.sh'))
  const current = currentGitHead()
  const result = runLinuxRoot(`
set -euo pipefail
. '${script}'
fixture=$(mktemp -d /tmp/max-stopped-promotion.XXXXXX)
trap 'rm -rf -- "$fixture"' EXIT
APP_ROOT='${linuxPath(root)}'
SERVER_ROOT="$fixture"
ROLLBACK_ENV="$fixture/rollback.env"
FORWARD_MARKER="$fixture/no-b2-marker"
MM0_FORWARD_MARKER="$fixture/no-mm0-marker"
COMPOSE_PROJECT=fixture
MEMOLY_PRODUCT_SHA='${current}'
SELECTEL_CI_RELEASE=true
SELECTEL_DEPLOY_LOCK_FD=9
exec 9>"$fixture/.selectel-deploy.lock"
flock -n 9
printf 'PREVIOUS_BACKEND_IMAGE_TAG=%s\\nPREVIOUS_WEBAPP_IMAGE_TAG=%s\\nMEMOLY_DB_ROLLBACK_ALLOWED=false\\n' \\
  "$MAX_VIDEO_RECOVERY_BACKEND_SHA" "$MAX_VIDEO_RECOVERY_WEBAPP_SHA" > "$ROLLBACK_ENV"
chmod 0600 "$ROLLBACK_ENV"
FIXTURE_EVENTS="$fixture/events"
FIXTURE_WRITERS=running
FIXTURE_PROFILE=max-video
FIXTURE_VERIFY=pass
git() {
  case "$*" in
    *'rev-parse refs/remotes/origin/main'*) printf '%s\\n' "$MEMOLY_PRODUCT_SHA" ;;
    *'rev-parse HEAD'*) printf '%s\\n' "$MEMOLY_PRODUCT_SHA" ;;
    *'cat-file -e'*) return 0 ;;
    *'merge-base --is-ancestor'*) return 0 ;;
    *) command git "$@" ;;
  esac
}
docker() {
  case "$*" in
    *'service=backend'*) [ "$FIXTURE_WRITERS" != stopped ] && printf 'backend-container\\n' || true ;;
    *'service=worker'*) [ "$FIXTURE_WRITERS" = running ] && printf 'worker-container\\n' || true ;;
    *'service=scheduler'*) [ "$FIXTURE_WRITERS" = running ] && printf 'scheduler-container\\n' || true ;;
    *'inspect --format {{.Config.Image}}'*) printf 'memoly-backend:%s\\n' "$MAX_VIDEO_RECOVERY_BACKEND_SHA" ;;
    *) return 0 ;;
  esac
}
rollback_source_compatibility_profile() { printf '%s\\n' "$FIXTURE_PROFILE"; }
load_runtime_secrets() { export MAX_BOT_TOKEN=synthetic MAX_WEBHOOK_SECRET=synthetic MAX_INBOX_ENCRYPTION_KEY=synthetic; echo SECRET_INIT >> "$FIXTURE_EVENTS"; }
verify_application_rollback() { echo "VERIFY:$1" >> "$FIXTURE_EVENTS"; [ "$FIXTURE_VERIFY" = pass ] && [ -n "$MAX_BOT_TOKEN" ]; }

# Real migration guard accepts the running B2 services before quiescence.
guard_membership_transition
FIXTURE_WRITERS=stopped
# Its default migration context still rejects the stopped set.
if ( guard_membership_transition ); then echo 'stopped writers passed migration guard' >&2; exit 41; fi
# Only promotion context can proceed, after exact source/pair/readiness checks.
guard_membership_transition promotion
FIXTURE_PROFILE=other
if ( guard_membership_transition promotion ); then echo 'wrong source profile accepted' >&2; exit 42; fi
FIXTURE_PROFILE=max-video
FIXTURE_VERIFY=fail
if ( guard_membership_transition promotion ); then echo 'incomplete ledger/readiness accepted' >&2; exit 43; fi
FIXTURE_VERIFY=pass
FIXTURE_WRITERS=partial
if ( guard_membership_transition promotion ); then echo 'partial writer set accepted' >&2; exit 44; fi
FIXTURE_WRITERS=stopped
sed -i 's/^PREVIOUS_BACKEND_IMAGE_TAG=.*/PREVIOUS_BACKEND_IMAGE_TAG=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/' "$ROLLBACK_ENV"
if ( guard_membership_transition promotion ); then echo 'unpinned rollback pair accepted' >&2; exit 45; fi
grep -q '^SECRET_INIT$' "$FIXTURE_EVENTS"
grep -q '^VERIFY:complete$' "$FIXTURE_EVENTS"
printf 'PASS: only exact stopped-writer MAX promotion accepted; migration and drift checks preserved\\n'
`)
  assert.equal(result.status, 0, result.stdout + result.stderr)
  assert.match(result.stdout, /PASS: only exact stopped-writer MAX promotion accepted/)
  assert.match(result.stderr, /B2 release without a forward-only marker requires one running compatible backend/)
})

test('MAX video rollback pre-SQL verification uses the exact-prefix helper while complete state rejects 57 migrations', {
  timeout: 30_000,
}, () => {
  const serverRoot = mkdtempSync(resolve(root, '.scratch', 'max-video-pre-sql-dispatch-'))
  const events = resolve(serverRoot, 'events.log')
  const rollbackEnv = resolve(serverRoot, 'rollback.env')
  const pgFixture = resolve(serverRoot, 'node_modules/pg')
  mkdirSync(pgFixture, { recursive: true })
  writeFileSync(resolve(pgFixture, 'package.json'), '{"type":"module","exports":"./index.js"}\n')
  writeFileSync(resolve(pgFixture, 'index.js'), `export class Client {
    async connect() {}
    async end() {}
    async query(sql) {
      const count = Number(process.env.FIXTURE_LEDGER_COUNT)
      const candidate = (process.env.MEMOLY_EXPECTED_CANDIDATE_MIGRATIONS ?? '').trim().split('\\n').map((line) => line.split(':'))
      const rows = candidate.slice(0, count).map(([migration_name, checksum]) => ({ migration_name, checksum, finished_at: '2026-10-25T10:00:00.000Z', rolled_back_at: null }))
      if (process.env.FIXTURE_LEDGER_VARIANT === 'wrong' && rows.length > 56) rows[56].migration_name = '20990101000000_unreviewed'
      if (sql.startsWith('SELECT migration_name,checksum')) return { rows }
      if (sql.includes('to_regclass')) return { rows: [{ present: count === 59 }] }
      if (sql.includes('SELECT EXISTS')) return { rows: [{ unread: false, multiple: false, unfinished: false }] }
      throw new Error('unexpected release-verification SQL')
    }
  }\n`)
  writeFileSync(rollbackEnv, `PREVIOUS_BACKEND_IMAGE_TAG=${maxVideoRecoveryBackend}\nPREVIOUS_WEBAPP_IMAGE_TAG=${maxVideoRecoveryWebapp}\nMEMOLY_DB_ROLLBACK_ALLOWED=false\n`)
  const checksum = 'a'.repeat(64)
  const fixtureBaselineCatalog = Array.from({ length: 56 }, (_, index) =>
    `20200101000000_fixture_${String(index).padStart(2, '0')}:${checksum}:${checksum}`).join('\n')
  const fixtureCandidateCatalog = `${fixtureBaselineCatalog}\n20261025100000_control_observability:${checksum}:${checksum}\n20261025110000_max_multivideo_references:${checksum}:${checksum}\n20261025120000_max_video_legacy_retention:${checksum}:${checksum}`
  const run = (phase, variant = 'exact') => spawnSync(bashExecutable, ['-s'], {
    cwd: root,
    input: [
      'set -euo pipefail', redeployDefinitions,
      `APP_ROOT=${shellQuote(root)}`, `SERVER_ROOT=${shellQuote(serverRoot)}`,
      `ROLLBACK_ENV=${shellQuote(rollbackEnv)}`, `FORWARD_MARKER=${shellQuote(resolve(serverRoot, 'no-b2-marker'))}`,
      `MM0_FORWARD_MARKER=${shellQuote(resolve(serverRoot, 'no-mm0-marker'))}`,
      `MEMOLY_PRODUCT_SHA=${currentGitHead()}`,
      'validate_rollback_file() { :; }',
      'git() { case "$*" in *"status --porcelain"*) : ;; *) command git "$@" ;; esac; }',
      `FIXTURE_BASELINE_CATALOG=${shellQuote(fixtureBaselineCatalog)}`,
      `FIXTURE_CANDIDATE_CATALOG=${shellQuote(fixtureCandidateCatalog)}`,
      'rollback_migration_catalog_checksums() { if [ "$1" = ccd3b911222d00769a099b998d8eef2665acd9d4 ]; then printf "%s\\n" "$FIXTURE_BASELINE_CATALOG"; else printf "%s\\n" "$FIXTURE_CANDIDATE_CATALOG"; fi; }',
      'rollback_source_compatibility_profile() { printf "max-video\\n"; }',
      `rollback_runtime_fingerprint() { printf "%s\\n" "${maxVideoRecoveryRuntime}"; }`,
      'rollback_control_host_inputs_match() { return 0; }',
      'rollback_max_video_host_inputs_match() { return 0; }',
      'rollback_control_installed_inputs_match() { return 0; }',
      'load_runtime_secrets() { :; }',
      'validate_inputs() { :; }',
      'configuration_backup_dir() { printf "%s\\n" "$SERVER_ROOT"; }',
      `docker() { case "$*" in *"{{.Id}}"*"memoly-backend:"*) printf "%s\\n" "${maxVideoRecoveryBackendId}" ;; *"{{.Id}}"*"memoly-webapp:"*) printf "%s\\n" "${maxVideoRecoveryWebappId}" ;; *"org.opencontainers.image.revision"*"memoly-backend:"*) printf "%s\\n" "${maxVideoRecoveryBackend}" ;; *"org.opencontainers.image.revision"*"memoly-webapp:"*) printf "%s\\n" "${maxVideoRecoveryWebapp}" ;; *) return 0 ;; esac; }`,
      `compose() { local program; for program; do :; done; if [[ "$*" == *"bun -e"* ]]; then printf "ledger-check\\n" >> "$FIXTURE_EVENTS"; (cd "$FIXTURE_PG_DIR" && node --input-type=module --eval "$program"); else return 0; fi; }`,
      `migration_status() { printf "migration-status:%s\\n" "$FIXTURE_PHASE" >> ${shellQuote(events)}; [ "$FIXTURE_PHASE" = complete ]; }`,
      'rollback_verify_max_video_recovery_readiness() { printf "readiness\\n" >> "$FIXTURE_EVENTS"; }',
      `FIXTURE_PHASE=${shellQuote(phase)}`,
      `FIXTURE_EVENTS=${shellQuote(events)}`,
      `FIXTURE_PG_DIR=${shellQuote(gitBashPath(serverRoot))}`,
      `FIXTURE_LEDGER_VARIANT=${shellQuote(variant)}`,
      'FIXTURE_LEDGER_COUNT=57',
      'if verify_application_rollback "$FIXTURE_PHASE"; then printf "accepted\\n"; else status=$?; printf "rejected:%s\\n" "$status"; fi',
    ].join('\n'),
    encoding: 'utf8', env: { ...process.env, FIXTURE_PHASE: phase, FIXTURE_EVENTS: gitBashPath(events), FIXTURE_PG_DIR: gitBashPath(serverRoot), FIXTURE_LEDGER_COUNT: '57', FIXTURE_LEDGER_VARIANT: variant }, timeout: 30_000,
  })
  try {
    const preSql = run('pre-sql')
    assert.equal(preSql.status, 0, preSql.stdout + preSql.stderr)
    assert.match(preSql.stdout, /accepted/)
    const preEvents = existsSync(events) ? readFileSync(events, 'utf8') : ''
    assert.match(preEvents, /ledger-check/)
    assert.doesNotMatch(preEvents, /migration-status/)

    writeFileSync(events, '')
    const unreviewed = run('pre-sql', 'wrong')
    assert.equal(unreviewed.status, 0, unreviewed.stdout + unreviewed.stderr)
    assert.match(unreviewed.stdout, /rejected:1/)
    assert.doesNotMatch(existsSync(events) ? readFileSync(events, 'utf8') : '', /migration-status/)

    writeFileSync(events, '')
    const complete = run('complete')
    assert.equal(complete.status, 0, complete.stdout + complete.stderr)
    assert.match(complete.stdout, /rejected:1/)
    const completeEvents = existsSync(events) ? readFileSync(events, 'utf8') : ''
    assert.match(completeEvents, /migration-status:complete[\s\S]*ledger-check/)
  } finally {
    rmSync(serverRoot, { recursive: true, force: true })
  }
})

test('MAX video migration stops all old writers after backup and before migration DDL', () => {
  const serverRoot = mkdtempSync(resolve(root, '.scratch', 'max-video-quiescence-'))
  const events = resolve(serverRoot, 'events.log')
  const script = [
    'set -euo pipefail', redeployDefinitions,
    `APP_ROOT=${shellQuote(root)}`, `SERVER_ROOT=${shellQuote(serverRoot)}`,
    `MAX_VIDEO_EVENTS=${shellQuote(events)}`,
    `MEMOLY_PRODUCT_SHA=${currentGitHead()}`,
    'SELECTEL_CI_RELEASE=true', 'SELECTEL_DEPLOY_LOCK_FD=9',
    'preflight() { echo preflight >> "$MAX_VIDEO_EVENTS"; }',
    'validate_database_target() { echo database-target >> "$MAX_VIDEO_EVENTS"; }',
    'backup_database() { echo backup >> "$MAX_VIDEO_EVENTS"; }',
    'install() { mkdir -p "${@: -1}"; }',
    'chmod() { return 0; }',
    `rollback_source_compatibility_profile() { echo max-video; }`,
    'rollback_verify_max_video_migration_history() { echo absent; }',
    'docker() { if [ "$1" = ps ]; then case "$*" in *service=backend*) [ "${STOPPED_backend:-false}" = true ] || echo backend-id ;; *service=worker*) [ "${STOPPED_worker:-false}" = true ] || echo worker-id ;; *service=scheduler*) [ "${STOPPED_scheduler:-false}" = true ] || echo scheduler-id ;; esac; return 0; fi; if [ "$1" = stop ]; then case "$4" in backend-id) STOPPED_backend=true ;; worker-id) STOPPED_worker=true ;; scheduler-id) STOPPED_scheduler=true ;; esac; printf "stop:%s\\n" "$4" >> "$MAX_VIDEO_EVENTS"; return 0; fi; }',
    'compose() { printf "sql:%s\\n" "$*" >> "$MAX_VIDEO_EVENTS"; return 0; }',
    'migration_status() { echo migration-status >> "$MAX_VIDEO_EVENTS"; }',
    'migrate',
  ].join('\n')
  const result = spawnSync(bashExecutable, ['-s'], { cwd: root, input: script, encoding: 'utf8', timeout: 30_000 })
  const output = existsSync(events) ? readFileSync(events, 'utf8') : ''
  assert.equal(result.status, 0, `${result.stdout}${result.stderr}`)
  assert.ok(output.indexOf('backup') < output.indexOf('stop:backend-id'), output)
  assert.ok(output.indexOf('stop:backend-id') < output.indexOf('stop:worker-id'), output)
  assert.ok(output.indexOf('stop:worker-id') < output.indexOf('stop:scheduler-id'), output)
  assert.ok(output.indexOf('stop:scheduler-id') < output.indexOf('sql:'), output)
  rmSync(serverRoot, { recursive: true, force: true })
})

test('MAX retention migration refuses to run when its exact candidate fingerprint fails', () => {
  const serverRoot = mkdtempSync(resolve(root, '.scratch', 'max-video-fingerprint-failure-'))
  const events = resolve(serverRoot, 'events.log')
  const script = [
    'set -euo pipefail', redeployDefinitions,
    `APP_ROOT=${shellQuote(root)}`, `SERVER_ROOT=${shellQuote(serverRoot)}`,
    `MAX_VIDEO_EVENTS=${shellQuote(events)}`,
    `MEMOLY_PRODUCT_SHA=${currentGitHead()}`,
    'SELECTEL_CI_RELEASE=true', 'SELECTEL_DEPLOY_LOCK_FD=9',
    'preflight() { echo preflight >> "$MAX_VIDEO_EVENTS"; }',
    'validate_database_target() { echo database-target >> "$MAX_VIDEO_EVENTS"; }',
    'backup_database() { echo backup >> "$MAX_VIDEO_EVENTS"; }',
    'rollback_source_compatibility_profile() { return 1; }',
    'docker() { printf "docker:%s\\n" "$*" >> "$MAX_VIDEO_EVENTS"; }',
    'compose() { printf "sql:%s\\n" "$*" >> "$MAX_VIDEO_EVENTS"; }',
    'migrate',
  ].join('\n')
  const result = spawnSync(bashExecutable, ['-s'], { cwd: root, input: script, encoding: 'utf8', timeout: 30_000 })
  const output = existsSync(events) ? readFileSync(events, 'utf8') : ''
  assert.equal(result.status, 1, `${result.stdout}${result.stderr}`)
  assert.match(result.stderr, /exact reviewed source compatibility profile/)
  assert.match(output, /backup/)
  assert.doesNotMatch(output, /docker:|sql:/)
  rmSync(serverRoot, { recursive: true, force: true })
})

test('child linked-family recovery pins frozen production inputs to dc26 and rejects runtime or UI drift', {
  timeout: process.platform === 'win32' ? 240_000 : 90_000,
}, () => {
  const baseline = '954640d34f73103a577b497ec237c7701fcfad56'
  const target = '33a0054c3c71372aa5509ee8ebfa4578ad512ea1'
  const expectedAnchor = 'dc26ad9bb5ebcfe64643414fad90d53fcb3b1c92'
  const expectedCompatibility = 'cb65bc32b8265b0dc431b1a115ff1e192299f41812232773a2194f8fc894bc05'
  assert.equal(productionRuntimeFingerprint(root, expectedAnchor),
    '2be6fc2b96f4731c4ea3821b50f112c01d8e9a62da57eeb6675f8513fd26b088')
  const sourceDirectory = mkdtempSync(resolve(root, '.scratch', 'rollback-children-source-'))
  const added = spawnSync('git', ['worktree', 'add', '--detach', sourceDirectory, baseline], { cwd: root, encoding: 'utf8' })
  if (added.status !== 0) throw new Error(added.stdout + added.stderr)
  fixtureWorktrees.push(sourceDirectory)
  const source = commitFrozenSourceFiles({ root: sourceDirectory, sha: baseline }, reviewedChildrenProductionBlobs,
    'apply exact frozen child linked-family production blobs')
  assert.equal(productionCompatibilityFingerprint(source.root), expectedCompatibility)

  const profile = (candidate) => spawnSync(bashExecutable, ['-s'], {
    cwd: root,
    input: `${redeployDefinitions}\nAPP_ROOT=${shellQuote(candidate.root)}\nMEMOLY_PRODUCT_SHA=${candidate.sha}\nrollback_source_compatibility_profile "$MEMOLY_PRODUCT_SHA" ${target}\n`,
    encoding: 'utf8', timeout: 30_000,
  })
  const accepted = profile(source)
  assert.equal(accepted.status, 0, accepted.stdout + accepted.stderr)
  assert.equal(accepted.stdout.trim().split('\n').at(-1), 'wishlist')

  for (const [relativePath, marker] of [
    ['backend/src/modules/memories/infrastructure/child-tags.ts', '\n// synthetic frozen child-runtime drift\n'],
    ['webapp/src/features/feed/child-filter.ts', '\n// synthetic frozen child-UI drift\n'],
  ]) {
    const driftDirectory = mkdtempSync(resolve(root, '.scratch', 'rollback-children-drift-'))
    const driftAdded = spawnSync('git', ['worktree', 'add', '--detach', driftDirectory, source.sha], { cwd: root, encoding: 'utf8' })
    if (driftAdded.status !== 0) throw new Error(driftAdded.stdout + driftAdded.stderr)
    fixtureWorktrees.push(driftDirectory)
    const mutated = commitSourceChange({ root: driftDirectory, sha: source.sha }, relativePath, marker,
      `mutate frozen child production input ${relativePath}`)
    const rejected = profile(mutated)
    assert.notEqual(rejected.status, 0, `changed child production input must not inherit recovery permission: ${relativePath}`)
  }
})
