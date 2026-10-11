import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import test from 'node:test'

const root = resolve(import.meta.dirname, '..')
const release = readFileSync(resolve(root, 'deploy/selectel/ci-release.sh'), 'utf8').replaceAll('\r\n', '\n')
const runbook = readFileSync(resolve(root, 'deploy/selectel/README.md'), 'utf8').replaceAll('\r\n', '\n')

const extractFunction = (name) => {
  const match = release.match(new RegExp(`${name}\\(\\) \\{[\\s\\S]*?\\n\\}`))
  assert.ok(match, `${name} function is present`)
  return match[0]
}

const validation = extractFunction('validate_inputs')
const prebuiltValidation = extractFunction('validate_prebuilt_images')
const sha = 'a'.repeat(40)
const backendId = `sha256:${'1'.repeat(64)}`
const webappId = `sha256:${'2'.repeat(64)}`

function runValidation(values = {}) {
  const assignments = Object.entries(values)
    .map(([key, value]) => `${key}='${value}'`)
    .join('\n')
  return spawnSync('bash', ['-s'], {
    input: `
set -euo pipefail
PRODUCT_SHA=${sha}
DEPLOY_CONFIRMATION=DEPLOY
RUN_MIGRATION=false
MAX_BOT_USERNAME=id911018762027_bot
PREBUILT_IMAGES=false
die() { printf 'ERROR: %s\\n' "$*" >&2; exit 7; }
${assignments}
${validation}
validate_inputs
printf '%s\\n' "$PREBUILT_IMAGES"
`,
    encoding: 'utf8',
    timeout: 30_000,
  })
}

test('prebuilt image IDs are optional only as an exact pair', { timeout: 30_000 }, () => {
  const absent = runValidation()
  assert.equal(absent.status, 0, absent.stderr)
  assert.equal(absent.stdout, 'false\n')

  const valid = runValidation({
    SELECTEL_PREBUILT_BACKEND_ID: backendId,
    SELECTEL_PREBUILT_WEBAPP_ID: webappId,
  })
  assert.equal(valid.status, 0, valid.stderr)
  assert.equal(valid.stdout, 'true\n')

  for (const values of [
    { SELECTEL_PREBUILT_BACKEND_ID: backendId },
    { SELECTEL_PREBUILT_BACKEND_ID: '', SELECTEL_PREBUILT_WEBAPP_ID: webappId },
    { SELECTEL_PREBUILT_BACKEND_ID: `SHA256:${'1'.repeat(64)}`, SELECTEL_PREBUILT_WEBAPP_ID: webappId },
    { SELECTEL_PREBUILT_BACKEND_ID: `sha256:${'1'.repeat(63)}`, SELECTEL_PREBUILT_WEBAPP_ID: webappId },
  ]) {
    const result = runValidation(values)
    assert.equal(result.status, 7, `${result.stdout}${result.stderr}`)
    assert.match(result.stderr, /prebuilt image IDs|SELECTEL_PREBUILT_/)
  }
})

function runImageValidation({ backend = backendId, webapp = webappId, backendRevision = sha, webappRevision = sha } = {}) {
  const docker = `
docker() {
  [ "$1" = image ] && [ "$2" = inspect ] || return 90
  local format="$4" image="$5"
  case "$format" in
    *'.Id'*)
      case "$image" in
        memoly-backend:*) printf '%s\\n' '${backend}' ;;
        memoly-webapp:*) printf '%s\\n' '${webapp}' ;;
        *) return 91 ;;
      esac
      ;;
    *)
      case "$image" in
        memoly-backend:*) printf '%s\\n' '${backendRevision}' ;;
        memoly-webapp:*) printf '%s\\n' '${webappRevision}' ;;
        *) return 92 ;;
      esac
      ;;
  esac
}
`
  return spawnSync('bash', ['-s'], {
    input: `
set -euo pipefail
PRODUCT_SHA=${sha}
PREBUILT_IMAGES=true
SELECTEL_PREBUILT_BACKEND_ID=${backendId}
SELECTEL_PREBUILT_WEBAPP_ID=${webappId}
die() { printf 'ERROR: %s\\n' "$*" >&2; exit 7; }
${docker}
${prebuiltValidation}
validate_prebuilt_images
`,
    encoding: 'utf8',
    timeout: 30_000,
  })
}

test('prebuilt tags must match both supplied IDs and OCI revision labels', { timeout: 30_000 }, () => {
  const valid = runImageValidation()
  assert.equal(valid.status, 0, `${valid.stdout}${valid.stderr}`)
  assert.match(valid.stdout, /Prebuilt immutable images verified/)

  for (const options of [
    { backend: `sha256:${'3'.repeat(64)}` },
    { backendRevision: 'b'.repeat(40) },
    { webapp: `sha256:${'4'.repeat(64)}` },
    { webappRevision: 'c'.repeat(40) },
  ]) {
    const result = runImageValidation(options)
    assert.equal(result.status, 7, `${result.stdout}${result.stderr}`)
    assert.match(result.stderr, /prebuilt|revision label/i)
  }
})
