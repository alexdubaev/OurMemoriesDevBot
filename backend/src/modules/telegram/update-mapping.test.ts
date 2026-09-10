import { describe, expect, test } from 'bun:test'

import { normalizeTelegramUpdate } from './transport/update-mapping'

describe('Telegram update mapping', () => {
  test('maps a private non-command text to a note without changing its content', () => {
    const mapped = normalizeTelegramUpdate({
      update_id: 101,
      message: {
        message_id: 11,
        date: 1_788_000_000,
        chat: { id: 42, type: 'private', first_name: 'Александр' },
        from: { id: 42, is_bot: false, first_name: 'Александр' },
        text: 'Сегодня сама придумала историю про облако.',
      },
    })

    expect(mapped).toEqual({
      kind: 'note',
      updateId: '101',
      chatId: '42',
      messageId: '11',
      senderId: '42',
      occurredAt: '2026-08-29T10:40:00.000Z',
      text: 'Сегодня сама придумала историю про облако.',
    })
  })

  test('maps supported commands and keeps an optional start payload separate from content', () => {
    expect(normalizeTelegramUpdate({
      update_id: 102,
      message: {
        message_id: 12,
        date: 1_788_000_000,
        chat: { id: 42, type: 'private', first_name: 'Александр' },
        from: { id: 42, is_bot: false, first_name: 'Александр' },
        text: '/start invite-token',
      },
    })).toMatchObject({ kind: 'command', command: 'start', argument: 'invite-token' })

    expect(normalizeTelegramUpdate({
      update_id: 103,
      message: {
        message_id: 13,
        date: 1_788_000_000,
        chat: { id: 42, type: 'private', first_name: 'Александр' },
        from: { id: 42, is_bot: false, first_name: 'Александр' },
        text: '/help@OurMemoriesDevBot',
      },
    })).toMatchObject({ kind: 'command', command: 'help', argument: '' })
  })

  test('uses the largest Telegram photo and carries caption and album identity', () => {
    const mapped = normalizeTelegramUpdate({
      update_id: 104,
      message: {
        message_id: 14,
        media_group_id: 'album-7',
        date: 1_788_000_000,
        chat: { id: 42, type: 'private', first_name: 'Александр' },
        from: { id: 42, is_bot: false, first_name: 'Александр' },
        caption: 'У моря',
        photo: [
          { file_id: 'small', file_unique_id: 'small-u', width: 90, height: 90, file_size: 100 },
          { file_id: 'large', file_unique_id: 'large-u', width: 1280, height: 960, file_size: 900_000 },
        ],
      },
    })

    expect(mapped).toMatchObject({
      kind: 'media',
      mediaKind: 'photo',
      fileId: 'large',
      fileUniqueId: 'large-u',
      fileSize: 900_000,
      caption: 'У моря',
      mediaGroupId: 'album-7',
    })
  })

  test('maps video and voice as source media without claiming rendition readiness', () => {
    const common = {
      date: 1_788_000_000,
      chat: { id: 42, type: 'private' as const, first_name: 'Александр' },
      from: { id: 42, is_bot: false, first_name: 'Александр' },
    }
    expect(normalizeTelegramUpdate({
      update_id: 105,
      message: {
        ...common,
        message_id: 15,
        video: {
          file_id: 'video-id', file_unique_id: 'video-u', width: 640, height: 480,
          duration: 8, file_size: 1_000_000, mime_type: 'video/mp4',
        },
      },
    })).toMatchObject({ kind: 'media', mediaKind: 'video', contentType: 'video/mp4' })
    expect(normalizeTelegramUpdate({
      update_id: 106,
      message: {
        ...common,
        message_id: 16,
        voice: {
          file_id: 'voice-id', file_unique_id: 'voice-u', duration: 4,
          file_size: 80_000, mime_type: 'audio/ogg',
        },
      },
    })).toMatchObject({ kind: 'media', mediaKind: 'voice', contentType: 'audio/ogg' })
  })

  test('drops all group content before the durable boundary', () => {
    expect(normalizeTelegramUpdate({
      update_id: 107,
      message: {
        message_id: 17,
        date: 1_788_000_000,
        chat: { id: -10055, type: 'supergroup', title: 'Семья' },
        from: { id: 42, is_bot: false, first_name: 'Александр' },
        text: 'Текст, который нельзя сохранять',
      },
    })).toEqual({ kind: 'ignored_group', updateId: '107' })
  })

  test('ignores unsupported updates without copying their payload', () => {
    expect(normalizeTelegramUpdate({ update_id: 108, edited_message: {} as never }))
      .toEqual({ kind: 'ignored', updateId: '108' })
  })

  test('maps a reply as an explicit caption candidate, never as a new note', () => {
    expect(normalizeTelegramUpdate({
      update_id: 109,
      message: {
        message_id: 19,
        date: 1_788_000_000,
        chat: { id: 42, type: 'private' },
        from: { id: 42, is_bot: false, first_name: 'Александр' },
        reply_to_message: { message_id: 18, text: 'Исходное сообщение' },
        text: 'Это будущая подпись, а не новая заметка',
      },
    })).toMatchObject({ kind: 'caption_reply', updateId: '109', replyToMessageId: '18', text: 'Это будущая подпись, а не новая заметка' })
  })
})
