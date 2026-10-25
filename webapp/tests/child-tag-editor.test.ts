import { describe, expect, test } from 'bun:test'
import { QueryClient } from '@tanstack/react-query'
import type { ChildDto, MemoryAttachment, MemoryDto, MemoryPage } from '@web-app-demo/contracts'

import { canEditChildTags, initialTagSelection, sameTagSelection, tagsFromSelection, taggableAttachments, WHOLE_PUBLICATION_SLOT } from '../src/features/feed/child-tag-editor'
import { applyChildTagsToCachedFeeds, feedQueryKeys } from '../src/features/feed/queries'
import { replaceMemoryChildTags } from '../src/features/feed/api'
import type { AuthenticatedTransport } from '../src/platform/api'
import type { HttpRequestOptions } from '../src/platform/api/http-client'

const familyId = '019c0000-0000-7000-8000-000000000001'
const accountId = '019c0000-0000-7000-8000-0000000000f1'
const crop = { x: 0, y: 0, width: 1, height: 1 }
const child = (id: string, name: string, birthDate: string): ChildDto => ({ id, name, birthDate, sex: 'girl', avatarMediaId: null, avatarCrop: crop, version: 1, isComplete: true })
const lilya = child('019c0000-0000-7000-8000-0000000000a1', 'Лиля', '2021-02-03')
const misha = child('019c0000-0000-7000-8000-0000000000a2', 'Миша', '2023-04-05')
const photoA = { id: '019c0000-0000-7000-8000-0000000000b1', source: 'private_storage', kind: 'photo' } as MemoryAttachment
const photoB = { id: '019c0000-0000-7000-8000-0000000000b2', source: 'private_storage', kind: 'photo' } as MemoryAttachment
const voice = { id: '019c0000-0000-7000-8000-0000000000b3', source: 'private_storage', kind: 'voice' } as MemoryAttachment
const maxVideo = { id: '019c0000-0000-7000-8000-0000000000b4', source: 'max', kind: 'video' } as MemoryAttachment
const memory = (attachments: MemoryAttachment[], childTags: MemoryDto['childTags'] = [], childTagsVersion = 1) =>
  ({ id: '019c0000-0000-7000-8000-0000000000c1', familyId, attachments, childTags, childTagsVersion }) as MemoryDto

describe('which attachments take their own child tags', () => {
  test('photos and videos do, voice does not', () => {
    expect(taggableAttachments(memory([photoA, voice, maxVideo])).map((item) => item.id)).toEqual([photoA.id, maxVideo.id])
    expect(taggableAttachments(memory([voice]))).toEqual([])
  })
})

describe('the tag editor selection', () => {
  test('a publication without photo or video has one shared choice', () => {
    const selection = initialTagSelection(memory([voice], [{ childId: misha.id, attachmentId: null }]), [lilya, misha])
    expect(selection).toEqual({ [WHOLE_PUBLICATION_SLOT]: [misha.id] })
    expect(tagsFromSelection(memory([voice]), { [WHOLE_PUBLICATION_SLOT]: [lilya.id, misha.id] }, [lilya, misha])).toEqual([
      { childId: lilya.id, attachmentId: null }, { childId: misha.id, attachmentId: null },
    ])
  })

  test('each photo starts with its own children plus the children tagged on the whole publication', () => {
    const tagged = memory([photoA, photoB], [{ childId: lilya.id, attachmentId: null }, { childId: misha.id, attachmentId: photoB.id }])
    expect(initialTagSelection(tagged, [lilya, misha])).toEqual({ [photoA.id]: [lilya.id], [photoB.id]: [lilya.id, misha.id] })
  })

  test('a child ticked on one photo of two is tagged on that photo only', () => {
    const two = memory([photoA, photoB])
    expect(tagsFromSelection(two, { [photoA.id]: [misha.id], [photoB.id]: [] }, [lilya, misha])).toEqual([{ childId: misha.id, attachmentId: photoA.id }])
  })

  test('a child ticked on every photo becomes one tag on the whole publication', () => {
    const two = memory([photoA, photoB])
    expect(tagsFromSelection(two, { [photoA.id]: [lilya.id, misha.id], [photoB.id]: [lilya.id] }, [lilya, misha])).toEqual([
      { childId: lilya.id, attachmentId: null },
      { childId: misha.id, attachmentId: photoA.id },
    ])
  })

  test('a single photo ticked is a whole-publication tag', () => {
    expect(tagsFromSelection(memory([photoA]), { [photoA.id]: [misha.id] }, [lilya, misha])).toEqual([{ childId: misha.id, attachmentId: null }])
  })

  test('nobody ticked sends an empty list', () => {
    expect(tagsFromSelection(memory([photoA, photoB]), { [photoA.id]: [], [photoB.id]: [] }, [lilya, misha])).toEqual([])
  })

  test('an unchanged selection is not a change, a different one is', () => {
    const base = { [photoA.id]: [lilya.id], [photoB.id]: [] as string[] }
    expect(sameTagSelection(base, { [photoA.id]: [lilya.id], [photoB.id]: [] })).toBe(true)
    expect(sameTagSelection(base, { [photoA.id]: [lilya.id], [photoB.id]: [misha.id] })).toBe(false)
  })
})

describe('who can mark children', () => {
  const tagged = memory([photoA])
  test('a full member in a family with two children, on any publication', () => {
    expect(canEditChildTags('full', [lilya, misha], tagged)).toBe(true)
  })
  test('not a viewer, not a one-child family, not an old response without tags', () => {
    expect(canEditChildTags('viewer', [lilya, misha], tagged)).toBe(false)
    expect(canEditChildTags('full', [lilya], tagged)).toBe(false)
    expect(canEditChildTags('full', [lilya, misha], { ...tagged, childTags: undefined, childTagsVersion: undefined })).toBe(false)
  })
})

describe('saving tags', () => {
  test('PUTs the tags with the version the editor saw and the children header', async () => {
    const calls: Array<{ path: string; options?: HttpRequestOptions }> = []
    const transport: AuthenticatedTransport = {
      request: async (path, schema, options) => { calls.push({ path, options }); return schema.parse({ childTags: [{ childId: lilya.id, attachmentId: null }], childTagsVersion: 4 }) },
      raw: async () => new Response(null, { status: 204 }),
    }
    const result = await replaceMemoryChildTags(transport, familyId, 'm1', [{ childId: lilya.id, attachmentId: null }], 3)
    expect(calls[0]?.path).toBe(`/api/v1/families/${familyId}/memories/m1/child-tags`)
    expect(calls[0]?.options?.method).toBe('PUT')
    expect(calls[0]?.options?.body).toEqual({ tags: [{ childId: lilya.id, attachmentId: null }], expectedChildTagsVersion: 3 })
    expect(result.childTagsVersion).toBe(4)
  })

  test('the new tags and version reach every cached feed that holds the memory', () => {
    const client = new QueryClient()
    const target = memory([photoA, photoB], [], 1)
    const other = { ...memory([photoA]), id: '019c0000-0000-7000-8000-0000000000c2' } as MemoryDto
    const page = (items: MemoryDto[]): MemoryPage => ({ items, nextCursor: null } as MemoryPage)
    const keys = [null, lilya.id].map((filter) => feedQueryKeys.list(familyId, 'all', false, accountId, 3, 0, filter))
    for (const key of keys) client.setQueryData(key, { pages: [page([target, other])], pageParams: [null] })
    applyChildTagsToCachedFeeds(client, familyId, target.id, { childTags: [{ childId: misha.id, attachmentId: photoA.id }], childTagsVersion: 2 })
    for (const key of keys) {
      const items = client.getQueryData<{ pages: MemoryPage[] }>(key)!.pages[0]!.items
      expect(items[0]?.childTags).toEqual([{ childId: misha.id, attachmentId: photoA.id }])
      expect(items[0]?.childTagsVersion).toBe(2)
      expect(items[1]?.childTagsVersion).toBe(1)
    }
  })
})
