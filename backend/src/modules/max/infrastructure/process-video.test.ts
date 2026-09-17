import { describe, expect, test } from 'bun:test'

import { resolveVideoDimensions } from './process-video'

describe('MAX video metadata boundary', () => {
  test('uses the complete inbound pair when MAX only supplies rendition height', () => {
    expect(resolveVideoDimensions(
      { width: null, height: 720 },
      { width: 720, height: 1_280 },
    )).toEqual({ width: 720, height: 1_280 })
  })

  test('uses the complete MAX rendition pair when both dimensions are valid', () => {
    expect(resolveVideoDimensions(
      { width: 720, height: 1_280 },
      { width: 1_080, height: 1_920 },
    )).toEqual({ width: 720, height: 1_280 })
  })

  test('uses the complete provider root pair before rendition and inbound dimensions', () => {
    expect(resolveVideoDimensions(
      { width: null, height: 720 },
      { width: 720, height: 1_280 },
      { width: 720, height: 1_280 },
    )).toEqual({ width: 720, height: 1_280 })
  })

  test('falls back to the complete rendition pair when provider root dimensions are incomplete', () => {
    expect(resolveVideoDimensions(
      { width: 720, height: 1_280 },
      { width: 1_080, height: 1_920 },
      { width: 720, height: null },
    )).toEqual({ width: 720, height: 1_280 })
  })
})
