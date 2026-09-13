export const telegramCommands = ['start', 'help', 'app', 'privacy', 'cancel'] as const

export type TelegramCommand = (typeof telegramCommands)[number] | 'unknown'

type TelegramMessageIdentity = {
  updateId: string
  chatId: string
  messageId: string
  senderId: string
  occurredAt: string
}

export type TelegramVideoThumbnail = {
  fileId: string
  fileUniqueId: string
  byteSize: number | null
  contentType: 'image/jpeg'
  width: number | null
  height: number | null
}

export type TelegramMediaEvent = {
  kind: 'media'
  mediaKind: 'photo' | 'video' | 'voice'
  fileId: string
  fileUniqueId: string
  fileSize: number | null
  contentType: string
  width: number | null
  height: number | null
  durationMs: number | null
  thumbnail?: TelegramVideoThumbnail
  caption: string
  mediaGroupId: string | null
} & TelegramMessageIdentity

export type TelegramInboundEvent =
  | ({ kind: 'command'; command: TelegramCommand; argument: string } & TelegramMessageIdentity)
  | ({ kind: 'note'; text: string } & TelegramMessageIdentity)
  | ({ kind: 'caption_reply'; text: string; replyToMessageId: string } & TelegramMessageIdentity)
  | TelegramMediaEvent
  | { kind: 'ignored_group'; updateId: string }
  | { kind: 'ignored'; updateId: string }
  | ({ kind: 'denied_content' } & TelegramMessageIdentity)
