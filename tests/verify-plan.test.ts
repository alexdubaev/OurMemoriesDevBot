import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'

import { planVerification } from '../scripts/verify-plan.mjs'

test('plans docs-only changes without database checks', () => {
  expect(planVerification(['docs/mvp/01_PRODUCT.md'])).toEqual({
    status: 'ready',
    impacts: ['docs'],
    commands: ['bun run template:check'],
  })
})

test('plans storage and backend checks for a media adapter change', () => {
  expect(planVerification(['backend/src/modules/media/telegram-adapter.ts'])).toEqual({
    status: 'ready',
    impacts: ['media'],
    commands: [
      'bun run architecture:check',
      'bun run test:backend:unit',
      'bun run test:backend:integration',
    ],
  })
})

test('plans both backend and web consumers for shared contract changes', () => {
  expect(planVerification(['packages/contracts/src/memory.ts'])).toEqual({
    status: 'ready',
    impacts: ['contracts'],
    commands: [
      'bun run architecture:check',
      'bun run test:contracts',
      'bun run test:backend:unit',
      'bun run test:webapp',
      'bun run typecheck',
    ],
  })
})

test('returns an explicit expansion state for an unknown path', () => {
  expect(planVerification(['infra/unplanned.tf'])).toEqual({
    status: 'needs-expansion',
    impacts: [],
    commands: [],
    unknownPaths: ['infra/unplanned.tf'],
  })
})

test('treats shell metacharacters in a path as data', () => {
  const suppliedPath = 'docs/mvp/00_START_HERE.md; touch injected'

  expect(planVerification([suppliedPath])).toEqual({
    status: 'needs-expansion',
    impacts: [],
    commands: [],
    unknownPaths: [suppliedPath],
  })
})

test('keeps pull-request verification free of cloud credentials and native or AI jobs', () => {
  const workflow = readFileSync('.github/workflows/verify.yml', 'utf8')

  expect(workflow).toContain('pull_request:')
  expect(workflow).toContain('verify-required:')
  expect(workflow).not.toMatch(/^\s+paths:/m)
  expect(workflow).not.toMatch(/EXPO|CAPACITOR|VK_|OPENAI|ANTHROPIC|TELEGRAM_BOT_TOKEN/i)
})
