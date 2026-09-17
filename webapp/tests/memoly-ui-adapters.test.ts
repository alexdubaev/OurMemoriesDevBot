import type { MemoryDto } from '@web-app-demo/contracts'
import { expect, test } from 'bun:test'

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

test('maps date labels using the family timezone', () => {
  const presentation = toMemoryPresentation(memory, 'Europe/Moscow')

  expect(presentation.dateKey).toBe('2026-09-11')
  expect(presentation.dateLabel).toContain('11')
  expect(presentation.timeLabel).toBe('03:30')
})

test('maps owner, full, and viewer capabilities only from supplied values', () => {
  expect(toCapabilities({ role: 'viewer', isOwner: false })).toMatchObject({
    canContribute: false,
    canDeleteMemories: false,
  })
  expect(toCapabilities({ role: 'full', isOwner: false }).canContribute).toBe(true)
  expect(toCapabilities({ role: 'viewer', isOwner: true }).canManageFamily).toBe(true)
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
