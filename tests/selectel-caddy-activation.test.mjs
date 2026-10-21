import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import test from 'node:test'
import assert from 'node:assert/strict'
import { bashExecutable, gitBashPath } from './bash-runtime.mjs'

const root = resolve(import.meta.dirname, '..')
const helper = resolve(root, 'deploy/selectel/in-place-file.sh')
const redeployPath = resolve(root, 'deploy/selectel/redeploy.sh')

const runHelper = (...args) => spawnSync(bashExecutable, [gitBashPath(helper), ...args.map(gitBashPath)], {
  encoding: 'utf8',
  env: { ...process.env },
})

const makeFiles = () => {
  const dir = mkdtempSync(resolve(tmpdir(), 'memoly-caddy-'))
  const active = resolve(dir, 'Caddyfile')
  const candidate = resolve(dir, 'candidate.Caddyfile')
  const backup = resolve(dir, 'backup.Caddyfile')
  writeFileSync(active, 'app.memoly.ru {\n\treverse_proxy static:80\n}\n')
  writeFileSync(candidate, 'app.memoly.ru {\n\treverse_proxy static:80\n\theader X-Diagnostic enabled\n}\n')
  writeFileSync(backup, readFileSync(active))
  return { dir, active, candidate, backup }
}

function runProductionActivation(active, candidate, directory) {
  const mounted = resolve(directory, 'container-Caddyfile')
  const events = resolve(directory, 'docker-events')
  const script = `
set -euo pipefail
. '${gitBashPath(redeployPath)}'
SCRIPT_DIR='${gitBashPath(resolve(root, 'deploy/selectel'))}'
SERVER_EDGE_CADDYFILE='${gitBashPath(active)}'
EDGE_CANDIDATE='${gitBashPath(candidate)}'
BACKUP_DIR='${gitBashPath(resolve(directory, 'backups'))}'
GATEWAY_BACKUP_FILE=''
GATEWAY_CONTAINER=fixture
GATEWAY_CADDY_CONFIG=/container/Caddyfile
GATEWAY_CADDYFILE=/container/Caddyfile
MOUNTED_CADDYFILE='${gitBashPath(mounted)}'
DOCKER_EVENTS='${gitBashPath(events)}'
mkdir -p "$BACKUP_DIR"
docker() {
  case "$1" in
    cp)
      cp -- "$2" "$MOUNTED_CADDYFILE"
      ;;
    exec)
      case "$3:$4" in
        caddy:validate)
          printf 'VALIDATE:%s\\n' "$*" >> "$DOCKER_EVENTS"
          if grep -q 'INVALID_CADDY_FIXTURE' "$MOUNTED_CADDYFILE"; then return 42; fi
          ;;
        sha256sum:*) sha256sum "$MOUNTED_CADDYFILE" ;;
        caddy:reload) printf 'RELOAD:%s\\n' "$*" >> "$DOCKER_EVENTS" ;;
        *) printf 'UNEXPECTED:%s\\n' "$*" >> "$DOCKER_EVENTS"; return 99 ;;
      esac
      ;;
    *) printf 'UNEXPECTED:%s\\n' "$*" >> "$DOCKER_EVENTS"; return 99 ;;
  esac
}
activate_gateway
`
  const result = spawnSync(bashExecutable, ['-s'], { input: script, encoding: 'utf8', timeout: 30_000 })
  return { result, events: readFileSync(events, 'utf8') }
}

test('valid candidate activation changes bytes while preserving active inode', () => {
  const { dir, active, candidate } = makeFiles()
  try {
    const inodeBefore = statSync(active).ino
    const result = runHelper('activate', candidate, active)
    assert.equal(result.status, 0, result.stderr)
    assert.equal(statSync(active).ino, inodeBefore)
    assert.equal(readFileSync(active, 'utf8'), readFileSync(candidate, 'utf8'))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('production Caddy validation failure prevents activation and reload', () => {
  const { dir, active, candidate } = makeFiles()
  try {
    writeFileSync(candidate, 'INVALID_CADDY_FIXTURE\n')
    const beforeBytes = readFileSync(active)
    const inodeBefore = statSync(active).ino
    const { result, events } = runProductionActivation(active, candidate, dir)

    assert.equal(result.status, 42, result.stdout + result.stderr)
    assert.match(events, /VALIDATE:.*caddy validate --config \/container\/Caddyfile --adapter caddyfile/)
    assert.doesNotMatch(events, /RELOAD:/)
    assert.deepEqual(readFileSync(active), beforeBytes)
    assert.equal(statSync(active).ino, inodeBefore)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('production Caddy validator control reaches in-place activation and reload', () => {
  const { dir, active, candidate } = makeFiles()
  try {
    const inodeBefore = statSync(active).ino
    const { result, events } = runProductionActivation(active, candidate, dir)
    assert.equal(result.status, 0, result.stdout + result.stderr)
    assert.match(events, /VALIDATE:/)
    assert.match(events, /RELOAD:/)
    assert.equal(statSync(active).ino, inodeBefore)
    assert.equal(readFileSync(active, 'utf8'), readFileSync(candidate, 'utf8'))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('rollback restores backup bytes while preserving active inode', () => {
  const { dir, active, candidate, backup } = makeFiles()
  try {
    const inodeBefore = statSync(active).ino
    assert.equal(runHelper('activate', candidate, active).status, 0)
    const result = runHelper('restore', backup, active)
    assert.equal(result.status, 0, result.stderr)
    assert.equal(statSync(active).ino, inodeBefore)
    assert.equal(readFileSync(active, 'utf8'), readFileSync(backup, 'utf8'))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
