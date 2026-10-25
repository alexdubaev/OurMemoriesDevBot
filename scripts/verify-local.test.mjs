import { describe, expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { copyFileSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { bashExecutable, gitBashPath } from '../tests/bash-runtime.mjs'
import { classifyChanges, executePlan, planFor, selectProfile, validateFrontendScope } from './verify-local.mjs'

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const frontendScopeCli = resolve(repositoryRoot, 'deploy/selectel/frontend-scope.sh')
const sha256 = (value) => createHash('sha256').update(value).digest('hex')

function createFrontendRangeFixture() {
  const root = mkdtempSync(resolve(tmpdir(), 'memoly-frontend-range-'))
  const git = (...args) => {
    const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' })
    if (result.status !== 0) throw new Error(result.stderr)
    return result.stdout.trim()
  }
  const put = (path, contents) => {
    const target = resolve(root, path)
    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(target, contents)
  }
  git('init', '-b', 'main')
  git('config', 'user.name', 'Frontend Scope Fixture')
  git('config', 'user.email', 'frontend-scope@example.invalid')
  for (const path of [
    'deploy/selectel/frontend-safe-paths.txt', 'deploy/selectel/frontend-scope.sh',
    'deploy/selectel/frontend-release.sh', 'scripts/verify-local.mjs',
  ]) {
    const destination = resolve(root, path)
    mkdirSync(dirname(destination), { recursive: true })
    copyFileSync(resolve(repositoryRoot, path), destination)
  }
  put('webapp/src/features/feed/FeedPage.tsx', 'export const FeedPage = () => <main>before</main>\n')
  put('webapp/src/features/feed/presentation/memoly-feed.css', 'main { color: black; }\n')
  put('webapp/src/features/feed/video-lifecycle.ts', 'export const lifecycle = "before"\n')
  git('add', '.')
  git('commit', '-m', 'fixture base')
  const base = git('rev-parse', 'HEAD')
  put('webapp/src/features/feed/FeedPage.tsx', 'export const FeedPage = () => <main>reviewed UI</main>\n')
  put('webapp/src/features/feed/presentation/memoly-feed.css', 'main { color: navy; }\n')
  git('add', '.')
  git('commit', '-m', 'reviewed UI fixture')
  return { root, base, git, put }
}

function runFrontendScope(fixture, ...args) {
  return spawnSync(bashExecutable, [gitBashPath(resolve(fixture.root, 'deploy/selectel/frontend-scope.sh')), ...args], {
    cwd: fixture.root, encoding: 'utf8',
  })
}

describe('risk based verification', () => {
  test('frontend scope allows the feed stylesheet and family presentation while rejecting sensitive, unknown, and mixed changes', () => {
    expect(validateFrontendScope(['webapp/src/components/ui-v2/ChildHeaderV2.tsx'], { requireRuntime: true }).runtime).toBe(true)
    expect(validateFrontendScope(['webapp/src/features/feed/presentation/memoly-feed.css']).runtime).toBe(true)
    expect(validateFrontendScope(['webapp/src/features/family/family-hub.css']).runtime).toBe(true)
    expect(validateFrontendScope(['webapp/src/App.tsx']).runtime).toBe(true)
    expect(() => validateFrontendScope(['webapp/src/features/auth/SignIn.css'])).toThrow('sensitive or unknown')
    expect(validateFrontendScope(['webapp/src/features/feed/FeedPage.tsx']).runtime).toBe(true)
    expect(() => validateFrontendScope(['webapp/src/features/feed/video-lifecycle.ts'])).toThrow('sensitive or unknown')
    expect(() => validateFrontendScope(['webapp/src/platform/media/use-private-image-url.ts'])).toThrow('sensitive or unknown')
    expect(() => validateFrontendScope(['webapp/src/features/home/Widget.svg'])).toThrow('unknown path requires FULL')
    expect(validateFrontendScope(['webapp/src/main.tsx']).runtime).toBe(true)
    expect(validateFrontendScope(['webapp/src/platform/reaction-haptics.ts']).runtime).toBe(true)
    expect(validateFrontendScope(['webapp/src/features/family/model.ts']).runtime).toBe(true)
    expect(validateFrontendScope([
      'webapp/src/features/feed/presentation/memoly-feed.css',
      'webapp/src/features/feed/FeedPage.tsx',
    ]).runtime).toBe(true)
    expect(() => validateFrontendScope(['docs/release.md'])).toThrow('production frontend input')
    expect(() => validateFrontendScope(['deploy/selectel/ci-release.sh'])).toThrow('sensitive or unknown')
  })

  test('shared range verifier accepts CSS automatically, requires exact R receipts, rejects stale and D ranges', { timeout: 30_000 }, () => {
    const fixture = createFrontendRangeFixture()
    let reviewDirectory
    try {
      fixture.put('webapp/src/features/feed/FeedPage.tsx', 'export const FeedPage = () => <main>before</main>\n')
      fixture.git('add', '.')
      fixture.git('commit', '-m', 'CSS only')
      let candidate = fixture.git('rev-parse', 'HEAD')
      const cssOnly = runFrontendScope(fixture, 'verify', fixture.base, candidate, 'local')
      expect(cssOnly.status).toBe(0, cssOnly.stderr)

      fixture.put('webapp/src/features/feed/FeedPage.tsx', 'export const FeedPage = () => <main>reviewed UI</main>\n')
      fixture.git('add', '.')
      fixture.git('commit', '-m', 'review-required TSX')
      candidate = fixture.git('rev-parse', 'HEAD')
      const missing = runFrontendScope(fixture, 'verify', fixture.base, candidate, 'local')
      expect(missing.status).not.toBe(0)
      expect(missing.stderr).toContain('REVIEW_REQUIRED')

      const inspection = runFrontendScope(fixture, 'inspect', fixture.base, candidate)
      expect(inspection.status).toBe(0, inspection.stderr)
      const values = Object.fromEntries(inspection.stdout.trim().split(/\r?\n/).map((line) => line.split('=')))
      const fingerprint = values.FINGERPRINT
      reviewDirectory = mkdtempSync(resolve(tmpdir(), 'memoly-frontend-receipts-'))
      const report = 'Independent technical review\nChanged hunks checked\nImports, contracts, auth, access, media, storage, lifecycle, API and business rules checked\nBackend compatibility checked\nDecision: FRONTEND for the exact client UI range.\n'
      const reportSha = sha256(report)
      writeFileSync(resolve(reviewDirectory, `${fingerprint}.report`), report)
      writeFileSync(resolve(reviewDirectory, `${fingerprint}.receipt`), [
        'MEMOLY_FRONTEND_REVIEW=1', `BASE_SHA=${values.BASE_SHA}`, `CANDIDATE_TREE=${values.CANDIDATE_TREE}`,
        `DIFF_SHA256=${values.DIFF_SHA256}`, `POLICY_SHA256=${values.POLICY_SHA256}`,
        'REVIEWER_ID=independent-reviewer', 'DECISION=FRONTEND', `REPORT_SHA256=${reportSha}`, `FINGERPRINT=${fingerprint}`, '',
      ].join('\n'))
      const accepted = runFrontendScope(fixture, 'verify', fixture.base, candidate, 'local', gitBashPath(reviewDirectory))
      expect(accepted.status).toBe(0, accepted.stderr)
      expect(accepted.stdout).toContain(`reviewer=independent-reviewer`)

      const reportFile = resolve(reviewDirectory, `${fingerprint}.report`)
      writeFileSync(reportFile, `${report}tampered\n`)
      const tampered = runFrontendScope(fixture, 'verify', fixture.base, candidate, 'local', gitBashPath(reviewDirectory))
      expect(tampered.status).not.toBe(0)
      expect(tampered.stderr).toContain('report digest does not match receipt')
      writeFileSync(reportFile, report)

      const fakeServerRoot = spawnSync(bashExecutable, [gitBashPath(resolve(fixture.root, 'deploy/selectel/frontend-scope.sh')), 'verify', fixture.base, candidate, 'server'], {
        cwd: fixture.root, encoding: 'utf8', env: { ...process.env, FRONTEND_REVIEW_ROOT: reviewDirectory },
      })
      expect(fakeServerRoot.status).not.toBe(0)
      expect(fakeServerRoot.stderr).toContain('protected frontend review store is unavailable')
      expect(fakeServerRoot.stdout).not.toContain('REVIEW_OK')

      fixture.put('webapp/src/features/feed/FeedPage.tsx', 'export const FeedPage = () => <main>changed after review</main>\n')
      fixture.git('add', '.')
      fixture.git('commit', '-m', 'stale the receipt')
      const staleCandidate = fixture.git('rev-parse', 'HEAD')
      const stale = runFrontendScope(fixture, 'verify', fixture.base, staleCandidate, 'local', gitBashPath(reviewDirectory))
      expect(stale.status).not.toBe(0)
      expect(stale.stderr).toContain('REVIEW_REQUIRED')

      fixture.put('webapp/src/features/feed/video-lifecycle.ts', 'export const lifecycle = "changed"\n')
      fixture.git('add', '.')
      fixture.git('commit', '-m', 'sensitive video lifecycle change')
      const sensitiveCandidate = fixture.git('rev-parse', 'HEAD')
      const sensitive = runFrontendScope(fixture, 'verify', fixture.base, sensitiveCandidate, 'local', gitBashPath(reviewDirectory))
      expect(sensitive.status).not.toBe(0)
      expect(sensitive.stderr).toContain('requires FULL')
    } finally {
      if (reviewDirectory) rmSync(reviewDirectory, { recursive: true, force: true })
      rmSync(fixture.root, { recursive: true, force: true })
    }
  })

  test('range risk checks allow a UI revert while runtime eligibility uses the active frontend base', { timeout: 30_000 }, () => {
    const fixture = createFrontendRangeFixture()
    let reviewDirectory
    try {
      fixture.git('checkout', '-b', 'backend-and-frontend', fixture.base)
      fixture.put('docs/release.md', 'backend-only release note\n')
      fixture.git('add', '.')
      fixture.git('commit', '-m', 'backend range has no frontend change')
      const backendBase = fixture.git('rev-parse', 'HEAD')

      fixture.put('webapp/src/features/feed/FeedPage.tsx', 'export const FeedPage = () => <main>active frontend</main>\n')
      fixture.git('add', '.')
      fixture.git('commit', '-m', 'active frontend presentation')
      const frontendBase = fixture.git('rev-parse', 'HEAD')

      fixture.put('webapp/src/features/feed/FeedPage.tsx', 'export const FeedPage = () => <main>before</main>\n')
      fixture.git('add', '.')
      fixture.git('commit', '-m', 'revert to backend frontend presentation')
      const candidate = fixture.git('rev-parse', 'HEAD')

      const backendRange = runFrontendScope(fixture, 'verify', backendBase, candidate, 'local')
      expect(backendRange.status).toBe(0, backendRange.stderr)
      const missingActiveReview = runFrontendScope(fixture, 'verify', frontendBase, candidate, 'local')
      expect(missingActiveReview.status).not.toBe(0)
      expect(missingActiveReview.stderr).toContain('REVIEW_REQUIRED')

      const inspection = runFrontendScope(fixture, 'inspect', frontendBase, candidate)
      expect(inspection.status).toBe(0, inspection.stderr)
      const values = Object.fromEntries(inspection.stdout.trim().split(/\r?\n/).map((line) => line.split('=')))
      reviewDirectory = mkdtempSync(resolve(tmpdir(), 'memoly-frontend-revert-review-'))
      const report = 'Independent review: exact frontend revert hunks checked; no auth, access, media, storage, lifecycle, API, business-rule, or backend compatibility risk.\n'
      const reportSha = sha256(report)
      writeFileSync(resolve(reviewDirectory, `${values.FINGERPRINT}.report`), report)
      writeFileSync(resolve(reviewDirectory, `${values.FINGERPRINT}.receipt`), [
        'MEMOLY_FRONTEND_REVIEW=1', `BASE_SHA=${values.BASE_SHA}`, `CANDIDATE_TREE=${values.CANDIDATE_TREE}`,
        `DIFF_SHA256=${values.DIFF_SHA256}`, `POLICY_SHA256=${values.POLICY_SHA256}`,
        'REVIEWER_ID=independent-reviewer', 'DECISION=FRONTEND', `REPORT_SHA256=${reportSha}`, `FINGERPRINT=${values.FINGERPRINT}`, '',
      ].join('\n'))
      const reviewedRevert = runFrontendScope(fixture, 'verify', frontendBase, candidate, 'local', gitBashPath(reviewDirectory))
      expect(reviewedRevert.status).toBe(0, reviewedRevert.stderr)
    } finally {
      if (reviewDirectory) rmSync(reviewDirectory, { recursive: true, force: true })
      rmSync(fixture.root, { recursive: true, force: true })
    }
  })

  test('raw range modes accept regular asset edits and reject same-mode symlink target edits', () => {
    const fixture = createFrontendRangeFixture()
    try {
      fixture.put('webapp/src/assets/ordinary.webp', 'regular asset v1\n')
      fixture.git('add', '.')
      fixture.git('commit', '-m', 'add regular asset')
      const regularBase = fixture.git('rev-parse', 'HEAD')
      fixture.put('webapp/src/assets/ordinary.webp', 'regular asset v2\n')
      fixture.git('add', '.')
      fixture.git('commit', '-m', 'edit regular asset')
      const regularCandidate = fixture.git('rev-parse', 'HEAD')
      const regularEdit = runFrontendScope(fixture, 'verify', regularBase, regularCandidate, 'local')
      expect(regularEdit.status).toBe(0, regularEdit.stderr)

      const symlinkPath = 'webapp/public/assets/allowlisted.webp'
      const hashBlob = (contents) => {
        const result = spawnSync('git', ['hash-object', '-w', '--stdin'], { cwd: fixture.root, input: contents, encoding: 'utf8' })
        expect(result.status).toBe(0, result.stderr)
        return result.stdout.trim()
      }
      fixture.git('update-index', '--add', '--cacheinfo', `120000,${hashBlob('../../outside-first.webp')},${symlinkPath}`)
      fixture.git('commit', '-m', 'fixture baseline contains allowlisted symlink')
      const symlinkBase = fixture.git('rev-parse', 'HEAD')
      fixture.git('update-index', '--add', '--cacheinfo', `120000,${hashBlob('../../outside-second.webp')},${symlinkPath}`)
      fixture.git('commit', '-m', 'change existing symlink target')
      const symlinkCandidate = fixture.git('rev-parse', 'HEAD')

      const symlinkEdit = runFrontendScope(fixture, 'verify', symlinkBase, symlinkCandidate, 'local')
      expect(symlinkEdit.status).not.toBe(0)
      expect(symlinkEdit.stderr).toContain('non-regular changed inputs')
    } finally {
      rmSync(fixture.root, { recursive: true, force: true })
    }
  })

  test('frontend journey test stages require an executed passing Playwright case', () => {
    const [pass] = executePlan([['Browser journey webapp/e2e/memoly-v4.spec.ts', ['fake', []]]], () => ({
      status: 0, stdout: 'Running 1 test using 1 worker\n  1 passed (2.1s)\n',
    }))
    expect(pass?.status).toBe(0)
    const [skip] = executePlan([['Browser journey webapp/e2e/memoly-v4.spec.ts', ['fake', []]]], () => ({
      status: 0, stdout: 'Running 1 test using 1 worker\n  1 skipped\n  0 passed (2.1s)\n',
    }))
    expect(skip?.status).toBe(1)
    expect(skip?.error).toContain('skipped or unrun required journeys')
  })

  test('cosmetic and documentation diffs select FAST', () => {
    expect(classifyChanges(['webapp/src/styles.css'])).toBe('fast')
    expect(classifyChanges(['docs/release.md'])).toBe('fast')
    expect(classifyChanges(['deploy/selectel/README.md'])).toBe('fast')
    expect(classifyChanges(['webapp/src/assets/family-icon.webp'])).toBe('fast')
    expect(classifyChanges(['website/public/assets/brand-mark.png'])).toBe('fast')
    expect(classifyChanges(['unknown/icon.webp'])).toBe('full')
  })

  test('ordinary UI selects STANDARD while auth and unknown paths select FULL', () => {
    expect(classifyChanges(['webapp/src/components/FamilyCard.tsx'])).toBe('standard')
    expect(classifyChanges(['webapp/src/features/feed/FeedPage.tsx'])).toBe('standard')
    expect(classifyChanges(['webapp/src/features/family/FamilyHubPage.tsx'])).toBe('standard')
    expect(classifyChanges(['webapp/src/App.tsx'])).toBe('standard')
    expect(classifyChanges(['backend/src/modules/auth/session.ts'])).toBe('full')
    expect(classifyChanges(['unclassified/build-input.bin'])).toBe('full')
    expect(classifyChanges(['deploy/selectel/frontend-safe-paths.txt'])).toBe('full')
    expect(classifyChanges(['deploy/selectel/frontend-scope.sh'])).toBe('full')
  })

  test('unknown paths mixed with known paths and auth-like CSS keep the conservative boundaries', () => {
    expect(classifyChanges(['docs/change.md', 'unknown/new-format.bin'])).toBe('full')
    expect(classifyChanges(['webapp/src/auth.css'])).toBe('fast')
    expect(classifyChanges(['webapp/src/features/auth/provider.tsx'])).toBe('full')
    expect(classifyChanges(['backend/src/modules/memories/delete.ts'])).toBe('full')
    expect(classifyChanges(['backend/src/db.ts'])).toBe('full')
    expect(classifyChanges(['backend/src/modules/users/profile.ts'])).toBe('full')
    expect(classifyChanges(['backend/src/modules/memories/read-model.ts'])).toBe('full')
    expect(classifyChanges(['backend/src/modules/memories/presentation.ts'])).toBe('full')
    expect(classifyChanges(['packages/new-package/src/index.ts'])).toBe('full')
    expect(classifyChanges(['scripts/repo-env.mjs'])).toBe('full')
  })

  test('a requested profile cannot lower the inferred minimum', () => {
    expect(() => selectProfile({ paths: ['backend/src/modules/auth/login.ts'], requested: 'fast' }))
      .toThrow('Profile downgrade refused')
    expect(selectProfile({ paths: ['webapp/src/ui.css'], requested: 'full' }).profile).toBe('full')
  })

  test('FAST builds production UI when CSS changes but docs-only checks stay lightweight', () => {
    const docs = planFor('fast', ['docs/release.md'])
    const css = planFor('fast', ['webapp/src/styles.css'])
    const icon = planFor('fast', ['webapp/src/assets/family-icon.webp'])
    const websiteIcon = planFor('fast', ['website/public/assets/brand-mark.png'])
    expect(docs.some(([name]) => name.includes('production build'))).toBe(false)
    expect(css.some(([name]) => name.includes('production build'))).toBe(true)
    expect(icon.some(([name]) => name.includes('Frontend production build'))).toBe(true)
    expect(websiteIcon.some(([name]) => name.includes('Website production build'))).toBe(true)
  })

  test('FAST plans one production build when a surface has both styles and raster assets', () => {
    const webapp = planFor('fast', ['webapp/src/x.css', 'webapp/public/assets/x.webp'])
    const website = planFor('fast', ['website/src/x.css', 'website/public/assets/x.webp'])
    expect(webapp.filter(([, [command, args]]) => command === 'bun' && args.join(' ') === 'run build:webapp')).toHaveLength(1)
    expect(website.filter(([, [command, args]]) => command === 'bun' && args.join(' ') === 'run build:website')).toHaveLength(1)
  })

  test('STANDARD targets only current backend and webapp tests after deletion or rename', () => {
    const fixture = mkdtempSync(resolve(tmpdir(), 'memoly-standard-test-discovery-'))
    const put = (path) => {
      const target = resolve(fixture, path)
      mkdirSync(dirname(target), { recursive: true })
      writeFileSync(target, 'test("fixture", () => {})\n')
    }
    try {
      put('backend/src/modules/demo/old.test.ts')
      put('webapp/tests/old.test.tsx')
      const backendOnly = planFor('standard', ['backend/src/modules/demo/old.test.ts'], undefined, fixture)
      const webappOnly = planFor('standard', ['webapp/tests/old.test.tsx'], undefined, fixture)
      rmSync(resolve(fixture, 'backend/src/modules/demo/old.test.ts'))
      rmSync(resolve(fixture, 'webapp/tests/old.test.tsx'))
      put('backend/src/modules/demo/renamed.test.ts')
      put('webapp/tests/renamed.test.tsx')
      const renamed = planFor('standard', [
        'backend/src/modules/demo/old.test.ts', 'backend/src/modules/demo/renamed.test.ts',
        'webapp/tests/old.test.tsx', 'webapp/tests/renamed.test.tsx',
      ], undefined, fixture)
      const backendArgs = renamed.find(([name]) => name === 'Changed backend unit tests')?.[1]?.[1] ?? []
      const webappArgs = renamed.find(([name]) => name === 'Changed web app unit tests')?.[1]?.[1] ?? []
      expect(backendArgs).toContain('./backend/src/modules/demo/renamed.test.ts')
      expect(backendArgs).not.toContain('./backend/src/modules/demo/old.test.ts')
      expect(webappArgs).toContain('./webapp/tests/renamed.test.tsx')
      expect(webappArgs).not.toContain('./webapp/tests/old.test.tsx')
      expect(backendOnly.some(([name]) => name === 'Changed backend unit tests')).toBe(true)
      expect(webappOnly.some(([name]) => name === 'Changed web app unit tests')).toBe(true)
      const deletedOnly = planFor('standard', ['backend/src/modules/demo/old.test.ts', 'webapp/tests/old.test.tsx'], undefined, fixture)
      expect(deletedOnly.map(([, [, args]]) => args.join(' ')).join('\n')).not.toContain('old.test.')
    } finally {
      rmSync(fixture, { recursive: true, force: true })
    }
  })

  test('STANDARD limits backend tests to the changed module and includes integrations', () => {
    const plan = planFor('standard', ['backend/src/modules/memories/memories.service.ts'])
    expect(plan.map(([name]) => name).join(' ')).toContain('Changed backend PostgreSQL integration tests')
    expect(plan.map(([, [, args]]) => args.join(' ')).join('\n')).not.toContain('test:backend:unit')
    const modulePlan = planFor('standard', ['backend/src/modules/max/media-flow.ts'])
    const unitArgs = modulePlan.find(([name]) => name === 'Changed backend unit tests')?.[1]?.[1] ?? []
    expect(unitArgs.every((path) => !path.includes(process.cwd()))).toBe(true)
    expect(unitArgs.some((path) => path.startsWith('./backend/'))).toBe(true)
  })

  test('FULL plan enrolls MAX then Control journeys and conditionally runs Python sampler coverage', () => {
    const plan = planFor('full', ['backend/src/modules/auth/session.ts'])
    const commands = plan.map(([name, [command, args]]) => `${name} ${command} ${args.join(' ')}`).join('\n')
    expect(commands).toContain('--max-only')
    expect(commands).toContain('e2e:webapp:max')
    expect(commands).toContain('Control owner browser journeys bun run --cwd webapp e2e --config=playwright.control.config.ts')
    expect(commands).not.toContain('critical-smoke.spec.ts')
    expect(plan.map(([name]) => name)).toContain('Repository and Selectel safety tests')
    expect(plan.map(([name]) => name)).not.toContain('Control host-sampler Python tests')
    expect(plan.findIndex(([name]) => name === 'MAX Web/PWA browser journeys')).toBeLessThan(plan.findIndex(([name]) => name === 'Control owner browser journeys'))

    const withSampler = planFor('full', ['deploy/selectel/control/sampler.py'])
    const pythonStage = withSampler.find(([name]) => name === 'Control host-sampler Python tests')
    expect(pythonStage?.[1][1]).toEqual(['-B', '-m', 'unittest', 'discover', '-s', 'deploy/selectel/control', '-p', '*test*.py'])
    expect(withSampler.findIndex(([name]) => name === 'Control host-sampler Python tests')).toBeLessThan(withSampler.findIndex(([name]) => name === 'Control owner browser journeys'))
  })

  test('Control Python stage requires a real positive unittest summary without skips', () => {
    const passed = executePlan([['Control host-sampler Python tests', ['python3', ['-B', '-m', 'unittest']]]], () => ({
      status: 0, stdout: 'Ran 7 tests in 0.023s\n\nOK\n', stderr: '',
    }))
    expect(passed[0]?.status).toBe(0)
    const empty = executePlan([['Control host-sampler Python tests', ['python3', ['-B', '-m', 'unittest']]]], () => ({
      status: 0, stdout: 'Ran 0 tests in 0.001s\n\nOK\n', stderr: '',
    }))
    expect(empty[0]?.status).toBe(1)
    const skipped = executePlan([['Control host-sampler Python tests', ['python3', ['-B', '-m', 'unittest']]]], () => ({
      status: 0, stdout: 'Ran 7 tests in 0.023s\n\nOK (skipped=1)\n', stderr: '',
    }))
    expect(skipped[0]?.status).toBe(1)
  })

  test('mandatory command failure stops the plan and remains a failure', () => {
    let calls = 0
    const results = executePlan([
      ['first', ['fake', ['pass']]],
      ['second', ['fake', ['fail']]],
      ['must not run', ['fake', ['pass']]],
    ], (_command, args) => {
      calls += 1
      return { status: args[0] === 'fail' ? 7 : 0 }
    })
    expect(calls).toBe(2)
    expect(results).toHaveLength(2)
    expect(results[1]?.status).toBe(7)
  })

  test('a real Bun test.skip result cannot satisfy a required test stage', () => {
    const fixture = resolve(tmpdir(), `memoly-required-skip-${Date.now()}.test.mjs`)
    writeFileSync(fixture, "import { test } from 'bun:test'; test.skip('required check unavailable', () => {})\n")
    try {
      const [result] = executePlan([['Required fixture tests', ['bun', ['test', fixture]]]])
      expect(result?.status).toBe(1)
      expect(result?.error).toContain('skipped required test')
    } finally {
      rmSync(fixture, { force: true })
    }
  })

  test('the declared historical Telegram exclusions coexist with executed MAX tests', () => {
    const fixture = resolve(tmpdir(), `memoly-max-filter-${Date.now()}.test.mjs`)
    writeFileSync(fixture, [
      "import { test, expect } from 'bun:test'",
      "test('MAX login works', () => expect(true).toBe(true))",
      "test('historical Telegram auth contract', () => {})",
      "test('historical Telegram user projection', () => {})",
      "test('historical Telegram-only media contract', () => {})",
    ].join('\n'))
    try {
      const [result] = executePlan([['MAX and platform-neutral shared contract tests', ['bun', ['test', '--test-name-pattern', '^(?!.*Telegram).*$' , fixture]]]])
      expect(result?.status).toBe(0)
    } finally {
      rmSync(fixture, { force: true })
    }
  })

  test('a successful test command with no reported cases cannot satisfy a required stage', () => {
    const [result] = executePlan([['Required empty tests', ['fake', []]]], () => ({ status: 0 }))
    expect(result?.status).toBe(1)
    expect(result?.error).toContain('did not report a recognized Bun test summary')
  })

  test('the real CLI classifies a temporary Git fixture and rejects downgrades/prototype profiles', () => {
    const root = mkdtempSync(resolve(tmpdir(), 'memoly-verify-cli-'))
    const runGit = (...args) => {
      const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' })
      if (result.status !== 0) throw new Error(result.stderr)
      return result.stdout.trim()
    }
    const script = resolve(dirname(fileURLToPath(import.meta.url)), 'verify-local.mjs')
    try {
      runGit('init', '-b', 'main')
      runGit('config', 'user.name', 'Verifier Fixture')
      runGit('config', 'user.email', 'verify-fixture@example.invalid')
      mkdirSync(resolve(root, 'webapp/src'), { recursive: true })
      mkdirSync(resolve(root, 'deploy/selectel'), { recursive: true })
      copyFileSync(resolve(repositoryRoot, 'deploy/selectel/frontend-scope.sh'), resolve(root, 'deploy/selectel/frontend-scope.sh'))
      copyFileSync(resolve(repositoryRoot, 'deploy/selectel/frontend-safe-paths.txt'), resolve(root, 'deploy/selectel/frontend-safe-paths.txt'))
      writeFileSync(resolve(root, 'webapp/src/styles.css'), 'body { color: black; }\n')
      writeFileSync(resolve(root, 'docs.md'), 'base\n')
      runGit('add', '.')
      runGit('commit', '-m', 'base')
      const base = runGit('rev-parse', 'HEAD')
      runGit('update-ref', 'refs/remotes/origin/main', base)
      writeFileSync(resolve(root, 'webapp/src/styles.css'), 'body { color: navy; }\n')

      const fast = spawnSync('bun', [script, '--profile', 'fast', '--dry-run'], { cwd: root, encoding: 'utf8' })
      expect(fast.status).toBe(2)
      expect(fast.stdout).toContain('Profile: fast (minimum required: fast)')
      expect(fast.stdout).toContain('DRY RUN: plan only')
      expect(fast.stdout).not.toContain('verification passed')

      writeFileSync(resolve(root, 'webapp/src/FamilyCard.tsx'), 'export const FamilyCard = () => null\n')
      const standard = spawnSync('bun', [script, '--dry-run'], { cwd: root, encoding: 'utf8' })
      expect(standard.status).toBe(2)
      expect(standard.stdout).toContain('Profile: standard (minimum required: standard)')

      runGit('add', '.')
      runGit('commit', '-m', 'ordinary module fixture')
      mkdirSync(resolve(root, 'backend/src/modules/auth'), { recursive: true })
      writeFileSync(resolve(root, 'backend/src/modules/auth/session.ts'), 'export {}\n')
      runGit('add', '.')
      runGit('commit', '-m', 'critical auth fixture')
      const downgrade = spawnSync('bun', [script, '--profile', 'fast', '--base', 'HEAD^', '--dry-run'], { cwd: root, encoding: 'utf8' })
      expect(downgrade.status).toBe(1)
      expect(downgrade.stderr).toContain('Profile downgrade refused')
      expect(downgrade.stderr).toContain('full')
      const prototype = spawnSync('bun', [script, '--profile', 'constructor', '--dry-run'], { cwd: root, encoding: 'utf8' })
      expect(prototype.status).toBe(1)
      expect(prototype.stderr).toContain('Unknown verification profile')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
