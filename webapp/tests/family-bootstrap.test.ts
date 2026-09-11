import { expect, test } from 'bun:test'

import { createFamilyErrorMessage } from '../src/features/family/bootstrap'
import { ApiRequestError } from '../src/platform/api'

test('makes a denied family bootstrap actionable instead of silently restoring the button', () => {
  expect(createFamilyErrorMessage(new ApiRequestError(
    403,
    'ROLE_FORBIDDEN',
    'Создание семьи доступно участникам пилота',
  ))).toBe('Создание семьи доступно участникам пилота. Обратитесь к организатору пилота.')
})
