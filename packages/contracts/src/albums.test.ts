import { describe, expect, test } from 'bun:test'
import { randomUUID } from 'node:crypto'
import { albumDateSchema, albumEntrySourcePageQuerySchema, albumEntryViewQuerySchema, albumSourceChangesSchema, albumSourceRefSchema, albumSourceSelectionSchema, createAlbumRequestSchema, listAlbumEntriesQuerySchema } from './albums'

describe('album contracts', () => {
  test('validates partial calendar dates without inventing a day', () => {
    expect(albumDateSchema.parse({ value: '2024-02', precision: 'month' })).toEqual({ value: '2024-02', precision: 'month' })
    expect(albumDateSchema.parse({ value: null, precision: 'unknown' })).toEqual({ value: null, precision: 'unknown' })
    for (const value of [
      { value: '2024-02-30', precision: 'day' },
      { value: '2024-02', precision: 'year' },
      { value: '2024-01-01', precision: 'unknown' },
    ]) expect(albumDateSchema.safeParse(value).success).toBe(false)
  })

  test('bounds strict creation and ordered source selection payloads', () => {
    expect(createAlbumRequestSchema.safeParse({ kind: 'free', title: '  ', childId: null }).success).toBe(false)
    expect(createAlbumRequestSchema.safeParse({ kind: 'free', title: 'Album', childId: null, extra: true }).success).toBe(false)
    expect(listAlbumEntriesQuerySchema.parse({}).limit).toBe(48)
    const source = { memoryId: randomUUID(), sourceKind: 'private_storage', sourceId: randomUUID() }
    expect(albumSourceSelectionSchema.parse({ expectedVersion: 1, sources: [source] }).sources).toHaveLength(1)
    expect(albumSourceSelectionSchema.safeParse({ expectedVersion: 1, sources: [source, source] }).success).toBe(false)
    const directPhoto = { memoryId: null, sourceKind: 'private_storage' as const, sourceId: randomUUID() }
    expect(albumSourceSelectionSchema.parse({ expectedVersion: 1, sources: [directPhoto] }).sources).toEqual([directPhoto])
    expect(albumSourceRefSchema.safeParse({ ...directPhoto, sourceKind: 'max_video' }).success).toBe(false)
    expect(albumSourceSelectionSchema.safeParse({ expectedVersion: 1, sources: [{ ...directPhoto, sourceKind: 'memory' }] }).success).toBe(false)
  })

  test('bounds collection delta requests and accepts collection summaries and all-source pages', () => {
    const source = { memoryId: null, sourceKind: 'private_storage' as const, sourceId: randomUUID() }
    expect(albumSourceChangesSchema.parse({ expectedVersion: 1, add: [source], removeIds: [] })).toMatchObject({ expectedVersion: 1, add: [source], removeIds: [] })
    expect(albumSourceChangesSchema.safeParse({ expectedVersion: 1, add: [source, source], removeIds: [] }).success).toBe(false)
    expect(albumSourceChangesSchema.safeParse({ expectedVersion: 1, add: [], removeIds: Array.from({ length: 49 }, () => randomUUID()) }).success).toBe(false)
    const id = randomUUID()
    expect(albumSourceChangesSchema.safeParse({ expectedVersion: 1, add: [], removeIds: [id, id] }).success).toBe(false)
    expect(albumSourceChangesSchema.safeParse({ expectedVersion: 1, add: [], removeIds: [], firstSourceId: id, firstSource: source }).success).toBe(false)
    expect(albumEntryViewQuerySchema.parse({ view: 'collection-summary' }).view).toBe('collection-summary')
    expect(listAlbumEntriesQuerySchema.parse({ view: 'collection-summary' }).view).toBe('collection-summary')
    expect(albumEntrySourcePageQuerySchema.parse({ kind: 'all' }).kind).toBe('all')
  })
})
