#!/usr/bin/env node
import { spawnSync } from 'node:child_process'
import { readdirSync, statSync } from 'node:fs'
import { resolve } from 'node:path'
import { performance } from 'node:perf_hooks'

const root = process.cwd()
const testFileCount = (path, pattern) => {
  const absolutePath = resolve(root, path)
  if (statSync(absolutePath).isFile()) return pattern.test(path) ? 1 : 0
  return readdirSync(absolutePath, { withFileTypes: true }).reduce((total, entry) => {
    if (entry.isDirectory() && ['.artifacts', 'node_modules', 'dist', 'build'].includes(entry.name)) {
      return total
    }
    const child = resolve(absolutePath, entry.name)
    if (entry.isDirectory()) return total + testFileCount(child, pattern)
    return total + (entry.isFile() && pattern.test(entry.name) ? 1 : 0)
  }, 0)
}

const testSuites = [
  ['shared contract', 'packages/contracts/src', /\.test\.[cm]?[jt]sx?$/],
  ['web app unit', 'webapp/tests', /\.test\.[cm]?[jt]sx?$/],
  ['website boundary', 'website/tests', /\.test\.[cm]?[jt]sx?$/],
  ['browser journey', 'webapp/e2e', /\.spec\.[cm]?[jt]sx?$/],
  ['repository environment', 'scripts/repo-env.test.mjs', /\.test\.[cm]?[jt]sx?$/],
  ['Selectel operator guards', 'tests', /^selectel-.*\.test\.mjs$/],
]
let discovered = 0
for (const [name, path, pattern] of testSuites) {
  const count = testFileCount(path, pattern)
  console.log(`${name}: ${count} test file(s)`)
  if (count === 0) {
    console.error(`No ${name} tests found; refusing to treat an empty suite as passed.`)
    process.exitCode = 1
    process.exit()
  }
  discovered += count
}
if (discovered === 0) {
  console.error('No tests discovered; refusing to run an empty verification gate.')
  process.exit(1)
}

const stages = [
  ['Architecture boundaries', ['run', 'architecture:check']],
  ['Dependency audit', ['run', 'audit'], 5 * 60 * 1000],
  ['Backend typecheck and Prisma generation', ['run', 'typecheck:backend']],
  ['Shared contracts typecheck', ['run', '--cwd', 'packages/contracts', 'typecheck']],
  ['Web app lint', ['run', 'lint']],
  ['Web app typecheck, including E2E types', ['run', 'typecheck:webapp']],
  ['Web app production bundling', ['run', '--cwd', 'webapp', 'vite', 'build']],
  ['Website content/type check', ['run', 'typecheck:website']],
  ['Website production build', ['run', 'build:website']],
  ['Tool and Selectel guard tests', ['run', 'test:tools']],
  ['Shared contract tests', ['run', 'test:contracts']],
  ['Backend unit tests', ['run', 'test:backend:unit']],
  ['Web app unit tests', ['run', 'test:webapp']],
  ['Website boundary tests', ['run', 'test:website']],
  ['Backend PostgreSQL integration tests', ['run', 'test:backend:integration']],
  ['Critical browser journeys', ['run', 'e2e:webapp']],
]

let failed = false
for (const [name, args, timeoutMs] of stages) {
  const started = performance.now()
  console.log(`\n==> ${name}`)
  const result = spawnSync('bun', args, {
    stdio: 'inherit',
    shell: process.platform === 'win32',
    ...(timeoutMs === undefined ? {} : { timeout: timeoutMs }),
  })
  const elapsed = ((performance.now() - started) / 1000).toFixed(1)
  if (result.error) {
    const reason = result.error.code === 'ETIMEDOUT'
      ? `timed out after ${timeoutMs / 1000}s`
      : `could not start: ${result.error.message}`
    console.error(`<== ${name} FAILED (${reason}, ${elapsed}s)`)
    failed = true
    break
  }
  if (result.status !== 0) {
    console.error(`<== ${name} FAILED (exit ${result.status ?? result.signal ?? 'unknown'}, ${elapsed}s)`)
    failed = true
    break
  }
  console.log(`<== ${name} passed (${elapsed}s)`)
}

if (failed) process.exitCode = 1
else console.log('\nLocal publication verification passed.')
