import { describe, expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { classifyChanges, executePlan, planFor, selectProfile, validateFrontendScope } from './verify-local.mjs'

describe('risk based verification', () => {
  test('frontend scope accepts only vetted presentation paths and needs a production input', () => {
    expect(validateFrontendScope(['webapp/src/components/ui-v2/ChildHeaderV2.tsx'], { requireRuntime: true }).runtime).toBe(true)
    expect(() => validateFrontendScope(['webapp/src/App.tsx'])).toThrow('outside its allowlist')
    expect(() => validateFrontendScope(['webapp/src/features/auth/SignIn.css'])).toThrow('outside its allowlist')
    expect(() => validateFrontendScope(['docs/release.md'])).toThrow('production frontend input')
    expect(() => validateFrontendScope(['deploy/selectel/ci-release.sh'])).toThrow('outside its allowlist')
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
    expect(classifyChanges(['webapp/src/assets/family-icon.webp'])).toBe('fast')
    expect(classifyChanges(['website/public/assets/brand-mark.png'])).toBe('fast')
    expect(classifyChanges(['unknown/icon.webp'])).toBe('full')
  })

  test('ordinary UI selects STANDARD while auth and unknown paths select FULL', () => {
    expect(classifyChanges(['webapp/src/components/FamilyCard.tsx'])).toBe('standard')
    expect(classifyChanges(['backend/src/modules/auth/session.ts'])).toBe('full')
    expect(classifyChanges(['unclassified/build-input.bin'])).toBe('full')
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

  test('FULL plan includes MAX auth and excludes the Telegram smoke journey', () => {
    const plan = planFor('full', ['backend/src/modules/auth/session.ts'])
    const commands = plan.map(([name, [, args]]) => `${name} ${args.join(' ')}`).join('\n')
    expect(commands).toContain('--max-only')
    expect(commands).toContain('e2e:webapp:max')
    expect(commands).not.toContain('critical-smoke.spec.ts')
    expect(plan.map(([name]) => name)).toContain('Repository and Selectel safety tests')
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
