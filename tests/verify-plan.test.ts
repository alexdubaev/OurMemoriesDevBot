import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'

import { fullVerificationCommandIds, planVerification } from '../scripts/verify-plan.mjs'

test('plans docs-only changes without database checks', () => {
  expect(planVerification(['docs/mvp/01_PRODUCT.md'])).toEqual({
    status: 'ready',
    impacts: ['docs'],
    commandIds: ['template'],
  })
})

test('plans storage and backend checks for a media adapter change', () => {
  expect(planVerification(['backend/src/modules/media/telegram-adapter.ts'])).toEqual({
    status: 'ready',
    impacts: ['media'],
    commandIds: ['architecture', 'typecheck', 'backend-unit', 'backend-integration', 'e2e-release', 'storage-s3'],
  })
})

test('plans both backend and web consumers for shared contract changes', () => {
  expect(planVerification(['packages/contracts/src/memory.ts'])).toEqual({
    status: 'ready',
    impacts: ['contracts'],
    commandIds: ['architecture', 'typecheck', 'contracts', 'backend-unit', 'webapp', 'e2e-release'],
  })
})

test('plans auth and Prisma changes through their backend integration boundaries', () => {
  expect(planVerification([
    'backend/src/modules/auth/transport/routes.ts',
    'backend/prisma/schema.prisma',
  ])).toEqual({
    status: 'ready',
    impacts: ['auth', 'schema'],
    commandIds: ['architecture', 'typecheck', 'backend-unit', 'backend-integration', 'e2e-release'],
  })
})

test('plans storage changes through the media verification boundary', () => {
  expect(planVerification(['backend/src/storage/config.ts'])).toEqual({
    status: 'ready',
    impacts: ['media'],
    commandIds: ['architecture', 'typecheck', 'backend-unit', 'backend-integration', 'e2e-release', 'storage-s3'],
  })
})

test('expands unknown paths to the fixed full verification set', () => {
  expect(planVerification(['unmapped/unknown.ts'])).toEqual({
    status: 'ready',
    impacts: ['full'],
    commandIds: fullVerificationCommandIds,
    unknownPaths: ['unmapped/unknown.ts'],
  })
})

test('treats shell metacharacters in a path as data', () => {
  const suppliedPath = 'docs/mvp/00_START_HERE.md; touch injected'

  expect(planVerification([suppliedPath])).toEqual({
    status: 'ready',
    impacts: ['full'],
    commandIds: fullVerificationCommandIds,
    unknownPaths: [suppliedPath],
  })
})

test('expands verification controls to the fixed full set', () => {
  for (const path of [
    '.github/workflows/verify.yml',
    'verification-map.json',
    'scripts/verify-plan.mjs',
  ]) {
    expect(planVerification([path])).toEqual({
      status: 'ready',
      impacts: ['full'],
      commandIds: fullVerificationCommandIds,
    })
  }
})

test('rejects a map that tries to name a command outside the allowlist', () => {
  expect(() => planVerification(['docs/mvp/01_PRODUCT.md'], {
    version: 2,
    rules: [{ impact: 'docs', prefixes: ['docs/mvp/'], commandIds: ['arbitrary-command'] }],
  })).toThrow('unknown verification command id "arbitrary-command"')
})

test('includes the release browser profile for API and frontend changes and audits workspace manifests', () => {
  expect(planVerification(['webapp/src/App.tsx']).commandIds).toContain('e2e-release')
  expect(planVerification(['backend/src/modules/auth/transport/routes.ts']).commandIds).toContain('e2e-release')
  expect(planVerification(['website/package.json']).commandIds).toContain('audit')
  expect(planVerification(['website/src/App.tsx']).commandIds).toEqual([
    'architecture', 'typecheck', 'website-tests', 'build-contracts',
  ])
})

test('fails closed for an empty or commandless verification map', () => {
  expect(() => planVerification(['docs/mvp/01_PRODUCT.md'], { version: 2, rules: [] })).toThrow()
  expect(() => planVerification(['docs/mvp/01_PRODUCT.md'], {
    version: 2,
    rules: [{ impact: 'docs', prefixes: ['docs/'], commandIds: [] }],
  })).toThrow()
})

test('includes audit, lint, and release E2E in the full verification plan', () => {
  expect(fullVerificationCommandIds).toEqual(expect.arrayContaining([
    'audit', 'lint', 'e2e-release', 'verification-tools', 'infra-tests',
    'website-tests', 'build-contracts', 'storage-s3', 'docker-smoke',
  ]))
  expect(fullVerificationCommandIds).not.toContain('build-webapp')
  expect(planVerification(['package.json']).commandIds).toContain('verification-tools')
})

test('keeps pull-request verification statically mapped and free of cloud credentials or native jobs', () => {
  const workflow = readFileSync('.github/workflows/verify.yml', 'utf8')

  expect(workflow).toContain('pull_request:')
  expect(workflow).toContain('verify-required:')
  expect(workflow).toContain('bun scripts/verify-plan.mjs --stdin0')
  expect(workflow).toContain('--diff-filter=ACMRD')
  expect(workflow).not.toMatch(/^\s+paths:/m)
  expect(workflow).not.toMatch(/eval\s|bash\s+-c|EXPO|CAPACITOR|VK_|OPENAI|ANTHROPIC|TELEGRAM_BOT_TOKEN/i)

  for (const command of [
    'bun run architecture:check',
    'bun run template:check',
    'bun run typecheck',
    'bun run test:contracts',
    'bun run test:backend:unit',
    'bun run test:backend:integration',
    'bun run test:webapp',
    'bun run build:webapp',
    'bun run audit',
    'bun run test:verification-tools',
    'bun run test:website',
    'bun run test:build-contracts',
    'bun run test:infra',
    'bun run test:storage:s3',
    'bun run smoke:backend:docker',
    'bun run lint',
    'bun run e2e:webapp:release',
  ]) {
    expect(workflow).toContain(command)
  }
})
