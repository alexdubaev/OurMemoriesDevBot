import type { TelegramInboundEvent } from '../domain/inbound-event'

export type TelegramAdmission = {
  userId: string
  familyId: string
  childId: string
  role: 'full' | 'viewer'
} | null

export type EncryptedTelegramPayload = {
  ciphertext: Uint8Array
  iv: Uint8Array
  authTag: Uint8Array
}

export type AcceptedTelegramUpdate = {
  inboxId: string | null
  duplicate: boolean
}

export type TelegramDownload = {
  body: ReadableStream<Uint8Array>
  byteSize: number
  contentType: string
}

export type TelegramApiPort = {
  download(fileId: string, expectedSize: number | null, signal?: AbortSignal): Promise<TelegramDownload>
  sendMessage(chatId: string, text: string, options?: {
    buttons?: Array<{ text: string; webAppUrl: string }>
    forceReply?: boolean
    replyToMessageId?: string
  }): Promise<void | { messageId: string }>
  getUpdates(offset: number, signal: AbortSignal): Promise<unknown[]>
  setCommands(commands: Array<{ command: string; description: string }>): Promise<void>
  setMenuButton(url: string): Promise<void>
}

export type TelegramAcceptRepository = {
  findAdmission(senderSubject: string): Promise<TelegramAdmission>
  accept(input: {
    botId: bigint
    event: TelegramInboundEvent
    encrypted: EncryptedTelegramPayload
    admission: TelegramAdmission
    now: Date
  }): Promise<AcceptedTelegramUpdate>
}
