import { expect, test } from 'bun:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import { AppearanceChoices, SettingsMenu } from '../src/features/memoly-ui/SettingsSheet'

test('owner settings sheet exposes canonical archive and family controls', () => {
  const markup = renderToStaticMarkup(createElement(SettingsMenu, {
    canManageFamily: true,
    onAbout: () => undefined,
    onAppearance: () => undefined,
    onArchive: () => undefined,
    onFamilySettings: () => undefined,
    onHelp: () => undefined,
    theme: 'mint',
  }))

  expect(markup).toContain('Оформление')
  expect(markup).toContain('Помощь и приватность')
  expect(markup).toContain('Семейный архив')
  expect(markup).toContain('Настройки семьи')
  expect(markup).toContain('О memoLy')
  expect(markup).not.toContain('system')
  expect(markup).not.toContain('dark')
  expect(markup).toContain('ml-settings-list')
  for (const icon of ['palette', 'help-circle', 'archive-box', 'pencil', 'circle-info']) {
    expect(markup).toContain(`data-settings-row="${icon}"`)
  }
  expect(markup).not.toContain('data-settings-row="star"')
})

test('non-owner settings has archive information without owner mutation entry', () => {
  const markup = renderToStaticMarkup(createElement(SettingsMenu, {
    canManageFamily: false,
    onAbout: () => undefined,
    onAppearance: () => undefined,
    onArchive: () => undefined,
    onFamilySettings: () => undefined,
    onHelp: () => undefined,
    theme: 'sky',
  }))
  expect(markup).toContain('Семейный архив')
  expect(markup).not.toContain('Настройки семьи')
})

test('appearance picker shows six canonical previews and the active theme', () => {
  const markup = renderToStaticMarkup(createElement(AppearanceChoices, { selected: 'lavender', onSelect: () => undefined }))
  expect(markup.match(/data-theme-choice=/g)).toHaveLength(6)
  for (const label of ['Мята', 'Роза', 'Небо', 'Лаванда', 'Абрикос', 'Песок']) expect(markup).toContain(label)
  expect(markup).toContain('data-theme-choice="lavender"')
  expect(markup).toMatch(/aria-pressed="true"[^>]*data-theme-choice="lavender"/)
  expect(markup).toContain('Выберите настроение')
  expect(markup).toContain('Оформление не зависит от пола ребёнка')
})
