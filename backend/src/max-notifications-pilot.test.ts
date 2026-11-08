import { expect, test } from 'bun:test'
import { albumNotificationText } from './max-notifications-pilot'

test('album notification uses the stored name and Russian photo-count wording', () => {
  expect(albumNotificationText('Мастерская', 1)).toBe('В альбом «Мастерская» добавлена 1 фотография 📸')
  expect(albumNotificationText('Первые 12 месяцев', 3)).toBe('В альбом «Первые 12 месяцев» добавлены 3 фотографии 📸')
  expect(albumNotificationText('Работы', 21)).toBe('В альбом «Работы» добавлена 21 фотография 📸')
  expect(albumNotificationText('Работы', 11)).toBe('В альбом «Работы» добавлено 11 фотографий 📸')
})

test('album title cannot inject control characters or unbounded notification text', () => {
  expect(albumNotificationText('«А»\n\u202eБ\u0000', 1)).toBe('В альбом «А Б» добавлена 1 фотография 📸')
  expect(albumNotificationText('📷'.repeat(120), 1)).toBe(`В альбом «${'📷'.repeat(100)}» добавлена 1 фотография 📸`)
  expect(albumNotificationText('\u0000\n', 1)).toBe('В альбом «Семейный альбом» добавлена 1 фотография 📸')
})
