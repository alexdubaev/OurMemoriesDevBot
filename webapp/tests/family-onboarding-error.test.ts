import { expect, test } from 'bun:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import { FamilyOnboarding } from '../src/features/family/FamilyOnboarding'
import { onboardingSaveErrorMessage } from '../src/features/family/model'
import type { AuthenticatedTransport } from '../src/platform/api'

test('onboarding save failures use onboarding-specific copy instead of feed refresh copy', () => {
  expect(onboardingSaveErrorMessage).toBe('Не удалось сохранить данные. Попробуйте ещё раз.')
  expect(onboardingSaveErrorMessage).not.toContain('лент')
})

test('onboarding renders the memoLy logo rather than the former visible brand text', () => {
  const markup = renderToStaticMarkup(createElement(FamilyOnboarding, {
    familyId: '11111111-1111-4111-8111-111111111111',
    familyTimezone: 'Europe/Moscow',
    onCompleted: async () => undefined,
    transport,
  }))

  expect(markup).toContain('src="/assets/brand/memoly-logo.webp"')
  expect(markup).toContain('alt="memoLy"')
  expect(markup).not.toContain('Наши воспоминания')
})

const transport: AuthenticatedTransport = {
  request: async () => { throw new Error('unexpected request') },
  raw: async () => { throw new Error('unexpected request') },
}
