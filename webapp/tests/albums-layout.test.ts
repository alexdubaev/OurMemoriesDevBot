import { describe, expect, test } from 'bun:test'
import type { AlbumEntryDto } from '@web-app-demo/contracts'
import { dateLabel, monthAgeLabel, sourceDate, visibleTiles, workshopLayout, zoomLevel } from '../src/features/albums/model'

const entries = Array.from({ length: 2000 }, (_, index) => ({ id: `entry-${index}`, sources: [], date: { precision: 'month', value: '2026-10' } }) as unknown as AlbumEntryDto)
describe('album boundaries', () => {
  test('2000 works retain reading order and a bounded render window in every zoom', () => {
    for (const columns of [8, 5, 3]) {
      const layout = workshopLayout(entries, columns, 358)
      expect(layout.tiles.map((tile) => tile.id)).toEqual(entries.map((entry) => entry.id))
      for (const top of [0, layout.height / 2, layout.height - 844]) {
        const window = visibleTiles(layout, top, 844)
        expect(window.length).toBeGreaterThan(0)
        expect(window.length).toBeLessThanOrEqual(320)
        expect(window.every((tile) => tile.y + tile.height >= top - 422 && tile.y <= top + 1266)).toBe(true)
      }
      expect(visibleTiles(layout, 0, 100_000).length).toBeLessThanOrEqual(320)
    }
  })
  test('no tiles overlap or overflow and placement is stable across renders', () => {
    const layout = workshopLayout(entries.slice(0, 60), 5, 358)
    expect(workshopLayout(entries.slice(0, 60), 5, 358)).toEqual(layout)
    for (const tile of layout.tiles) {
      expect(tile.x + tile.width).toBeLessThanOrEqual(358.001)
      expect(layout.tiles.filter((other) => other.id !== tile.id && other.x < tile.x + tile.width && other.x + other.width > tile.x && other.y < tile.y + tile.height && other.y + other.height > tile.y)).toHaveLength(0)
    }
  })
  test('partial dates never acquire a fabricated day and sources use family timezone', () => {
    expect([1, 2, 4, 5, 11, 21, 22, 25].map(monthAgeLabel)).toEqual(['Нам 1 месяц', 'Нам 2 месяца', 'Нам 4 месяца', 'Нам 5 месяцев', 'Нам 11 месяцев', 'Нам 21 месяц', 'Нам 22 месяца', 'Нам 25 месяцев'])
    expect(dateLabel({ precision: 'year', value: '2024' })).toBe('2024 год')
    expect(dateLabel({ precision: 'month', value: '2024-03' })).toBe('Март 2024')
    expect(dateLabel({ precision: 'day', value: '2024-10-10' })).toBe('10 октября 2024')
    expect(sourceDate({ occurredAt: '2024-03-01T23:30:00Z' }, 'Europe/Moscow')).toEqual({ precision: 'day', value: '2024-03-02' })
    expect(sourceDate({ occurredAt: null }, 'Europe/Moscow')).toEqual({ precision: 'unknown', value: null })
    expect(zoomLevel(0, -1)).toBe(0); expect(zoomLevel(2, 1)).toBe(2)
  })
})
