import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import type { ChildDto } from '@web-app-demo/contracts'

import { ChildTagPicker, composerChildIds, createMediaMemory, createNoteMemory, toggleChildId } from '../src/features/composer'
import { finalizeMaxVideo } from '../src/features/max-video-upload'
import type { AuthenticatedTransport } from '../src/platform/api'
import type { HttpRequestOptions } from '../src/platform/api/http-client'

const familyId = '019c0000-0000-7000-8000-000000000001'
const authorId = '019c0000-0000-7000-8000-0000000000f1'
const mediaId = '019c0000-0000-7000-8000-0000000000d1'
const crop = { x: 0, y: 0, width: 1, height: 1 }
const child = (id: string, name: string): ChildDto => ({ id, name, birthDate: '2022-01-01', sex: 'girl', avatarMediaId: null, avatarCrop: crop, version: 1, isComplete: true })
const lilya = child('019c0000-0000-7000-8000-0000000000a1', 'Лиля')
const misha = child('019c0000-0000-7000-8000-0000000000a2', 'Миша')

const memory = {
  id: '019c0000-0000-7000-8000-0000000000c1', familyId, childId: lilya.id,
  author: { id: authorId, name: 'Мама', avatarPath: null, avatarCrop: null },
  kind: 'note', body: 'Синтетика', occurredAt: '2026-10-01T10:00:00.000Z', firstPublishedAt: null, sourcePublishedAt: null, createdAt: '2026-10-01T10:00:00.000Z',
  version: 1, status: 'published', attachments: [], likes: { likedByMe: false, count: 0 }, reactionCounts: {}, currentUserReaction: null,
  capabilities: { edit: true, delete: true, like: true },
}

function recordingTransport(response: unknown) {
  const calls: Array<{ path: string; options?: HttpRequestOptions }> = []
  const transport: AuthenticatedTransport = {
    request: async (path, schema, options) => { calls.push({ path, options }); return schema.parse(response) },
    raw: async () => new Response(null, { status: 204 }),
  }
  return { calls, transport }
}
const body = (call: { options?: HttpRequestOptions } | undefined) => call?.options?.body as Record<string, unknown>

describe('composer child selection', () => {
  test('toggling adds and removes a child, keeping server order', () => {
    expect(toggleChildId([], misha.id, [lilya, misha])).toEqual([misha.id])
    expect(toggleChildId([misha.id], lilya.id, [lilya, misha])).toEqual([lilya.id, misha.id])
    expect(toggleChildId([lilya.id, misha.id], lilya.id, [lilya, misha])).toEqual([misha.id])
  })

  test('only a family with two or more children sends a selection, and it may be empty', () => {
    expect(composerChildIds([lilya, misha], [misha.id])).toEqual([misha.id])
    expect(composerChildIds([lilya, misha], [])).toEqual([])
    expect(composerChildIds([lilya], [lilya.id])).toBeUndefined()
    expect(composerChildIds(undefined, [])).toBeUndefined()
  })

  test('the picker marks the preselected child pressed and every child is a button', () => {
    const html = renderToStaticMarkup(<ChildTagPicker childOptions={[lilya, misha]} onChange={() => undefined} selected={[lilya.id]} />)
    expect(html).toContain('aria-pressed="true"')
    expect(html).toContain('aria-pressed="false"')
    expect(html).toContain('Лиля')
    expect(html).toContain('Миша')
  })

  test('a one-child family renders no picker', () => {
    expect(renderToStaticMarkup(<ChildTagPicker childOptions={[lilya]} onChange={() => undefined} selected={[lilya.id]} />)).toBe('')
  })
})

describe('publication carries the chosen children', () => {
  test('a note sends childIds and no legacy childId when children were chosen', async () => {
    const { calls, transport } = recordingTransport(memory)
    await createNoteMemory(transport, familyId, { childId: lilya.id, childIds: [misha.id], body: 'Синтетика', occurredAt: memory.occurredAt, idempotencyKey: 'key-1' })
    expect(body(calls[0])).toMatchObject({ kind: 'note', childIds: [misha.id] })
    expect(body(calls[0])).not.toHaveProperty('childId')
  })

  test('a note with no child chosen sends an empty list, not the default rule', async () => {
    const { calls, transport } = recordingTransport(memory)
    await createNoteMemory(transport, familyId, { childId: lilya.id, childIds: [], body: 'Синтетика', occurredAt: memory.occurredAt, idempotencyKey: 'key-2' })
    expect(body(calls[0])).toMatchObject({ childIds: [] })
  })

  test('a one-child family keeps the old request without childIds', async () => {
    const { calls, transport } = recordingTransport(memory)
    await createNoteMemory(transport, familyId, { childId: lilya.id, body: 'Синтетика', occurredAt: memory.occurredAt, idempotencyKey: 'key-3' })
    expect(body(calls[0])).toMatchObject({ childId: lilya.id })
    expect(body(calls[0])).not.toHaveProperty('childIds')
  })

  test('photos send the chosen children', async () => {
    const { calls, transport } = recordingTransport({ ...memory, kind: 'photo' })
    await createMediaMemory(transport, familyId, { kind: 'photo', childId: lilya.id, childIds: [lilya.id, misha.id], body: '', occurredAt: memory.occurredAt, mediaIds: [mediaId], idempotencyKey: 'key-4' })
    expect(body(calls[0])).toMatchObject({ kind: 'photo', childIds: [lilya.id, misha.id], mediaIds: [mediaId] })
  })

  test('a standalone video sends its children with finalize', async () => {
    const { calls, transport } = recordingTransport({ state: 'processing', sessionId: mediaId })
    await finalizeMaxVideo(transport, familyId, mediaId, 'token', undefined, [misha.id])
    expect(body(calls[0])).toEqual({ uploadToken: 'token', childIds: [misha.id] })
    await finalizeMaxVideo(transport, familyId, mediaId, 'token')
    expect(body(calls[1])).toEqual({ uploadToken: 'token' })
  })
})
