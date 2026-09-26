import { telegramCommands, type TelegramCommand, type TelegramInboundEvent } from '../domain/inbound-event'

export type { TelegramInboundEvent } from '../domain/inbound-event'

export function normalizeTelegramUpdate(input: unknown): TelegramInboundEvent {
  if (!isRecord(input) || !isSafeInteger(input.update_id)) {
    throw new Error('Telegram update is missing a usable update_id')
  }
  const updateId = String(input.update_id)
  if (isRecord(input.callback_query)) {
    const callback = input.callback_query
    if (!isRecord(callback.from) || !isSafeInteger(callback.from.id) || !isRecord(callback.message)
      || !isRecord(callback.message.chat) || callback.message.chat.type !== 'private'
      || !isSafeInteger(callback.message.chat.id) || typeof callback.id !== 'string'
      || typeof callback.data !== 'string' || callback.data.length > 64) return { kind: 'ignored', updateId }
    return { kind: 'family_choice', updateId, callbackId: callback.id, senderId: String(callback.from.id),
      chatId: String(callback.message.chat.id), payload: callback.data }
  }
  const message = isRecord(input.message) ? input.message : null
  if (!message || !isRecord(message.chat)) return { kind: 'ignored', updateId }
  if (message.chat.type !== 'private') return { kind: 'ignored_group', updateId }
  if (!isRecord(message.from) || !isSafeInteger(message.from.id) ||
      !isSafeInteger(message.chat.id) || !isSafeInteger(message.message_id) ||
      !isSafeInteger(message.date)) {
    return { kind: 'ignored', updateId }
  }

  const identity = {
    updateId,
    chatId: String(message.chat.id),
    messageId: String(message.message_id),
    senderId: String(message.from.id),
    occurredAt: new Date(message.date * 1_000).toISOString(),
  }

  if (typeof message.text === 'string') {
    const command = parseCommand(message.text)
    if (command) return { kind: 'command', ...identity, ...command }
    if (isRecord(message.reply_to_message) && isSafeInteger(message.reply_to_message.message_id)) {
      return { kind: 'caption_reply', ...identity, text: message.text, replyToMessageId: String(message.reply_to_message.message_id) }
    }
    return { kind: 'note', ...identity, text: message.text }
  }

  if (Array.isArray(message.photo) && message.photo.length > 0) {
    const photo = [...message.photo]
      .filter((item) => isRecord(item) && typeof item.file_id === 'string' &&
        typeof item.file_unique_id === 'string')
      .sort((left, right) => photoWeight(right) - photoWeight(left))[0]
    if (photo && isRecord(photo)) {
      return {
        kind: 'media',
        ...identity,
        mediaKind: 'photo',
        fileId: photo.file_id as string,
        fileUniqueId: photo.file_unique_id as string,
        fileSize: isSafeInteger(photo.file_size) ? photo.file_size : null,
        contentType: 'image/jpeg',
        width: isSafeInteger(photo.width) ? photo.width : null,
        height: isSafeInteger(photo.height) ? photo.height : null,
        durationMs: null,
        caption: typeof message.caption === 'string' ? message.caption : '',
        mediaGroupId: typeof message.media_group_id === 'string' ? message.media_group_id : null,
      }
    }
  }

  for (const [field, mediaKind, fallbackContentType] of [
    ['video', 'video', 'video/mp4'],
    ['voice', 'voice', 'audio/ogg'],
  ] as const) {
    const media = message[field]
    if (!isRecord(media) || typeof media.file_id !== 'string' ||
        typeof media.file_unique_id !== 'string') continue
    const thumbnail = mediaKind === 'video' ? videoThumbnail(media.thumbnail) : undefined
    return {
      kind: 'media',
      ...identity,
      mediaKind,
      fileId: media.file_id,
      fileUniqueId: media.file_unique_id,
      fileSize: isSafeInteger(media.file_size) ? media.file_size : null,
      contentType: typeof media.mime_type === 'string' ? media.mime_type : fallbackContentType,
      width: isSafeInteger(media.width) ? media.width : null,
      height: isSafeInteger(media.height) ? media.height : null,
      durationMs: isSafeInteger(media.duration) ? media.duration * 1_000 : null,
      ...(thumbnail ? { thumbnail } : {}),
      caption: typeof message.caption === 'string' ? message.caption : '',
      mediaGroupId: typeof message.media_group_id === 'string' ? message.media_group_id : null,
    }
  }

  return { kind: 'ignored', updateId }
}

function videoThumbnail(value: unknown) {
  if (!isRecord(value) || typeof value.file_id !== 'string' || typeof value.file_unique_id !== 'string') return null
  return {
    fileId: value.file_id,
    fileUniqueId: value.file_unique_id,
    byteSize: isSafeInteger(value.file_size) ? value.file_size : null,
    contentType: 'image/jpeg' as const,
    width: isSafeInteger(value.width) ? value.width : null,
    height: isSafeInteger(value.height) ? value.height : null,
  }
}

function parseCommand(text: string): { command: TelegramCommand; argument: string } | null {
  const match = /^\/([a-z0-9_]+)(?:@[A-Za-z0-9_]+)?(?:\s+([\s\S]*))?$/i.exec(text.trim())
  if (!match) return null
  const name = match[1]?.toLowerCase() ?? ''
  const command = telegramCommands.includes(name as (typeof telegramCommands)[number])
    ? name as (typeof telegramCommands)[number]
    : 'unknown'
  return { command, argument: match[2]?.trim() ?? '' }
}

function photoWeight(value: unknown) {
  if (!isRecord(value)) return 0
  if (isSafeInteger(value.file_size)) return value.file_size
  const width = isSafeInteger(value.width) ? value.width : 0
  const height = isSafeInteger(value.height) ? value.height : 0
  return width * height
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value)
}
