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
  buttons?: Array<{ text: string; payload: string }>
}

export type MaxVideoUploadCapability = {
  url: string
  token?: string
}

export type MaxSendVideoMessageInput = {
  userId: string
  text: string
  uploadToken: string
}

export type MaxImageUploadInput = {
  bytes: Uint8Array
  contentType: 'image/jpeg' | 'image/png' | 'image/heic'
  /** A generated backup name, never the private original filename. */
  fileName: string
}

export type MaxSendMediaMessageInput = {
  chatId: string
  text: string
  attachments: Array<{ kind: 'image' | 'video'; token: string }>
}

export type MaxApiPort = {
  getMe(signal?: AbortSignal): Promise<MaxBotIdentity>
  getSubscriptions(signal?: AbortSignal): Promise<MaxSubscription[]>
  createSubscription(input: MaxSubscriptionInput, signal?: AbortSignal): Promise<MaxSubscriptionResult>
  deleteSubscription(url: string, signal?: AbortSignal): Promise<MaxSubscriptionResult>
  sendMessage(input: MaxSendMessageInput, signal?: AbortSignal): Promise<void>
  answerCallback?(callbackId: string, text: string, signal?: AbortSignal): Promise<void>
  createVideoUpload(signal?: AbortSignal): Promise<MaxVideoUploadCapability>
  sendVideoMessage(input: MaxSendVideoMessageInput, signal?: AbortSignal): Promise<{ messageId: string }>
  uploadImage?(input: MaxImageUploadInput, signal?: AbortSignal): Promise<{ token: string }>
  sendMediaMessage?(input: MaxSendMediaMessageInput, signal?: AbortSignal): Promise<{ messageId: string }>
  findVideoMessageByIntent?(intentId: string, userId: string, signal?: AbortSignal): Promise<{ messageId: string } | null>
  getMessage(messageId: string, signal?: AbortSignal): Promise<MaxResolvedMessage>
  getVideo?(videoToken: string, signal?: AbortSignal): Promise<MaxVideoResolution>
}

export type MaxInboundAttachment =
  | { kind: 'image'; providerAttachmentId: string }
  | { kind: 'file'; providerAttachmentId: string; filename: string | null; declaredSize: number | null }
  | { kind: 'voice'; providerAttachmentId: string; url: string }
  | { kind: 'video'; providerAttachmentId: string; durationSeconds: number | null; width: number | null; height: number | null }

export type MaxResolvedAttachment =
  | { kind: 'image'; providerAttachmentId: string; url: string }
  | { kind: 'file'; providerAttachmentId: string; filename: string | null; declaredSize: number | null; url: string }
  | { kind: 'voice'; providerAttachmentId: string; url: string }
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
  | { kind: 'family_choice'; callbackId: string; payload: string; userId: string; occurredAt: string }

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

export type MaxVideoUploadSession = {
  id: string
  familyId: string
  authorId: string
  childId: string
  plannedMemoryId: string
  body: string
  mode?: 'standalone' | 'attachment'
  occurredAt: Date
  idempotencyFingerprint: string
  idempotencyKey: string
  expiresAt: Date
  state: 'reserved' | 'uploaded' | 'processing' | 'message_sent' | 'finalized' | 'failed' | 'expired'
  providerUploadToken: string | null
  providerMessageId: string | null
  providerSendIntentId: string | null
  retryCount: number
  lastRetryAt: Date | null
  lastErrorCode: string | null
  createdAt: Date
  updatedAt: Date
}

export type MaxOutboundSource = {
  id: string
  uploadSessionId: string
  familyId: string
  recipientId: string
  messageId: string
  providerAttachmentId: string
  width: number | null
  height: number | null
  durationMs: number | null
  createdAt: Date
  updatedAt: Date
}

export type MaxVideoUploadReserveInput = Omit<MaxVideoUploadSession, 'id' | 'state' | 'providerUploadToken' | 'providerMessageId' | 'providerSendIntentId' | 'retryCount' | 'lastRetryAt' | 'lastErrorCode' | 'createdAt' | 'updatedAt'> & {
  now: Date
}

export type MaxVideoUploadReservation = {
  session: MaxVideoUploadSession
  created: boolean
}

export type MaxVideoUploadCapabilityClaim = {
  session: MaxVideoUploadSession
  claimed: boolean
}

export type MaxVideoUploadCapabilityPersistence = {
  session: MaxVideoUploadSession
  persisted: boolean
}

export type MaxOutboundSourceInput = Omit<MaxOutboundSource, 'id' | 'createdAt' | 'updatedAt' | 'width' | 'height' | 'durationMs'> &
  Partial<Pick<MaxOutboundSource, 'width' | 'height' | 'durationMs'>>

export type MaxDirectUploadRepository = {
  reserve(input: MaxVideoUploadReserveInput): Promise<MaxVideoUploadReservation>
  claimUploadCapability(familyId: string, sessionId: string, now: Date): Promise<MaxVideoUploadCapabilityClaim | null>
  persistUploadCapability(session: MaxVideoUploadSession, token: string): Promise<MaxVideoUploadCapabilityPersistence>
  releaseUploadCapability(session: MaxVideoUploadSession, expired: boolean): Promise<MaxVideoUploadSession | null>
  createOutboundSource(input: MaxOutboundSourceInput): Promise<MaxOutboundSource>
  find(familyId: string, sessionId: string): Promise<MaxVideoUploadSession | null>
  claim(familyId: string, sessionId: string, now: Date): Promise<{ session: MaxVideoUploadSession; claimed: boolean; sendIntentCreated?: boolean } | null>
  update(session: MaxVideoUploadSession, patch: Partial<Pick<MaxVideoUploadSession, 'state' | 'providerUploadToken' | 'providerMessageId' | 'retryCount' | 'lastRetryAt' | 'lastErrorCode'>>): Promise<MaxVideoUploadSession>
  findOutboundSource?(uploadSessionId: string, familyId: string): Promise<MaxOutboundSource | null>
  findRecipientId?(familyId: string, userId: string): Promise<string | null>
  assertChild?(familyId: string, childId: string): Promise<boolean>
}
