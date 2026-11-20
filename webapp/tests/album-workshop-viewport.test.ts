import { describe, expect, test } from 'bun:test'
import type { AlbumEntryDto } from '@web-app-demo/contracts'

import { nextWorkshopViewport, workshopLayout } from '../src/features/albums/model'

const entries = Array.from({ length: 600 }, (_, index) => ({
  id: `entry-${index}`, sources: [], date: { precision: 'month', value: `2026-${String(1 + Math.floor(index / 50) % 12).padStart(2, '0')}` },
}) as unknown as AlbumEntryDto)
const layout = workshopLayout(entries, 5, 358)

describe('workshop scroll measurement', () => {
  test('a scroll that keeps the same tiles and headings keeps the current viewport object', () => {
    const current = { top: 2000, height: 844, width: 358 }
    expect(nextWorkshopViewport(layout, current, { top: 2001, height: 844, width: 358 })).toBe(current)
    expect(nextWorkshopViewport(layout, current, { top: 2000, height: 844, width: 358 })).toBe(current)
  })

  test('a scroll that changes the rendered tiles, a resize or a new width replaces the viewport', () => {
    const current = { top: 2000, height: 844, width: 358 }
    const far = { top: 6000, height: 844, width: 358 }
    expect(nextWorkshopViewport(layout, current, far)).toBe(far)
    const wider = { top: 2000, height: 844, width: 390 }
    expect(nextWorkshopViewport(layout, current, wider)).toBe(wider)
    const taller = { top: 2000, height: 1600, width: 358 }
    expect(nextWorkshopViewport(layout, current, taller)).toBe(taller)
  })
})
