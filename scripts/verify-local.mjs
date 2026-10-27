#!/usr/bin/env node
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { relative, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { performance } from 'node:perf_hooks'

const CRITICAL = /(^|\/)(backend\/src\/(?:db\.ts|env\.ts|app\.ts|storage\/|outbox\/|modules\/(?:auth|families|media|uploads|users|memories|max)(?:\/|$))|backend\/prisma\/|backend\/scripts\/|packages\/|scripts\/|tests\/|infra\/|deploy\/|\.github\/|\.githooks\/)|(^|\/)(package\.json|bun\.lock|bun\.lockb|Dockerfile[^/]*|.*\.ya?ml|verify-local[^/]*\.mjs|(?:vite|playwright|tsconfig|eslint)[^/]*(?:\.config\.[cm]?[jt]s|\.json))$/i
const STANDARD = /(^|\/)(backend\/|webapp\/|website\/)/i
const DOCS = /(^|\/)(docs\/|references\/|templates\/)|(^|\/)(AGENTS\.md|README[^/]*|CHANGELOG[^/]*)$/i
const FAST_SAFE = /\.(css|scss|sass|less|md|mdx|txt)$/i
const FRONTEND_ASSET = /^(webapp\/(?:public\/assets|src\/assets)\/|website\/public\/|assets\/)/i
const RASTER_ASSET = /\.(webp|png|jpe?g|avif|ico)$/i
const FRONTEND_SCOPE_CLI = 'deploy/selectel/frontend-scope.sh'
const BASH_EXECUTABLE = process.platform === 'win32' ? 'C:/Program Files/Git/bin/bash.exe' : 'bash'
const ACCEPTED_UI_V4_SHA = 'afdb408f8bbf22b564c86bb8d33a83261f55cc48'

function isFastSafe(path) {
  return FAST_SAFE.test(path) || (FRONTEND_ASSET.test(path) && RASTER_ASSET.test(path))
}

function git(args, options = {}) {
  const result = spawnSync('git', args, { encoding: 'utf8', ...options })
  if (result.status !== 0) throw new Error(result.stderr?.trim() || `git ${args.join(' ')} failed`)
  return result.stdout.trim()
}

function gitBytes(args) {
  const result = spawnSync('git', args, { encoding: null, maxBuffer: 32 * 1024 * 1024 })
  if (result.status !== 0) throw new Error(result.stderr?.toString().trim() || `git ${args.join(' ')} failed`)
  return result.stdout
}

function nulPaths(args) {
  const output = gitBytes(args)
  if (output.length && output.at(-1) !== 0) throw new Error(`Git returned an ambiguous path list for ${args.join(' ')}.`)
  const values = output.toString('utf8').split('\0')
  values.pop()
  if (values.some((path) => !path || path.includes('\n') || path.includes('\r') || path.includes('\ufffd'))) {
    throw new Error('Changed paths contain an ambiguous or unsupported filename.')
  }
  return values
}

function changedNames(base) {
  const committed = parseNameStatus(nulPaths(['diff', '--name-status', '-z', '--find-renames', base, 'HEAD', '--']))
  const staged = parseNameStatus(nulPaths(['diff', '--cached', '--name-status', '-z', '--find-renames', 'HEAD', '--']))
  const local = parseNameStatus(nulPaths(['diff', '--name-status', '-z', '--find-renames', 'HEAD', '--']))
  const untracked = nulPaths(['ls-files', '--others', '--exclude-standard', '-z'])
  // Git already uses '/' separators; a literal backslash must reach the invalid-path guard.
  return [...new Set([...committed, ...staged, ...local, ...untracked])].sort()
}

function parseNameStatus(values) {
  const paths = []
  for (let i = 0; i < values.length;) {
    const status = values[i++]
    const count = /^[RC]/.test(status) ? 2 : 1
    if (!/^(?:A|C\d*|D|M|R\d*|T|U|X|B)$/.test(status) || i + count > values.length) {
      throw new Error('Git returned an unsupported or malformed changed-path record.')
    }
    paths.push(...values.slice(i, i + count))
    i += count
  }
  return paths
}

export function validateFrontendScope(paths, { repositoryRoot = process.cwd(), requireRuntime = true } = {}) {
  if (!paths.length) throw new Error('Frontend verification requires a non-empty change set.')
  const result = spawnSync(BASH_EXECUTABLE, [resolve(repositoryRoot, FRONTEND_SCOPE_CLI), 'classify', ...paths], { encoding: 'utf8', cwd: repositoryRoot })
  if (result.status !== 0) throw new Error(result.stderr?.trim() || 'Frontend path classification failed closed.')
  let runtime = false
  for (const path of paths) {
    const classification = result.stdout.split(/\r?\n/).find((line) => line.startsWith(`${path}\t`))?.split('\t')[1]
    if (!['A', 'R'].includes(classification)) throw new Error(`Frontend verification refuses sensitive or unknown path: ${path}`)
    if (/^webapp\/(?:src|public)\//.test(path)) runtime = true
  }
  if (requireRuntime && !runtime) throw new Error('Frontend verification requires at least one changed production frontend input.')
  return { paths, runtime }
}

function validateFrontendLineage(base) {
  if (!/^[0-9a-f]{40}$/.test(base)) throw new Error('--base must be the full deployed backend commit SHA.')
  const resolved = git(['rev-parse', '--verify', `${base}^{commit}`])
  if (resolved !== base) throw new Error('--base must resolve to the exact full commit SHA supplied.')
  const remote = git(['rev-parse', '--verify', 'refs/remotes/origin/main'])
  for (const [ancestor, descendant, message] of [
    [base, remote, 'deployed backend base must be an ancestor of accepted origin/main.'],
    [base, 'HEAD', 'candidate HEAD must descend from the deployed backend base.'],
    [ACCEPTED_UI_V4_SHA, base, 'deployed backend base must contain accepted UI v4.'],
    [ACCEPTED_UI_V4_SHA, 'HEAD', 'candidate must contain accepted UI v4.'],
  ]) {
    if (spawnSync('git', ['merge-base', '--is-ancestor', ancestor, descendant]).status !== 0) throw new Error(message)
  }
  return { base, remote }
}

function validateFrontendModes(base) {
  const summaries = [
    git(['diff', '--summary', '--find-renames', base, 'HEAD', '--']),
    git(['diff', '--summary', '--find-renames', 'HEAD', '--']),
    git(['diff', '--cached', '--summary', '--find-renames', 'HEAD', '--']),
  ].join('\n')
  if (/mode change|create mode 12|create mode 16|type change/i.test(summaries)) {
    throw new Error('Frontend verification refuses symlink, submodule, or executable mode changes.')
  }
}

function frontendPlan(paths, base, journeys, journeyGreps, repositoryRoot = process.cwd()) {
  const commands = [
    ['Committed frontend diff whitespace validation', ['git', ['diff', '--check', base, 'HEAD', '--']]],
    ['Working tree whitespace validation', ['git', ['diff', '--check', 'HEAD', '--']]],
    ['Web app typecheck', ['bun', ['run', 'typecheck:webapp']]],
    ['Web app lint', ['bun', ['run', 'lint']]],
    ['Web app production build', ['bun', ['run', 'build:webapp']]],
  ]
  const tests = relatedWebappTests(paths, repositoryRoot)
  if (tests.length) commands.push(['Related web app unit tests', ['bun', ['test', ...tests]]])
  for (const [index, journey] of journeys.entries()) {
    const dedicatedConfig = journey.replace(/\.spec\.ts$/, '.playwright.config.ts')
    const config = existsSync(resolve(repositoryRoot, dedicatedConfig)) ? dedicatedConfig : 'webapp/playwright.max.config.ts'
    const args = ['run', '--cwd', 'webapp', 'e2e', `--config=${config.replace(/^webapp\//, '')}`, journey.replace(/^webapp\//, '')]
    if (journeyGreps[index]) args.push(`--grep=${journeyGreps[index].replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`)
    commands.push([`Browser journey ${journey}`, ['bun', args]])
  }
  return commands
}

export function executePlan(plan, runner = spawnSync) {
  const results = []
  for (const [name, [command, args]] of plan) {
    console.log(`\n==> ${name}`)
    const started = performance.now()
    const result = runner(command, args, {
      encoding: 'utf8', maxBuffer: 32 * 1024 * 1024,
    })
    if (result.stdout) process.stdout.write(result.stdout)
    if (result.stderr) process.stderr.write(result.stderr)
    const evidenceError = result.status === 0 && isTestStage(name) && !name.includes('PostgreSQL integration')
      ? testEvidenceError(name, `${result.stdout ?? ''}\n${result.stderr ?? ''}`)
      : null
    const durationSeconds = Number(((performance.now() - started) / 1000).toFixed(1))
    const status = result.error || evidenceError ? 1 : result.status ?? 1
    console.log(`<== ${name} ${status === 0 ? 'passed' : 'FAILED'} (${durationSeconds}s)`)
    results.push({ name, status, error: result.error?.message ?? evidenceError ?? undefined, durationSeconds })
    if (result.error || result.status !== 0 || evidenceError) break
  }
  return results
}

function isTestStage(name) {
  return /\btests?\b|\bintegration\b|\bjourneys?\b/i.test(name)
}

function testEvidenceError(name, output) {
  if (/host-sampler Python/i.test(name)) {
    const ran = Number(output.match(/^Ran\s+(\d+)\s+tests?\s+in\s+/im)?.[1] ?? 0)
    if (/\(skipped\s*=\s*\d+\)/i.test(output)) return `${name} reported skipped required Python test(s).`
    if (ran === 0 || !/^OK\s*$/im.test(output)) return `${name} did not report a positive unittest run followed by OK.`
    return null
  }
  if (/journeys?/i.test(name)) {
    const passed = Number(output.match(/(\d+)\s+passed\b/i)?.[1] ?? 0)
    const skipped = Number(output.match(/(\d+)\s+skipped\b/i)?.[1] ?? 0)
    const notRun = Number(output.match(/(\d+)\s+(?:did not run|not run)\b/i)?.[1] ?? 0)
    if (skipped || notRun) return `${name} reported skipped or unrun required journeys.`
    return passed > 0 ? null : `${name} did not report any executed passing journeys.`
  }
  // Read only the final Bun summary. The runner's own regression tests intentionally
  // execute child fixtures that print skip/failure summaries inside their output.
  const parsed = bunSummary(output)
  if (!parsed) return `${name} did not report a recognized Bun test summary.`
  const { passed, skipped, filtered } = parsed
  if (skipped > 0) return `${name} reported ${skipped} skipped required test(s).`
  if (/\btodo\b|\(todo\)/i.test(output.slice(parsed.start, parsed.end))) return `${name} reported a TODO test.`
  const expectedFiltered = name === 'MAX and platform-neutral shared contract tests' ? 3
    : 0
  if (filtered !== expectedFiltered) return `${name} reported ${filtered} filtered test(s); expected ${expectedFiltered} declared historical exclusions.`
  if (passed === 0) return `${name} did not report any executed passing tests.`
  return null
}

function dedupeCommands(commands) {
  const seen = new Set()
  return commands.filter((entry) => {
    const key = JSON.stringify(entry[1])
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function bunSummary(output) {
  const ran = [...output.matchAll(/Ran\s+\d+\s+tests?\s+across\s+\d+\s+files?\b[^\n]*/gi)].at(-1)
  if (!ran) return null
  const end = ran.index + ran[0].length
  const before = output.slice(0, ran.index)
  const pass = [...before.matchAll(/\b(\d+)\s+pass\b/gi)].at(-1)
  if (!pass) return null
  const start = pass.index
  const block = output.slice(start, end)
  return {
    passed: Number(pass[1]),
    skipped: Number(block.match(/\b(\d+)\s+skip\b/i)?.[1] ?? 0),
    filtered: Number(block.match(/\b(\d+)\s+filtered out\b/i)?.[1] ?? 0),
    start, end,
  }
}

export function explainChanges(paths, { repositoryRoot = process.cwd() } = {}) {
  const reasons = [...new Set(paths)].sort().map((path) => {
    const result = (profile, rule, message) => ({ path, profile, rule, message })
    if (!path || /[\\\r\n\t]/.test(path) || path.startsWith('/') || path.split('/').some((part) => !part || part === '.' || part === '..')) {
      return result('review-required', 'invalid-path', 'Ambiguous changed path; establish its repository-relative identity.')
    }
    if (CRITICAL.test(path) && !DOCS.test(path)) {
      return result('full', 'critical-path', 'Sensitive source, contracts, configuration or verification/release tooling.')
    }
    if (path.startsWith('webapp/')) {
      const scoped = spawnSync(BASH_EXECUTABLE, [resolve(repositoryRoot, FRONTEND_SCOPE_CLI), 'classify', path], { encoding: 'utf8', cwd: repositoryRoot })
      const classification = scoped.stdout?.trim().split('\t')
      if (scoped.status !== 0 || classification?.[0] !== path || !['A', 'R', 'D'].includes(classification?.[1])) {
        return result('review-required', 'unresolved-frontend-path', 'Frontend policy did not classify this path; inspect the path and policy before running checks.')
      }
      if (classification[1] === 'D') return result('full', 'sensitive-frontend-path', 'Frontend policy marks this boundary sensitive (D).')
    }
    if (DOCS.test(path) || isFastSafe(path)) return result('fast', 'documentation-or-cosmetic', 'Documentation, stylesheet or recognized raster asset.')
    if (STANDARD.test(path)) return result('standard', 'scoped-package-source', 'Scoped package source/test; run affected checks and independent review.')
    return result('review-required', 'unknown-path', 'No scope rule matches; classify the file through a bounded review and a tested policy rule.')
  })
  if (!reasons.length) reasons.push({ path: '(no changed paths)', profile: 'review-required', rule: 'empty-scope', message: 'Select the intended comparison base before verification.' })
  const required = reasons.some((item) => item.profile === 'review-required') ? 'review-required'
    : reasons.some((item) => item.profile === 'full') ? 'full'
      : reasons.some((item) => item.profile === 'standard') ? 'standard' : 'fast'
  return { required, reasons }
}

export function classifyChanges(paths) {
  return explainChanges(paths).required
}

const rank = { fast: 0, standard: 1, full: 2 }
function assertProfile(value) {
  if (typeof value !== 'string' || !Object.hasOwn(rank, value)) throw new Error(`Unknown verification profile "${value}"; use fast, standard, or full.`)
  return value
}

function sourceSnapshot() {
  const sha = git(['rev-parse', 'HEAD'])
  const diff = git(['diff', '--binary', 'HEAD', '--'])
  const untracked = nulPaths(['ls-files', '--others', '--exclude-standard', '-z']).sort()
  const hash = createHash('sha256').update(diff)
  for (const file of untracked) {
    hash.update(`\0${file}\0`)
    try { hash.update(readFileSync(file)) } catch { hash.update('<unreadable>') }
  }
  const dirty = Boolean(diff || untracked.length)
  return { sha, dirty, treeHash: hash.digest('hex') }
}

function formatReasons(reasons) {
  return reasons.map(({ path, profile, rule, message }) => `REASON ${profile} ${path}: ${rule} — ${message}`).join('\n')
}

function validateReason(reason) {
  if (typeof reason !== 'string' || !reason.trim() || reason.length > 240 || /[\r\n]/.test(reason)) {
    throw new Error('--reason must be a non-empty single-line explanation of at most 240 characters.')
  }
  return reason.trim()
}

export function selectProfile({ paths, requested, reason }) {
  if (requested !== undefined) assertProfile(requested)
  if (reason !== undefined) reason = validateReason(reason)
  const { required, reasons } = explainChanges(paths)
  if (required === 'review-required') {
    throw new Error(`REVIEW_REQUIRED: verification scope is unresolved. No checks were started.\n${formatReasons(reasons)}\nReview the listed paths and add a narrow tested classification rule; --profile cannot bypass unresolved scope.`)
  }
  const selected = requested ? assertProfile(requested) : required
  if (rank[selected] < rank[required]) {
    throw new Error(`Profile downgrade refused: ${selected} was requested but changes require ${required}.\n${formatReasons(reasons)}`)
  }
  if (selected === 'full' && required !== 'full' && !reason) {
    throw new Error(`Manual FULL escalation requires --reason naming an explicit FULL request or a concrete reviewed risk. A complete task review uses the automatic profile.\n${formatReasons(reasons)}`)
  }
  return { profile: selected, required, paths, reasons, reason }
}

export function planFor(profile, paths = [], base = 'refs/remotes/origin/main', repositoryRoot = process.cwd()) {
  if (profile === 'review-required') throw new Error('REVIEW_REQUIRED: resolve the changed-path scope before planning checks.')
  assertProfile(profile)
  const browserJourneys = profile === 'fast' ? [] : changedBrowserJourneys(paths, repositoryRoot)
  const commands = [['Git whitespace and patch validation', ['git', ['diff', '--check', `${base}...HEAD`]]], ['Working tree whitespace validation', ['git', ['diff', '--check', 'HEAD']]]]
  if (profile === 'fast') {
    if (paths.some((path) => /^(webapp\/(?:public\/assets|src\/assets)\/|assets\/)/i.test(path) && RASTER_ASSET.test(path))) {
      commands.push(['Frontend production build', ['bun', ['run', 'build:webapp']]])
    }
    if (paths.some((path) => path.startsWith('website/public/') && RASTER_ASSET.test(path))) commands.push(['Website production build', ['bun', ['run', 'build:website']]])
    if (paths.some((path) => path.startsWith('webapp/') && /\.(tsx?|jsx?|css|scss|sass|less)$/i.test(path))) {
      commands.push(['Frontend typecheck', ['bun', ['run', 'typecheck:webapp']]])
      commands.push(['Frontend production build', ['bun', ['run', 'build:webapp']]])
    }
    if (paths.some((path) => path.startsWith('website/') && /\.(css|scss|sass|less)$/i.test(path))) {
      commands.push(['Website production build', ['bun', ['run', 'build:website']]])
    }
    return dedupeCommands(commands)
  }

  if (paths.some((path) => path.startsWith('backend/'))) {
    commands.push(['Backend typecheck and Prisma generation', ['bun', ['run', 'typecheck:backend']]])
    const testFiles = relatedBackendTests(paths, repositoryRoot)
    const unit = testFiles.filter((path) => !path.includes('.integration.test.') && !path.includes('.live.test.'))
    const integration = testFiles.filter((path) => path.includes('.integration.test.'))
    if (unit.length) commands.push(['Changed backend unit tests', ['bun', ['test', ...unit.map((path) => `./backend/${path}`)]]])
    if (integration.length) commands.push(['Changed backend PostgreSQL integration tests', ['bun', ['run', 'test:backend:integration', '--', ...integration]]])
    if (!unit.length && !integration.length && paths.some((path) => path.includes('.test.') && existsSync(resolve(repositoryRoot, path)))) {
      throw new Error(`No backend tests discovered for changed paths: ${paths.join(', ')}`)
    }
  }
  if (paths.some((path) => path.startsWith('webapp/'))) {
    commands.push(['Web app typecheck', ['bun', ['run', 'typecheck:webapp']]])
    commands.push(['Web app lint', ['bun', ['run', 'lint']]])
    commands.push(['Web app production build', ['bun', ['run', 'build:webapp']]])
    const tests = relatedWebappTests(paths, repositoryRoot)
    if (tests.length) commands.push(['Changed web app unit tests', ['bun', ['test', ...tests]]])
    else console.log('No targeted Web app unit test maps to these paths; typecheck, lint, and production build remain required.')
    if (profile === 'standard') commands.push(...browserJourneys)
  }
  if (paths.some((path) => path.startsWith('website/'))) {
    commands.push(['Website typecheck and build', ['bun', ['run', 'typecheck:website']]])
    commands.push(['Website production build', ['bun', ['run', 'build:website']]])
    commands.push(['Website boundary tests', ['bun', ['run', 'test:website']]])
  }
  if (paths.some((path) => path.startsWith('packages/contracts/'))) {
    commands.push(['Shared contracts typecheck', ['bun', ['run', '--cwd', 'packages/contracts', 'typecheck']]])
    commands.push(['Shared contract tests', ['bun', ['run', 'test:contracts']]])
    commands.push(['Backend typecheck and Prisma generation', ['bun', ['run', 'typecheck:backend']]])
    commands.push(['Web app typecheck', ['bun', ['run', 'typecheck:webapp']]])
  }
  if (paths.some((path) => path.includes('verify-local'))) commands.push(['Verification runner tests', ['bun', ['test', 'scripts/verify-local.test.mjs']]])
  if (profile === 'standard' && commands.length <= 2) {
    commands.push(['Repository tool and Selectel guard tests', ['bun', ['run', 'test:tools']]])
  }
  if (profile === 'standard' && paths.some(isArchitectureBoundary)) {
    commands.push(['Architecture boundaries', ['bun', ['run', 'architecture:check']]])
  }
  if (profile === 'full') {
    const full = [
      ['Committed diff whitespace validation', ['git', ['diff', '--check', `${base}...HEAD`]]],
      ['Working tree whitespace validation', ['git', ['diff', '--check', 'HEAD']]],
      ['Architecture boundaries', ['bun', ['run', 'architecture:check']]],
      ['Dependency audit', ['bun', ['run', 'audit']]],
      ['Backend typecheck', ['bun', ['run', 'typecheck:backend']]],
      ['Shared contracts typecheck', ['bun', ['run', '--cwd', 'packages/contracts', 'typecheck']]],
      ['Web app typecheck', ['bun', ['run', 'typecheck:webapp']]],
      ['Web app lint', ['bun', ['run', 'lint']]],
      ['Web app production build', ['bun', ['run', 'build:webapp']]],
      ['Website typecheck and build', ['bun', ['run', 'typecheck:website']]],
      ['Website production build', ['bun', ['run', 'build:website']]],
      ['Repository and Selectel safety tests', ['bun', ['run', 'test:tools']]],
      ['MAX and platform-neutral shared contract tests', ['bun', ['run', 'test:contracts:max']]],
      ['Backend unit tests (MAX/platform-neutral catalog)', ['bun', ['run', '--cwd', 'backend', 'test:unit', '--', '--max-only']]],
      ['Web app unit tests', ['bun', ['run', 'test:webapp']]],
      ['Website boundary tests', ['bun', ['run', 'test:website']]],
      ['MAX auth/session PostgreSQL integration', ['bun', ['run', '--cwd', 'backend', 'test:integration', '--', '--max-only']]],
      ['MAX Web/PWA browser journeys', ['bun', ['run', 'e2e:webapp:max']]],
      ['Control owner browser journeys', ['bun', ['run', '--cwd', 'webapp', 'e2e', '--config=playwright.control.config.ts']]],
    ]
    if (paths.includes('deploy/selectel/control/sampler.py')) {
      const python = process.platform === 'win32' ? 'python' : 'python3'
      full.splice(full.length - 1, 0, ['Control host-sampler Python tests', [python, ['-B', '-m', 'unittest', 'discover', '-s', 'deploy/selectel/control', '-p', '*test*.py']]])
    }
    return dedupeCommands([...full, ...browserJourneys])
  }
  if (commands.length === 1) throw new Error(`No mandatory STANDARD checks mapped for changed paths: ${paths.join(', ') || '(none)'}`)
  return dedupeCommands(commands)
}

function relatedBackendTests(paths, repositoryRoot) {
  const files = new Set()
  for (const changed of paths.filter((path) => path.startsWith('backend/'))) {
    if (/\.test\.[cm]?[jt]sx?$/i.test(changed)) {
      const relativePath = changed.replace(/^backend\//, '')
      if (existsSync(resolve(repositoryRoot, changed))) files.add(relativePath)
      continue
    }
    const normalized = changed.replaceAll('\\', '/')
    const moduleMatch = normalized.match(/^(backend\/src\/modules\/[^/]+)/)
    const testRoot = moduleMatch?.[1] ?? (normalized.startsWith('backend/src/') ? normalized.slice(0, normalized.lastIndexOf('/')) : null)
    if (!testRoot) continue
    collectBackendTests(resolve(repositoryRoot, testRoot), files, repositoryRoot)
  }
  return [...files].sort()
}

const MAX_BROWSER_SPECS = new Set([
  'max-browser-link.spec.ts', 'albums.spec.ts', 'children.spec.ts', 'gifts.spec.ts',
  'comments.spec.ts', 'comments-state.spec.ts', 'memoly-v4.spec.ts', 'voice-player.spec.ts',
  'video-lifecycle.spec.ts', 'shared-author-avatar.spec.ts',
])

function changedBrowserJourneys(paths, repositoryRoot) {
  return [...new Set(paths)].sort().filter((path) => /^webapp\/e2e\/[^/]+\.(?:spec|max-e2e)\.ts$/.test(path) && existsSync(resolve(repositoryRoot, path))).map((path) => {
    const dedicated = path.replace(/\.(?:spec|max-e2e)\.ts$/, '.playwright.config.ts')
    const config = existsSync(resolve(repositoryRoot, dedicated)) ? dedicated
      : path === 'webapp/e2e/control-browser-link.spec.ts' ? 'webapp/playwright.control.config.ts'
        : MAX_BROWSER_SPECS.has(path.split('/').at(-1)) ? 'webapp/playwright.max.config.ts' : null
    if (!config || !existsSync(resolve(repositoryRoot, config))) {
      throw new Error(`REVIEW_REQUIRED: no supported Playwright config for changed spec ${path}. Add a dedicated config or a tested route before running verification.`)
    }
    return [`Browser journey ${path}`, ['bun', ['run', '--cwd', 'webapp', 'e2e', `--config=${config.replace(/^webapp\//, '')}`, path.replace(/^webapp\//, '')]]]
  })
}

function relatedWebappTests(paths, repositoryRoot) {
  let candidates = []
  try { candidates = readdirSync(resolve(repositoryRoot, 'webapp/tests')).filter((file) => /\.test\.[jt]sx?$/i.test(file)) } catch { return [] }
  const changedTests = paths.filter((path) => /^webapp\/tests\/.*\.test\.[jt]sx?$/i.test(path) && existsSync(resolve(repositoryRoot, path))).map((path) => `./${path}`)
  if (changedTests.length) return changedTests
  const sourceStems = paths.filter((path) => path.startsWith('webapp/src/')).map((path) => path.split('/').at(-1).replace(/\.[^.]+$/, '').toLowerCase().replace(/[^a-z0-9]+/g, '-'))
  const matches = candidates.filter((file) => sourceStems.some((stem) => stem && (file.toLowerCase().includes(stem) || stem.includes(file.replace(/\.test\.[jt]sx?$/i, '').toLowerCase()))))
  return matches.map((file) => `./webapp/tests/${file}`)
}

function isArchitectureBoundary(path) {
  return /(^|\/)(modules|contracts|platform|composition)(\/|\.)/i.test(path)
}

function collectBackendTests(directory, files, repositoryRoot) {
  let entries
  try { entries = readdirSync(directory, { withFileTypes: true }) } catch { return }
  for (const entry of entries) {
    const path = resolve(directory, entry.name)
    if (entry.isDirectory()) collectBackendTests(path, files, repositoryRoot)
    else if (entry.isFile() && /\.test\.[cm]?[jt]sx?$/i.test(entry.name)) {
      files.add(relative(resolve(repositoryRoot, 'backend'), path).replaceAll('\\', '/'))
    }
  }
}

function parseArgs(args) {
  const out = { profile: undefined, reason: undefined, base: undefined, frontendBase: undefined, frontendReview: undefined, journey: [], journeyGrep: [], dryRun: false }
  const seen = new Set()
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === '--dry-run') {
      if (seen.has('dry-run')) throw new Error('--dry-run may only be provided once.')
      seen.add('dry-run')
      out.dryRun = true
    }
    else if (args[i] === '--journey') {
      const value = args[++i]
      if (!value || value.startsWith('--')) throw new Error('--journey requires a value.')
      if (out.journey.length >= 2) throw new Error('At most two --journey paths may be provided.')
      out.journey.push(value.replaceAll('\\', '/'))
    }
    else if (args[i] === '--journey-grep') {
      const value = args[++i]
      if (!value || value.startsWith('--') || value.length > 160 || /[\r\n]/.test(value)) throw new Error('--journey-grep requires a short single-line test title.')
      if (out.journeyGrep.length >= 2) throw new Error('At most two --journey-grep titles may be provided.')
      out.journeyGrep.push(value)
    }
    else if (args[i] === '--frontend-base' || args[i] === '--frontend-review') {
      const flag = args[i].slice(2)
      const value = args[++i]
      if (!value || value.startsWith('--')) throw new Error(`${args[i - 1]} requires a value.`)
      if (flag === 'frontend-base') out.frontendBase = value
      else out.frontendReview = value
    }
    else if (args[i] === '--profile' || args[i] === '--base' || args[i] === '--reason') {
      const flag = args[i].slice(2)
      if (seen.has(flag)) throw new Error(`${args[i]} may only be provided once.`)
      seen.add(flag)
      const value = args[++i]
      if (!value || value.startsWith('--')) throw new Error(`${args[i - 1]} requires a value.`)
      if (flag === 'profile') out.profile = value
      else if (flag === 'base') out.base = value
      else out.reason = validateReason(value)
    }
    else throw new Error(`Unknown argument: ${args[i]}`)
  }
  if (seen.has('profile') && out.profile !== 'frontend') assertProfile(out.profile)
  if (out.reason && out.profile === 'frontend') throw new Error('--reason does not replace the guarded FRONTEND release review receipts.')
  if (out.journey.length && out.profile !== 'frontend') throw new Error('--journey is only valid with --profile frontend.')
  if (out.journeyGrep.length && (out.profile !== 'frontend' || out.journeyGrep.length !== out.journey.length)) {
    throw new Error('Provide one --journey-grep title per --journey, only with --profile frontend.')
  }
  return out
}

function changedPaths(requestedBase) {
  const remote = git(['rev-parse', '--verify', 'refs/remotes/origin/main'])
  const trustedBase = git(['merge-base', remote, 'HEAD'])
  let base = trustedBase
  if (requestedBase) {
    const resolved = git(['rev-parse', '--verify', `${requestedBase}^{commit}`])
    const ancestor = spawnSync('git', ['merge-base', '--is-ancestor', resolved, 'HEAD'])
    if (ancestor.status !== 0) throw new Error('--base must be an ancestor of the verified HEAD.')
    const expandsTrustedRange = spawnSync('git', ['merge-base', '--is-ancestor', resolved, trustedBase])
    if (expandsTrustedRange.status === 0) base = resolved
  }
  try {
    // Preserve both sides of renames and use the existing unambiguous Git path parser.
    return { base, paths: changedNames(base) }
  } catch (error) {
    throw new Error(`REVIEW_REQUIRED: cannot determine changed paths: ${error.message}`)
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  if (options.profile === 'frontend') {
    if (!options.base) throw new Error('Frontend verification requires --base with the full deployed backend SHA.')
    if (!options.frontendBase) throw new Error('Frontend verification requires --frontend-base with the full deployed frontend SHA.')
    if (options.journey.length === 0) throw new Error('Frontend verification requires at least one --journey browser spec.')
    const { base } = validateFrontendLineage(options.base)
    const { base: frontendBase } = validateFrontendLineage(options.frontendBase)
    const backendPaths = changedNames(base)
    const frontendPaths = changedNames(frontendBase)
    const paths = [...new Set([...backendPaths, ...frontendPaths])].sort()
    validateFrontendScope(frontendPaths)
    validateFrontendModes(base)
    if (git(['status', '--porcelain']).length) throw new Error('Frontend review receipts require a clean committed candidate tree.')
    const candidateSha = git(['rev-parse', 'HEAD'])
    for (const reviewBase of [...new Set([base, frontendBase])]) {
      const verifyArgs = [resolve(FRONTEND_SCOPE_CLI), 'verify', reviewBase, candidateSha, 'local']
      if (options.frontendReview) verifyArgs.push(resolve(options.frontendReview))
      const checked = spawnSync(BASH_EXECUTABLE, verifyArgs, { encoding: 'utf8', cwd: process.cwd() })
      if (checked.status !== 0) throw new Error(checked.stderr?.trim() || `Frontend review failed for deployed base ${reviewBase}.`)
      process.stdout.write(checked.stdout)
    }
    for (const journey of options.journey) {
      if (!/^webapp\/e2e\/[^/]+\.spec\.ts$/.test(journey) || !existsSync(resolve(journey))) {
        throw new Error(`Browser journey must be an existing webapp/e2e/*.spec.ts file: ${journey}`)
      }
    }
    const plan = frontendPlan(paths, base, options.journey, options.journeyGrep)
    const snapshot = sourceSnapshot()
    console.log('Profile: frontend (explicit guarded static-release profile)')
    console.log(`Source SHA: ${snapshot.sha}`)
    console.log(`Comparison base SHA: ${base}`)
    console.log(`Working tree: ${snapshot.dirty ? `dirty; SHA256 ${snapshot.treeHash}` : `clean; tree ${git(['rev-parse', 'HEAD^{tree}'])}`}`)
    console.log(`Changed paths: ${paths.length}`)
    for (const [name, [command, args]] of plan) console.log(`PLAN ${name}: ${command} ${args.join(' ')}`)
    if (options.dryRun) {
      console.log('DRY RUN: plan only; no checks ran and this is not a PASS.')
      process.exitCode = 2
      return
    }
    const started = performance.now()
    const results = executePlan(plan)
    const failure = results.find((result) => result.status !== 0 || result.error)
    if (results.length !== plan.length || failure) {
      process.exitCode = failure?.status || 1
      return
    }
    const after = sourceSnapshot()
    if (after.sha !== snapshot.sha || after.dirty !== snapshot.dirty || after.treeHash !== snapshot.treeHash) {
      console.error('Source changed while verification was running; results do not apply to the final tree.')
      process.exitCode = 1
      return
    }
    console.log(`\nFRONTEND verification passed (${((performance.now() - started) / 1000).toFixed(1)}s).`)
    return
  }
  const { base, paths } = changedPaths(options.base)
  const selection = selectProfile({ paths, requested: options.profile, reason: options.reason })
  const snapshot = sourceSnapshot()
  const plan = planFor(selection.profile, paths, base)
  console.log(`Profile: ${selection.profile} (minimum required: ${selection.required})`)
  console.log(formatReasons(selection.reasons))
  if (selection.reason) console.log(`Requested profile reason: ${selection.reason}`)
  console.log(`Source SHA: ${snapshot.sha}`)
  console.log(`Comparison base SHA: ${base}`)
  console.log(`Working tree: ${snapshot.dirty ? `dirty; SHA256 ${snapshot.treeHash}` : `clean; tree ${git(['rev-parse', 'HEAD^{tree}'])}`}`)
  console.log(`Changed paths: ${paths.length}`)
  for (const [name, [command, args]] of plan) console.log(`PLAN ${name}: ${command} ${args.join(' ')}`)
  if (options.dryRun) {
    console.log('DRY RUN: plan only; no checks ran and this is not a PASS.')
    process.exitCode = 2
    return
  }
  const started = performance.now()
  const results = executePlan(plan)
  const failure = results.find((result) => result.status !== 0 || result.error)
  if (results.length !== plan.length || failure) {
    process.exitCode = failure?.status || 1
    return
  }
  const after = sourceSnapshot()
  if (after.sha !== snapshot.sha || after.dirty !== snapshot.dirty || after.treeHash !== snapshot.treeHash) {
    console.error('Source changed while verification was running; results do not apply to the final tree.')
    process.exitCode = 1
    return
  }
  console.log(`\n${selection.profile.toUpperCase()} verification passed (${((performance.now() - started) / 1000).toFixed(1)}s).`)
}

if (process.argv[1]?.replaceAll('\\', '/').endsWith('/scripts/verify-local.mjs')) {
  main().catch((error) => { console.error(error.message); process.exitCode = 1 })
}
