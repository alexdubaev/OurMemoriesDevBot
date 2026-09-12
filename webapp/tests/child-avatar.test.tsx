import { expect, test } from 'bun:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import { ChildAvatar } from '../src/features/family/ChildAvatar'
import { shouldShowChildAvatarImage } from '../src/features/family/child-avatar-state'
import { childSchema } from '../../packages/contracts/src/families'

const child = {
  id: '33333333-3333-4333-8333-333333333333',
  name: 'Лилия',
  birthDate: '2025-06-12',
  sex: 'girl' as const,
  avatarMediaId: '55555555-5555-4555-8555-555555555555',
  avatarCrop: { x: 0, y: 0, width: 1, height: 1 },
  version: 1,
  isComplete: true,
}

test('renders the resolved protected avatar image at the feed-header size', () => {
  const markup = renderToStaticMarkup(createElement(ChildAvatar, {
    avatarCrop: child.avatarCrop,
    avatarUrl: 'blob:protected-child-avatar',
    name: child.name,
    size: 'feed-header',
  }))

  expect(markup).toContain('data-slot="child-avatar-image"')
  expect(markup).toContain('src="blob:protected-child-avatar"')
  expect(markup).toContain('size-[60px]')
  expect(markup).toContain('object-cover')
})

test('renders the initial-letter fallback when no avatar is available', () => {
  const markup = renderToStaticMarkup(createElement(ChildAvatar, {
    avatarCrop: null,
    avatarUrl: null,
    name: child.name,
    size: 'feed-header',
  }))

  expect(markup).toContain('data-slot="avatar-letter"')
  expect(markup).toContain('>Л</p>')
  expect(markup).not.toContain('data-slot="child-avatar-image"')
})

test('uses the initial-letter fallback after an avatar image fails', () => {
  expect(shouldShowChildAvatarImage({ avatarUrl: 'blob:protected-child-avatar', imageFailed: true })).toBe(false)
})

test('the child DTO rejects a raw storage key while retaining only the opaque media id', () => {
  expect(childSchema.safeParse({ ...child, storageKey: 'families/private/avatar.webp' }).success).toBe(false)
  expect(childSchema.parse(child).avatarMediaId).toBe(child.avatarMediaId)
})
