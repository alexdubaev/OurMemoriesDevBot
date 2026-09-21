import type { MemoryDto } from '@web-app-demo/contracts'
import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { toCapabilities, toChildPresentation, toMemoryPresentation, toMemberPresentation, toInvitePresentation } from '../src/features/memoly-ui/adapters'

const familyId = '11111111-1111-4111-8111-111111111111'
const childId = '22222222-2222-4222-8222-222222222222'
const authorId = '33333333-3333-4333-8333-333333333333'
const mediaId = '44444444-4444-4444-8444-444444444444'
const memoryId = '55555555-5555-4555-8555-555555555555'

const memory: MemoryDto = {
  id: memoryId,
  familyId,
  childId,
  author: { id: authorId, name: 'Мама' },
  kind: 'photo',
  body: 'Первый снимок',
  occurredAt: '2026-09-11T00:30:00.000Z',
  createdAt: '2026-09-11T00:30:00.000Z',
  version: 1,
  status: 'published',
  attachments: [{
    id: mediaId,
    source: 'private_storage',
    kind: 'photo',
    width: 1_080,
    height: 1_920,
    durationMs: null,
    renditionStatus: 'ready',
    previewPath: `/api/v1/families/${familyId}/media/${mediaId}/content?variant=preview`,
    displayPath: `/api/v1/families/${familyId}/media/${mediaId}/content?variant=display`,
    playbackPath: `/api/v1/families/${familyId}/media/${mediaId}/content?variant=playback`,
    originalDownloadPath: `/api/v1/families/${familyId}/media/${mediaId}/content?variant=original`,
    waveform: null,
  }],
  likes: { count: 2, likedByMe: true },
  capabilities: { edit: true, delete: true, like: true },
}

test('maps a private-photo memory without changing its private path', () => {
  expect(toMemoryPresentation(memory, 'Europe/Moscow')).toMatchObject({
    id: memory.id,
    type: 'photo',
    images: [memory.attachments[0]!.playbackPath],
  })
})

test('uses the display or preview path when a private photo has no playback path', () => {
  const photoWithoutPlayback: MemoryDto = {
    ...memory,
    attachments: [{ ...memory.attachments[0]!, playbackPath: null }],
  }

  expect(toMemoryPresentation(photoWithoutPlayback, 'Europe/Moscow').images).toEqual([
    memory.attachments[0]!.displayPath,
  ])
})

test('maps date labels using the family timezone', () => {
  const presentation = toMemoryPresentation(memory, 'Europe/Moscow')

  expect(presentation.dateKey).toBe('2026-09-11')
  expect(presentation.dateLabel).toContain('11')
  expect(presentation.timeLabel).toBe('03:30')
})

test('passes through existing capability values without deriving permissions from role or owner', () => {
  const supplied = {
    canContribute: false,
    canDeleteMemories: false,
    canEditMemories: false,
    canManageFamily: false,
    canInvite: false,
    canEditChild: false,
    canLeaveFamily: true,
  }

  expect(toCapabilities({ capabilities: supplied })).toEqual(supplied)
})

test('maps child, member, and invite values without inventing media or tokens', () => {
  expect(toChildPresentation({
    id: childId,
    name: 'Лиза',
    birthDate: '2024-02-10',
    sex: 'girl',
    avatarMediaId: null,
    avatarCrop: null,
    version: 1,
    isComplete: true,
  }, 'UTC', new Date('2026-09-17T12:00:00.000Z'))).toMatchObject({
    id: childId,
    name: 'Лиза',
    ageText: '2 года 7 месяцев',
    avatarUrl: null,
  })

  expect(toMemberPresentation({
    userId: authorId,
    displayName: 'Ольга',
    familyDisplayName: 'Бабушка Оля',
    role: 'full',
    isOwner: false,
    joinedAt: '2026-09-01T00:00:00.000Z',
    version: 1,
  })).toMatchObject({ id: authorId, displayName: 'Бабушка Оля', role: 'FULL' })

  expect(toInvitePresentation({
    id: memoryId,
    role: 'viewer',
    inviteeDisplayName: 'Дедушка',
    expiresAt: '2026-09-20T00:00:00.000Z',
    createdAt: '2026-09-17T00:00:00.000Z',
  })).toMatchObject({ id: memoryId, label: 'Дедушка', role: 'VIEWER', status: 'pending' })
})

test('reserves the normalized bottom host inset for the namespaced navigation', () => {
  const css = readFileSync(resolve(import.meta.dir, '../src/features/memoly-ui/memoly-ui.css'), 'utf8')

  expect(css).toContain('padding-bottom: var(--host-inset-bottom, 0px)')
})

test('memoLy presentation CSS keeps captions readable and outer gutters single at 320px', () => {
  const css = readFileSync(resolve(import.meta.dir, '../src/features/memoly-ui/memoly-ui.css'), 'utf8').replaceAll('\r\n', '\n')

  expect(css).toContain('overflow-wrap: anywhere')
  expect(css).toContain('-webkit-line-clamp: 4')
  expect(css).toContain('.ml-topbar,\n.ml-simple-header {')
  expect(css).toContain('padding: 0 0 8px;')
  expect(css).toContain('.ml-child-hero {')
  expect(css).toContain('margin: 8px 0 12px;')
  expect(css).toContain('.ml-family-content { padding: 0; }')
})

test('memoLy shell clips horizontal overflow without creating a sticky ancestor', () => {
  const css = readFileSync(resolve(import.meta.dir, '../src/features/memoly-ui/memoly-ui.css'), 'utf8')
  const shellRule = css.match(/\.ml-shell\s*\{([\s\S]*?)\n\}/)?.[1]

  expect(shellRule).toBeDefined()
  expect(shellRule).toContain('overflow-x: clip;')
  expect(shellRule).not.toContain('overflow: hidden;')
})
