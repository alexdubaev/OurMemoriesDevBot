export type MaxBotIdentity = {
  userId: number
  username: string
  isBot: boolean
}

export type MaxSubscription = {
  url: string
  time: number
  updateTypes: string[] | null
}

export type MaxSubscriptionInput = {
  url: string
  updateTypes: string[]
  secret: string
}

export type MaxSubscriptionResult = { success: boolean }

export type MaxSendMessageInput = {
  userId: string
  text: string
}

export type MaxApiPort = {
  getMe(signal?: AbortSignal): Promise<MaxBotIdentity>
  getSubscriptions(signal?: AbortSignal): Promise<MaxSubscription[]>
  createSubscription(input: MaxSubscriptionInput, signal?: AbortSignal): Promise<MaxSubscriptionResult>
  deleteSubscription(url: string, signal?: AbortSignal): Promise<MaxSubscriptionResult>
  sendMessage(input: MaxSendMessageInput, signal?: AbortSignal): Promise<void>
  getMessage(messageId: string, signal?: AbortSignal): Promise<MaxResolvedMessage>
  getVideo?(videoToken: string, signal?: AbortSignal): Promise<MaxVideoResolution>
}

export type MaxInboundAttachment =
  | { kind: 'image'; providerAttachmentId: string }
  | { kind: 'file'; providerAttachmentId: string; filename: string | null; declaredSize: number | null }
  | { kind: 'video'; providerAttachmentId: string; durationSeconds: number | null; width: number | null; height: number | null }

export type MaxResolvedAttachment =
  | { kind: 'image'; providerAttachmentId: string; url: string }
  | { kind: 'file'; providerAttachmentId: string; filename: string | null; declaredSize: number | null; url: string }
  | { kind: 'video'; providerAttachmentId: string; currentToken: string; inboundDurationSeconds: number | null; width: number | null; height: number | null }

export type MaxResolvedMessage = {
  messageId: string
  senderId: string
  recipientId: string
  attachments: MaxResolvedAttachment[]
}

export type MaxVideoRendition = {
  url: string
  width: number | null
  height: number | null
  contentLength: number | null
}

export type MaxVideoResolution = {
  width: number | null
  height: number | null
  renditions: MaxVideoRendition[]
  durationMs: number | null
}

export type MaxInboundEvent =
  | {
      kind: 'message_created'
      senderId: string
      recipientId: string
      messageId: string
      occurredAt: string
      text: string | null
      attachments?: MaxInboundAttachment[]
      /** @deprecated compatibility for pre-MAX-06 callers; normalized events always include attachments. */
      hasAttachments?: boolean
    }
  | {
      kind: 'bot_started'
      chatId: string
      userId: string
      occurredAt: string
      payload: string | null
    }

export type MaxAcceptResult = { inboxId: string; duplicate: boolean }

export type MaxImmediateResponse = {
  kind: 'accepted' | 'unsupported_media' | 'welcome'
  text: string
  destinationUserId: string
}

export type MaxAcceptRepository = {
  accept(input: {
    botId: string
    event: MaxInboundEvent
    eventKey: string
    encrypted: EncryptedMaxPayload
    response: MaxImmediateResponse | null
    now: Date
  }): Promise<MaxAcceptResult>
}

export type EncryptedMaxPayload = {
  ciphertext: Uint8Array
  iv: Uint8Array
  authTag: Uint8Array
}
