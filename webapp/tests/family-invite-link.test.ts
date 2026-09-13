import { expect, test } from 'bun:test'

import { createInviteLink } from '../src/features/family/invite-link'

test('generates one opaque Main Mini App invite deep link', () => {
  const opaqueToken = 'abcdefghijklmnopqrstuvwxyzABCDEF_0123456789'
  const link = createInviteLink(opaqueToken)

  expect(link).toBe(`https://t.me/OurMemoriesDevBot?startapp=invite_${opaqueToken}`)
  expect(link).not.toContain('familyId')
  expect(link).not.toContain('childId')
  expect(link).not.toContain('userId')
  expect(link).not.toContain('membership')
})
