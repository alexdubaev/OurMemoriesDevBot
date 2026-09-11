import { expect, test } from 'bun:test'

import { onboardingSaveErrorMessage } from '../src/features/family/model'

test('onboarding save failures use onboarding-specific copy instead of feed refresh copy', () => {
  expect(onboardingSaveErrorMessage).toBe('Не удалось сохранить данные. Попробуйте ещё раз.')
  expect(onboardingSaveErrorMessage).not.toContain('лент')
})
