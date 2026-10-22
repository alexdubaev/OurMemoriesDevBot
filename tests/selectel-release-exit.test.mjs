import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { appendFileSync, chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import test from 'node:test'
import { afterAll } from 'bun:test'
import { bashExecutable, gitBashPath } from './bash-runtime.mjs'
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
const fixtureWorktrees = []
const fixtureSourceCache = new Map()

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
    writeFileSync(resolve(source.root, relativePath), frozenGitBlob(blob, relativePath))
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
  if (options.marker) writeFileSync(resolve(server, options.marker), 'unfinished\n')
  if (options.noBackup) rmSync(resolve(backup, 'compose.yml'))
  const targetLabel = options.badLabel ? 'wrong' : target
  const events = resolve(fixture, 'events')
  const env = {
    SERVER_ROOT: server, APP_ROOT: source.root, BACKUPS_DIR: resolve(server, 'backups'), PRODUCT_SHA: source.sha, SCRIPT_DIR: resolve(root, 'deploy/selectel'),
    COMPOSE_FILE: resolve(server, 'compose.yml'), ROLLBACK_ENV: resolve(server, 'rollback.env'),
    CONFIG_BACKUP_MARKER: resolve(server, '.selectel-config-backup'),
    SERVER_EDGE_CADDYFILE: resolve(server, 'gateway/Caddyfile'), SERVER_STATIC_CADDYFILE: resolve(server, 'Caddyfile.static'),
    FORWARD_MARKER: resolve(server, 'b2.marker'), MM0_FORWARD_MARKER: resolve(server, 'mm0.marker'),
    MEMOLY_PRODUCT_SHA: options.producer ?? source.sha,
    RUNNING_BACKEND_IMAGE_TAG: options.runningBackend ?? rollbackBaseline,
    RUNNING_WEBAPP_IMAGE_TAG: options.runningWebapp ?? rollbackBaseline,
    MAX_BOT_TOKEN: '', MAX_WEBHOOK_SECRET: '', MAX_INBOX_ENCRYPTION_KEY: '',
    MEMOLY_PUBLIC_HOST: 'example.invalid', PUBLIC_URL: 'http://example.invalid',
    FIXTURE_EVENTS: events, FIXTURE_PENDING: String(options.pending ?? false),
    FIXTURE_STATE_ERROR: String(options.stateError ?? false),
    FIXTURE_UNREAD: String(options.unread ?? true), FIXTURE_MULTIPLE: String(options.multiple ?? true),
    FIXTURE_MIGRATION_HISTORY_MISMATCH: String(options.historyMismatch ?? false),
    FIXTURE_MIGRATION_HISTORY_ERROR: String(options.historyError ?? false),
    FIXTURE_BACKEND_ID: options.badImage ? 'sha256:' + 'f'.repeat(64) : (healthyPair ? healthyBackendId : v4Pair ? v4BackendId : candidatePair ? candidateBackendId : legacyBackendId),
    FIXTURE_WEBAPP_ID: healthyPair ? healthyWebappId : v4Pair ? v4WebappId : candidatePair ? candidateWebappId : legacyWebappId, FIXTURE_LABEL: targetLabel,
    FIXTURE_AUTH_RESPONSE: options.badAuthResponse ? '502' : '',
    FIXTURE_PROMOTION_FAIL: String(options.promotionFail ?? false),
    ROLLBACK_AUTH_GATE: options.operatorGate ?? '',
  }
  const mocks = [
    'stat() { case "$2" in %u) printf "0\\n" ;; %a) printf "600\\n" ;; %i) printf "1\\n" ;; *) return 2 ;; esac; }',
    'install() { local target=${!#}; if [ "$1" = -d ]; then mkdir -p "$target"; else : > "$target"; fi; }',
    'chmod() { :; }',
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
    '     if [[ "$*" == *"MEMOLY_EXPECTED_MIGRATION_CHECKSUMS="* ]]; then echo HISTORY_ATTESTATION:present >> "$FIXTURE_EVENTS"; else echo HISTORY_ATTESTATION:missing >> "$FIXTURE_EVENTS"; return 1; fi',
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
    ...(options.action === 'prepare_rollback' ? [
      'bash() {',
      ' if [ "$1" = "$APP_ROOT/deploy/selectel/redeploy.sh" ]; then',
      '   shift',
      `   ( . "${options.redeployFromScriptDir ? '$SCRIPT_DIR' : '$APP_ROOT'}/deploy/selectel/redeploy.sh"; require_command() { case "$1" in curl|flock|git|readlink|stat|docker) return 0 ;; *) command -v "$1" >/dev/null ;; esac; }; acquire_deploy_lock() { :; }; load_runtime_secrets() { export MAX_BOT_TOKEN=synthetic-test-token MAX_WEBHOOK_SECRET=synthetic-test-secret MAX_INBOX_ENCRYPTION_KEY=synthetic-test-key; }; main "$@" )`,
      ' else command bash "$@"; fi',
      '}',
    ] : []),
  ].join('\n')
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
        redeployDefinitions, assignments, mocks, trigger].join('\n'), encoding: 'utf8', timeout: options.processTimeoutMs ?? 30_000,
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
  ['refuses a mismatched OCI revision label', { badLabel: true }, /rollback image revision label mismatch/],
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
