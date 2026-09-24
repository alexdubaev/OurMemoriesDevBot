import { expect, test } from 'bun:test'
import type { FamilyResponse } from '@web-app-demo/contracts'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import { ChildProfile } from '../src/features/family/ChildProfile'

const child: NonNullable<FamilyResponse['child']> = {
  id: '33333333-3333-4333-8333-333333333333',
  name: 'София',
  birthDate: '2024-05-20',
  sex: 'girl',
  avatarMediaId: '55555555-5555-4555-8555-555555555555',
  avatarCrop: { x: 0, y: 0, width: 1, height: 1 },
  version: 1,
  isComplete: true,
}

const actions = {
  onBack: () => undefined,
  onEdit: () => undefined,
  onOpenAge: () => undefined,
}

test('child profile shows real child data and the existing protected avatar URL', () => {
  const markup = renderToStaticMarkup(createElement(ChildProfile, {
    ...actions,
    avatarUrl: 'blob:protected-child-avatar',
    canEdit: true,
    child,
    familyTimezone: 'Europe/Moscow',
    showAgeDetails: false,
  }))

  expect(markup).toContain('data-slot="child-profile"')
  expect(markup).toContain('София')
  expect(markup).toContain('Родилась 20 мая 2024')
  expect(markup).toContain('src="blob:protected-child-avatar"')
  expect(markup).toContain('Редактировать профиль')
  expect(markup).toContain('Сменить фото')
  expect(markup).toContain('Возраст и дата рождения')
  expect(markup).not.toContain('/api/v1/families/')
})

test('viewer can open the child profile without owner actions', () => {
  const markup = renderToStaticMarkup(createElement(ChildProfile, {
    ...actions,
    avatarUrl: null,
    canEdit: false,
    child,
    familyTimezone: 'Europe/Moscow',
    showAgeDetails: false,
  }))

  expect(markup).toContain('Профиль ребёнка')
  expect(markup).toContain('data-slot="avatar-letter"')
  expect(markup).not.toContain('Редактировать профиль')
  expect(markup).not.toContain('Сменить фото')
  expect(markup).toContain('Возраст и дата рождения')
})

test('age details use the child birth date and keep edit behind permissions', () => {
  const markup = renderToStaticMarkup(createElement(ChildProfile, {
    ...actions,
    avatarUrl: null,
    canEdit: false,
    child,
    familyTimezone: 'Europe/Moscow',
    showAgeDetails: true,
  }))

  expect(markup).toContain('Возраст обновляется автоматически')
  expect(markup).toContain('Полных месяцев')
  expect(markup).not.toContain('Изменить данные')
})

test('missing optional birth date and photo remain readable without a dead age action', () => {
  const markup = renderToStaticMarkup(createElement(ChildProfile, {
    ...actions,
    avatarUrl: null,
    canEdit: false,
    child: { ...child, name: 'Имя ребёнка с очень длинным составным именем', birthDate: null, sex: null, avatarMediaId: null },
    familyTimezone: 'Europe/Moscow',
    showAgeDetails: false,
  }))

  expect(markup).toContain('Имя ребёнка с очень длинным составным именем')
  expect(markup).toContain('Дата рождения не указана')
  expect(markup).toContain('data-slot="avatar-letter"')
  expect(markup).not.toContain('Возраст и дата рождения')
})
