import { mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import test from 'node:test'
import assert from 'node:assert/strict'

const root = resolve(import.meta.dirname, '..')
const helper = resolve(root, 'deploy/selectel/in-place-file.sh')
const bashPath = (path) => {
  if (process.platform !== 'win32') return path
  const match = path.match(/^([A-Za-z]):[\\/](.*)$/)
  return match ? `/mnt/${match[1].toLowerCase()}/${match[2].replaceAll('\\', '/')}` : path.replaceAll('\\', '/')
}
const shellQuote = (value) => `'${bashPath(value).replaceAll("'", "'\\''")}'`

const runHelper = (...args) => spawnSync('bash', [bashPath(helper), ...args.map(bashPath)], {
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

test('valid candidate activation changes bytes while preserving active inode', () => {
  const { active, candidate } = makeFiles()
  const inodeBefore = statSync(active).ino

  const result = runHelper('activate', candidate, active)

  assert.equal(result.status, 0, result.stderr)
  assert.equal(statSync(active).ino, inodeBefore)
  assert.equal(readFileSync(active, 'utf8'), readFileSync(candidate, 'utf8'))
})

test('failed candidate validation leaves active bytes and inode unchanged', () => {
  const { active, candidate } = makeFiles()
  const beforeBytes = readFileSync(active)
  const inodeBefore = statSync(active).ino
  const result = spawnSync('bash', ['-c', [
    'set -eu',
    'validator() { return 1; }',
    `if validator; then bash ${shellQuote(helper)} activate ${shellQuote(candidate)} ${shellQuote(active)}; fi`,
  ].join('\n')], { encoding: 'utf8' })

  assert.equal(result.status, 0, result.stderr)
  assert.deepEqual(readFileSync(active), beforeBytes)
  assert.equal(statSync(active).ino, inodeBefore)
})

test('rollback restores backup bytes while preserving active inode', () => {
  const { active, candidate, backup } = makeFiles()
  const inodeBefore = statSync(active).ino
  assert.equal(runHelper('activate', candidate, active).status, 0)

  const result = runHelper('restore', backup, active)

  assert.equal(result.status, 0, result.stderr)
  assert.equal(statSync(active).ino, inodeBefore)
  assert.equal(readFileSync(active, 'utf8'), readFileSync(backup, 'utf8'))
})
