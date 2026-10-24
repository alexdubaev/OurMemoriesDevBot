import { describe, expect, test } from 'bun:test'

import { MemoryFailure } from '../domain/errors'
import { normalizeChildTags } from './child-tags'

const lila = '018f01d8-0c2a-7c25-bf83-ae68985c7ea1'
const misha = '018f01d8-0c2a-7c25-bf83-ae68985c7ea2'
const photo = { id: '018f01d8-0c2a-7c25-bf83-ae68985c7eb1', kind: 'photo' as const }
const video = { id: '018f01d8-0c2a-7c25-bf83-ae68985c7eb2', kind: 'video' as const }
const voice = { id: '018f01d8-0c2a-7c25-bf83-ae68985c7eb3', kind: 'voice' as const }

function failure(run: () => unknown) {
  try { run() } catch (error) { return error instanceof MemoryFailure ? { kind: error.kind, message: error.message } : error }
  throw new Error('Expected a MemoryFailure')
}

describe('child tag normalization', () => {
  test('keeps whole-publication tags and attachment tags of different children', () => {
    const tags = [{ childId: lila, attachmentId: null }, { childId: misha, attachmentId: photo.id }]
    expect(normalizeChildTags(tags, [photo, video])).toEqual(tags)
  })

  test('a child tagged on an attachment loses its whole-publication tag', () => {
    expect(normalizeChildTags([
      { childId: lila, attachmentId: null }, { childId: lila, attachmentId: video.id }, { childId: misha, attachmentId: null },
    ], [photo, video])).toEqual([{ childId: lila, attachmentId: video.id }, { childId: misha, attachmentId: null }])
  })

  test('an empty set is valid and clears every tag', () => {
    expect(normalizeChildTags([], [photo])).toEqual([])
  })

  test('duplicates are rejected as invalid input', () => {
    expect(failure(() => normalizeChildTags([{ childId: lila, attachmentId: photo.id }, { childId: lila, attachmentId: photo.id }], [photo])))
      .toEqual({ kind: 'invalid_input', message: 'Отметки не должны повторяться' })
  })

  test('a publication without photo or video accepts only whole-publication tags', () => {
    expect(normalizeChildTags([{ childId: lila, attachmentId: null }], [voice])).toEqual([{ childId: lila, attachmentId: null }])
    expect(failure(() => normalizeChildTags([{ childId: lila, attachmentId: voice.id }], [voice])))
      .toMatchObject({ kind: 'invalid_input' })
    expect(failure(() => normalizeChildTags([{ childId: lila, attachmentId: photo.id }], [])))
      .toMatchObject({ kind: 'invalid_input' })
  })

  test('an attachment of another memory is not found', () => {
    expect(failure(() => normalizeChildTags([{ childId: lila, attachmentId: '018f01d8-0c2a-7c25-bf83-ae68985c7eff' }], [photo])))
      .toEqual({ kind: 'not_found', message: 'Вложение не найдено' })
  })

  test('more than twelve distinct children are rejected', () => {
    const tags = Array.from({ length: 13 }, (_, index) => ({ childId: `018f01d8-0c2a-7c25-bf83-ae68985c7f${String(index).padStart(2, '0')}`, attachmentId: null }))
    expect(failure(() => normalizeChildTags(tags, [photo]))).toMatchObject({ kind: 'invalid_input' })
    expect(normalizeChildTags(tags.slice(0, 12), [photo])).toHaveLength(12)
  })
})
