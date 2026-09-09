import { describe, expect, test } from 'bun:test'

import { mayEditContent, mayLike } from './family-policy'

describe('family content policy', () => {
  test('viewer may like but cannot change family content', () => {
    expect(mayLike('viewer')).toBe(true)
    expect(mayEditContent('viewer')).toBe(false)
  })

  test('full member may both like and change family content', () => {
    expect(mayLike('full')).toBe(true)
    expect(mayEditContent('full')).toBe(true)
  })
})
