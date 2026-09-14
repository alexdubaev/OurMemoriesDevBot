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

export type MaxApiPort = {
  getMe(signal?: AbortSignal): Promise<MaxBotIdentity>
  getSubscriptions(signal?: AbortSignal): Promise<MaxSubscription[]>
  createSubscription(input: MaxSubscriptionInput, signal?: AbortSignal): Promise<MaxSubscriptionResult>
  deleteSubscription(url: string, signal?: AbortSignal): Promise<MaxSubscriptionResult>
}

export type MaxInboundEvent =
  | {
      kind: 'message_created'
      senderId: string
      recipientId: string
      messageId: string
      occurredAt: string
      text: string | null
      hasAttachments: boolean
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
