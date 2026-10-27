import { expect, test } from 'bun:test'
import { albumNotificationText } from './max-notifications-pilot'

test('album notification uses the stored name and Russian photo-count wording', () => {
  expect(albumNotificationText('Мастерская', 1)).toBe('Новое фото в альбоме «Мастерская» 📸')
  expect(albumNotificationText('Первые 12 месяцев', 3)).toBe('В альбоме «Первые 12 месяцев» — 3 новых фото 📸')
  expect(albumNotificationText('Работы', 21)).toBe('В альбоме «Работы» — 21 новое фото 📸')
  expect(albumNotificationText('Работы', 11)).toBe('В альбоме «Работы» — 11 новых фото 📸')
})

test('album title cannot inject control characters or unbounded notification text', () => {
  expect(albumNotificationText('«А»\n\u202eБ\u0000', 1)).toBe('Новое фото в альбоме «А Б» 📸')
  expect(albumNotificationText('📷'.repeat(120), 1)).toBe(`Новое фото в альбоме «${'📷'.repeat(100)}» 📸`)
  expect(albumNotificationText('\u0000\n', 1)).toBe('Новое фото в альбоме «Семейный альбом» 📸')
})
