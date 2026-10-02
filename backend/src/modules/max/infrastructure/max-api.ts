import type {
  MaxApiPort,
  MaxBotIdentity,
  MaxSubscription,
  MaxSubscriptionInput,
  MaxSubscriptionResult,
  MaxResolvedMessage,
  MaxVideoResolution,
  MaxVideoUploadCapability,
  MaxSendVideoMessageInput,
  MaxSendMessageInput,
  MaxImageUploadInput,
  MaxSendMediaMessageInput,
} from '../application/ports'
import { readMaxInt64AtPath, readMaxStringAtPath } from '../application/channel-protocol'

const MAX_API_BASE = 'https://platform-api2.max.ru'
const REQUEST_TIMEOUT_MS = 10_000
const MAX_INT64_MIN = -9_223_372_036_854_775_808n
const MAX_INT64_MAX = 9_223_372_036_854_775_807n
const MAX_PRIVATE_PHOTO_BYTES = 20_000_000

export class MaxProviderError extends Error {
  readonly retryAfterSeconds?: number
  readonly retryable: boolean
  readonly status?: number
  readonly code?: string

  constructor(retryAfterSeconds?: number, retryable = false, status?: number, code?: string) {
    super('MAX provider request failed')
    this.name = 'MaxProviderError'
    this.retryAfterSeconds = retryAfterSeconds
    this.retryable = retryable
    this.status = status
    this.code = code
  }
}

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>

export function createMaxApi(token: string, options: { fetch?: FetchLike } = {}): MaxApiPort {
  const requestUrl = async (url: string, init: RequestInit, callerSignal?: AbortSignal, includeRawBody = false): Promise<unknown> => {
    const controller = new AbortController()
    const onCallerAbort = () => controller.abort()
    callerSignal?.addEventListener('abort', onCallerAbort, { once: true })
    if (callerSignal?.aborted) controller.abort()
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
    try {
      const response = await (options.fetch ?? fetch)(url, {
        ...init,
        headers: { ...(init.headers ?? {}), Authorization: token },
        redirect: 'manual',
        signal: controller.signal,
      })
      if (!response.ok) {
        throw new MaxProviderError(
          retryAfterSeconds(response),
          response.status === 429 || response.status >= 500,
          response.status,
          await providerErrorCode(response),
        )
      }
      try {
        const rawBody = await response.text()
        const value: unknown = JSON.parse(rawBody)
        return includeRawBody ? { value, rawBody } : value
      } catch {
        throw new MaxProviderError()
      }
    } catch (error) {
      if (error instanceof MaxProviderError) throw error
      throw new MaxProviderError(undefined, true)
    } finally {
      clearTimeout(timeout)
      callerSignal?.removeEventListener('abort', onCallerAbort)
    }
  }
  const request = (path: string, init: RequestInit, callerSignal?: AbortSignal) =>
    requestUrl(`${MAX_API_BASE}${path}`, init, callerSignal)

  return {
    async getMe(signal) {
      return normalizeBotIdentity(await request('/me', { method: 'GET' }, signal))
    },
    async getSubscriptions(signal) {
      return normalizeSubscriptions(await request('/subscriptions', { method: 'GET' }, signal))
    },
    async createSubscription(input, signal) {
      validateSubscriptionInput(input)
      return normalizeSubscriptionResult(await request('/subscriptions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ url: input.url, update_types: input.updateTypes, secret: input.secret }),
      }, signal))
    },
    async deleteSubscription(url, signal) {
      if (!isHttpsUrl(url)) throw new MaxProviderError()
      const query = new URLSearchParams({ url }).toString()
      return normalizeSubscriptionResult(await request(`/subscriptions?${query}`, {
        method: 'DELETE',
      }, signal))
    },
    async sendMessage(input, signal) {
      validateSendMessageInput(input)
      const value = await request(`/messages?${new URLSearchParams({ user_id: input.userId }).toString()}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: input.text, ...(input.buttons?.length ? { attachments: [{ type: 'inline_keyboard', payload: {
          buttons: input.buttons.map((button) => button.type === 'open_app'
            ? [{ type: 'open_app', text: button.text, web_app: button.webApp, ...(button.payload ? { payload: button.payload } : {}) }]
            : [{ type: 'callback', text: button.text, payload: button.payload }]),
        } }] } : {}) }),
      }, signal)
      if (!isRecord(value) || !isRecord(value.message)) throw new MaxProviderError()
    },
    async answerCallback(callbackId, text, signal) {
      if (!callbackId || callbackId.length > 512 || !text || [...text].length > 4000) throw new MaxProviderError()
      const result = await request(`/answers?${new URLSearchParams({ callback_id: callbackId }).toString()}`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ message: { text, attachments: [] } }),
      }, signal)
      if (!isRecord(result) || result.success !== true) throw new MaxProviderError()
    },
    async createVideoUpload(signal) {
      return normalizeVideoUploadCapability(await request('/uploads?type=video', { method: 'POST' }, signal))
    },
    async sendVideoMessage(input: MaxSendVideoMessageInput, signal) {
      validateSendVideoMessageInput(input)
      const value = await request(`/messages?${new URLSearchParams({ user_id: input.userId }).toString()}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: input.text, attachments: [{ type: 'video', payload: { token: input.uploadToken } }] }),
      }, signal)
      return normalizeSentVideoMessage(value)
    },
    async uploadImage(input: MaxImageUploadInput, signal) {
      validateImageUploadInput(input)
      const capability = await request('/uploads?type=image', { method: 'POST' }, signal)
      const uploadUrl = normalizeImageUploadUrl(capability)
      const form = new FormData()
      form.set('data', new Blob([Uint8Array.from(input.bytes)], { type: input.contentType }), input.fileName)
      const uploaded = await requestUrl(uploadUrl, { method: 'POST', body: form }, signal)
      return { token: normalizeImageUploadToken(uploaded) }
    },
    async sendMediaMessage(input: MaxSendMediaMessageInput, signal) {
      validateSendMediaMessageInput(input)
      const value = await request(`/messages?${new URLSearchParams({ chat_id: input.chatId }).toString()}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: input.text, attachments: input.attachments.map((attachment) => ({
          type: attachment.kind, payload: { token: attachment.token },
        })) }),
      }, signal)
      return normalizeSentVideoMessage(value)
    },
    async getMessage(messageId, signal) {
      // TODO(post-MVP MAX history import): Add history listing only after provider validation proves no-gap pagination and a durable checkpoint; see docs/mvp/plans/mixed-media-max-import/POST_MVP_MAX_HISTORICAL_IMPORT.md.
      if (typeof messageId !== 'string' || messageId.length === 0 || messageId.length > 512) throw new MaxProviderError()
      const result = await requestUrl(`${MAX_API_BASE}/messages?${new URLSearchParams({ message_ids: messageId }).toString()}`, { method: 'GET' }, signal, true)
      if (!isRecord(result) || typeof result.rawBody !== 'string' || !Object.hasOwn(result, 'value')) throw new MaxProviderError()
      return normalizeMessageLookup(result.value, messageId, result.rawBody)
    },
    async getVideo(videoToken, signal) {
      // TODO(post-MVP MAX history import): Re-resolve historical media tokens before transfer; never persist a temporary provider URL as the durable media source.
      if (typeof videoToken !== 'string' || videoToken.length === 0 || videoToken.length > 4_096) throw new MaxProviderError()
      return normalizeVideo(await request(`/videos/${encodeURIComponent(videoToken)}`, { method: 'GET' }, signal))
    },
  }
}

function normalizeMessageLookup(value: unknown, expectedMessageId: string, rawBody: string): MaxResolvedMessage {
  if (isRecord(value) && Array.isArray(value.messages) && value.messages.length === 0) {
    throw new MaxProviderError(undefined, false, 404, 'message_not_found')
  }
  const path: Array<string | number> = isRecord(value) && Array.isArray(value.messages) ? ['messages', 0] :
    isRecord(value) && isRecord(value.message) ? ['message'] : []
  const candidate = isRecord(value) && Array.isArray(value.messages) ? value.messages[0] :
    isRecord(value) && isRecord(value.message) ? value.message : value
  if (!isRecord(candidate) || !isRecord(candidate.recipient) || !isRecord(candidate.body) ||
      (candidate.recipient.chat_type !== 'dialog' && candidate.recipient.chat_type !== 'channel') ||
      (candidate.recipient.chat_type === 'dialog' && (!isRecord(candidate.sender) || !isPositiveSafeInteger(candidate.sender.user_id) || !isPositiveSafeInteger(candidate.recipient.user_id))) ||
      (candidate.recipient.chat_type === 'channel' && (!isInt64Id(candidate.recipient.chat_id) || candidate.recipient.chat_id === 0 ||
        isRecord(candidate.sender) && !isPositiveSafeInteger(candidate.sender.user_id))) ||
      (candidate.recipient.chat_type === 'dialog' && candidate.recipient.chat_id !== null && !isPositiveSafeInteger(candidate.recipient.chat_id)) ||
      typeof candidate.body.mid !== 'string' || candidate.body.mid !== expectedMessageId ||
      !Array.isArray(candidate.body.attachments)) throw new MaxProviderError()
  const attachments = candidate.body.attachments.map(normalizeResolvedAttachment)
  const recipientId = candidate.recipient.chat_type === 'channel'
    ? exactRawChannelRecipientId(rawBody, [...path, 'recipient', 'chat_id'], [...path, 'recipient', 'chat_type'], candidate.recipient.chat_id)
    : String(candidate.recipient.user_id)
  if (recipientId === null) throw new MaxProviderError()
  return { messageId: expectedMessageId,
    senderId: candidate.recipient.chat_type === 'channel' && !isRecord(candidate.sender) ? '0' : String((candidate.sender as Record<string, unknown>).user_id),
    recipientId, attachments }
}

function exactRawChannelRecipientId(rawBody: string, idPath: Array<string | number>, typePath: Array<string | number>, parsedId: unknown): string | null {
  if (readMaxStringAtPath(rawBody, typePath) !== 'channel') return null
  const exactId = readMaxInt64AtPath(rawBody, idPath, true)
  if (exactId === null || exactId === 0n) return null
  if (typeof parsedId === 'number') {
    if (!Number.isFinite(parsedId) || !Number.isInteger(parsedId) || Number(exactId) !== parsedId) return null
  } else if (typeof parsedId !== 'string' || parsedId !== exactId.toString()) return null
  return exactId.toString()
}

function isInt64Id(value: unknown): value is number | string {
  // Raw JSON validation below supplies the exact value for unsafe numbers.
  if (typeof value === 'number') return Number.isFinite(value) && Number.isInteger(value)
  if (typeof value !== 'string' || !/^-?(?:0|[1-9][0-9]*)$/.test(value)) return false
  try { const parsed = BigInt(value); return parsed >= -9_223_372_036_854_775_808n && parsed <= 9_223_372_036_854_775_807n }
  catch { return false }
}

function normalizeResolvedAttachment(value: unknown) {
  if (!isRecord(value) || (value.type !== 'image' && value.type !== 'file' && value.type !== 'video' && value.type !== 'audio') || !isRecord(value.payload)) throw new MaxProviderError()
  const payload = value.payload
  const rawId = value.type === 'image' ? payload.photo_id : value.type === 'file' ? payload.fileId : payload.id
  const id = value.type === 'file' || value.type === 'audio'
    ? normalizeFileAttachmentId(rawId)
    : normalizeProviderAttachmentId(rawId, true)
  if (!id || typeof payload.token !== 'string' || payload.token.length === 0 ||
      typeof payload.url !== 'string' || !isHttpsUrl(payload.url)) throw new MaxProviderError()
  if (value.type === 'image') return { kind: 'image' as const, providerAttachmentId: id, url: payload.url }
  if (value.type === 'video') {
    const duration = value.duration ?? payload.duration
    const width = value.width ?? payload.width
    const height = value.height ?? payload.height
    if (duration !== undefined && duration !== null && !isPositiveSafeInteger(duration)) throw new MaxProviderError()
    if (width !== undefined && width !== null && !isPositiveSafeInteger(width)) throw new MaxProviderError()
    if (height !== undefined && height !== null && !isPositiveSafeInteger(height)) throw new MaxProviderError()
    return { kind: 'video' as const, providerAttachmentId: id, currentToken: payload.token, inboundDurationSeconds: duration ?? null, width: width ?? null, height: height ?? null }
  }
  if (value.type === 'audio') return { kind: 'voice' as const, providerAttachmentId: id, url: payload.url }
  const filename = value.filename === undefined || value.filename === null ? null : value.filename
  const declaredSize = value.size === undefined || value.size === null ? null : value.size
  if (filename !== null && (typeof filename !== 'string' || filename.length === 0 || [...filename].length > 512)) throw new MaxProviderError()
  if (declaredSize !== null && (!isNonNegativeSafeInteger(declaredSize) || declaredSize === 0)) throw new MaxProviderError()
  return { kind: 'file' as const, providerAttachmentId: id, filename, declaredSize, url: payload.url }
}

function normalizeVideo(value: unknown): MaxVideoResolution {
  const root = isRecord(value) && isRecord(value.video) ? value.video : value
  const rawRenditions = isRecord(root) && Array.isArray(root.videos) ? root.videos
    : isRecord(root) && Array.isArray(root.renditions) ? root.renditions
      : isRecord(root) && Array.isArray(root.urls) ? root.urls
        : isRecord(root) && isRecord(root.urls) ? Object.entries(root.urls).flatMap(([key, item]) => {
          if (typeof item === 'string') return [{ url: item, height: inferRenditionHeight(key) }]
          return isRecord(item) ? [{ ...item, height: item.height ?? inferRenditionHeight(key) }] : []
        })
        : isRecord(root) && typeof root.url === 'string' ? [root] : []
  const renditions = rawRenditions.flatMap((item) => {
    if (!isRecord(item) || typeof item.url !== 'string') return []
    const url = parseHttpsUrl(item.url)
    if (!url) return []
    const width = item.width === undefined || item.width === null ? null : item.width
    const height = item.height === undefined || item.height === null ? null : item.height
    const contentLength = item.size === undefined || item.size === null ? null : item.size
    if ((width !== null && !isPositiveSafeInteger(width)) || (height !== null && !isPositiveSafeInteger(height)) ||
      (contentLength !== null && !isPositiveSafeInteger(contentLength))) return []
    return [{ url, width, height, contentLength }]
  })
  if (renditions.length === 0) throw new MaxProviderError()
  const width = isRecord(root) && root.width !== undefined && root.width !== null ? root.width : null
  const height = isRecord(root) && root.height !== undefined && root.height !== null ? root.height : null
  if ((width !== null && !isPositiveSafeInteger(width)) || (height !== null && !isPositiveSafeInteger(height))) throw new MaxProviderError()
  const duration = isRecord(root) ? root.duration : null
  if (duration !== null && duration !== undefined && !isPositiveSafeInteger(duration)) throw new MaxProviderError()
  const thumbnailUrl = isRecord(root) && isRecord(root.thumbnail) && typeof root.thumbnail.url === 'string'
    ? parseHttpsUrl(root.thumbnail.url)
    : null
  return { width, height, renditions, durationMs: duration ?? null, thumbnailUrl }
}

function parseHttpsUrl(value: unknown) {
  if (typeof value !== 'string') return null
  try { return new URL(value).protocol === 'https:' ? value : null } catch { return null }
}

function inferRenditionHeight(value: string) {
  const match = /(?:^|_)(\d{3,5})(?:p)?$/i.exec(value)
  if (!match) return null
  const height = Number(match[1])
  return Number.isSafeInteger(height) && height > 0 ? height : null
}

function normalizeProviderAttachmentId(value: unknown, numeric: boolean) {
  if (numeric) {
    if (typeof value === 'number' && Number.isSafeInteger(value) && value > 0) return String(value)
    if (typeof value === 'string' && /^[1-9][0-9]*$/.test(value) && value.length <= 20) return value
    return null
  }
  return typeof value === 'string' && value.length > 0 && value.length <= 512 ? value : null
}

function normalizeFileAttachmentId(value: unknown) {
  if (typeof value === 'number') return isPositiveSafeInteger(value) ? String(value) : null
  return typeof value === 'string' && value.length > 0 && value.length <= 512 ? value : null
}

function normalizeBotIdentity(value: unknown): MaxBotIdentity {
  if (!isRecord(value) || !isPositiveSafeInteger(value.user_id) ||
      typeof value.username !== 'string' || value.username.length === 0 || typeof value.is_bot !== 'boolean') {
    throw new MaxProviderError()
  }
  return { userId: value.user_id, username: value.username, isBot: value.is_bot }
}

function normalizeSubscriptions(value: unknown): MaxSubscription[] {
  if (!isRecord(value) || !Array.isArray(value.subscriptions)) throw new MaxProviderError()
  return value.subscriptions.map((item) => {
    if (!isRecord(item) || typeof item.url !== 'string' || !isHttpsUrl(item.url) ||
        !isNonNegativeSafeInteger(item.time) ||
        (item.update_types !== null && (!Array.isArray(item.update_types) ||
          item.update_types.some((type) => typeof type !== 'string')))) {
      throw new MaxProviderError()
    }
    return {
      url: item.url,
      time: item.time,
      updateTypes: item.update_types as string[] | null,
    }
  })
}

function normalizeSubscriptionResult(value: unknown): MaxSubscriptionResult {
  if (!isRecord(value) || typeof value.success !== 'boolean') throw new MaxProviderError()
  return { success: value.success }
}

function validateSubscriptionInput(input: MaxSubscriptionInput) {
  if (!isHttpsUrl(input.url) || !Array.isArray(input.updateTypes) || input.updateTypes.length === 0 ||
      input.updateTypes.some((type) => type !== 'message_created' && type !== 'bot_started' && type !== 'message_callback' &&
        type !== 'bot_added' && type !== 'bot_removed' && type !== 'bot_admin_permissions_changed') ||
      new Set(input.updateTypes).size !== input.updateTypes.length ||
      typeof input.secret !== 'string' || !/^[A-Za-z0-9_-]{5,256}$/.test(input.secret)) {
    throw new MaxProviderError()
  }
}

function validateSendMessageInput(input: MaxSendMessageInput) {
  if (typeof input.userId !== 'string' || !/^[1-9][0-9]*$/.test(input.userId) ||
      typeof input.text !== 'string' || input.text.length === 0 || [...input.text].length > 4_000) {
    throw new MaxProviderError()
  }
  if (input.buttons && (!Array.isArray(input.buttons) || input.buttons.length > 30 || input.buttons.some((button) => {
    if (typeof button.text !== 'string' || button.text.length === 0 || [...button.text].length > 80) return true
    if (button.type === 'open_app') {
      return typeof button.webApp !== 'string' || !/^[A-Za-z0-9_]{5,32}$/.test(button.webApp) ||
        (button.payload !== undefined && (typeof button.payload !== 'string' || button.payload.length > 512 || !/^[A-Za-z0-9_-]*$/.test(button.payload)))
    }
    return (button.type !== undefined && button.type !== 'callback') || typeof button.payload !== 'string' ||
      button.payload.length === 0 || button.payload.length > 512
  }))) throw new MaxProviderError()
}

function validateSendVideoMessageInput(input: MaxSendVideoMessageInput) {
  validateSendMessageInput(input)
  if (typeof input.uploadToken !== 'string' || input.uploadToken.length === 0 || input.uploadToken.length > 4_096) {
    throw new MaxProviderError()
  }
}

function validateImageUploadInput(input: MaxImageUploadInput) {
  if (!(input.bytes instanceof Uint8Array) || input.bytes.byteLength === 0 || input.bytes.byteLength > MAX_PRIVATE_PHOTO_BYTES ||
      !['image/jpeg', 'image/png', 'image/heic'].includes(input.contentType) ||
      typeof input.fileName !== 'string' || !/^[A-Za-z0-9_-]{1,120}\.(?:jpe?g|png|heic)$/.test(input.fileName)) {
    throw new MaxProviderError()
  }
}

function normalizeImageUploadUrl(value: unknown): string {
  if (!isRecord(value) || typeof value.url !== 'string') throw new MaxProviderError()
  try {
    const url = new URL(value.url)
    if (url.protocol !== 'https:' || url.hostname !== 'iu.oneme.ru' || url.port || url.username || url.password ||
        url.hash || url.pathname !== '/uploadImage') throw new MaxProviderError()
    return value.url
  } catch {
    throw new MaxProviderError()
  }
}

function normalizeImageUploadToken(value: unknown): string {
  if (!isRecord(value) || !isRecord(value.photos)) throw new MaxProviderError()
  const photos = Object.entries(value.photos)
  const photo = photos[0]
  if (photos.length !== 1 || !photo || photo[0].length === 0 || photo[0].length > 512 ||
      !isRecord(photo[1]) || typeof photo[1].token !== 'string' ||
      photo[1].token.length === 0 || photo[1].token.length > 4_096) throw new MaxProviderError()
  return photo[1].token
}

function validateSendMediaMessageInput(input: MaxSendMediaMessageInput) {
  if (typeof input.chatId !== 'string' || !/^-?[1-9][0-9]{0,18}$/.test(input.chatId) ||
      typeof input.text !== 'string' || [...input.text].length > 4_000 ||
      !Array.isArray(input.attachments) || input.attachments.length < 1 || input.attachments.length > 10 ||
      input.attachments.some((attachment) => !isRecord(attachment) ||
        (attachment.kind !== 'image' && attachment.kind !== 'video') ||
        typeof attachment.token !== 'string' || attachment.token.length === 0 || attachment.token.length > 4_096)) {
    throw new MaxProviderError()
  }
  const chatId = BigInt(input.chatId)
  if (chatId < MAX_INT64_MIN || chatId > MAX_INT64_MAX) throw new MaxProviderError()
}

function normalizeVideoUploadCapability(value: unknown): MaxVideoUploadCapability {
  if (!isRecord(value) || !isHttpsUrl(value.url) ||
      (value.token !== undefined && (typeof value.token !== 'string' || value.token.length === 0 || value.token.length > 4_096))) {
    throw new MaxProviderError()
  }
  return { url: value.url, ...(value.token === undefined ? {} : { token: value.token }) }
}

function normalizeSentVideoMessage(value: unknown) {
  if (!isRecord(value) || !isRecord(value.message)) throw new MaxProviderError()
  const rawId = value.message.mid ?? value.message.id ??
    (isRecord(value.message.body) ? value.message.body.mid : undefined)
  if (typeof rawId !== 'string' || rawId.length === 0 || rawId.length > 512) throw new MaxProviderError()
  return { messageId: rawId }
}

async function providerErrorCode(response: Response) {
  try {
    const value: unknown = await response.clone().json()
    if (!isRecord(value)) return undefined
    const raw = value.code ?? (isRecord(value.error) ? value.error.code : undefined) ?? (isRecord(value.message) ? value.message.code : undefined)
    return typeof raw === 'string' && /^[A-Za-z0-9_.:-]{1,128}$/.test(raw) ? raw : undefined
  } catch {
    return undefined
  }
}

function retryAfterSeconds(response: Response) {
  if (response.status !== 429) return undefined
  const value = response.headers.get('retry-after')
  if (!value || !/^[0-9]+(?:\.[0-9]+)?$/.test(value)) return undefined
  const seconds = Number(value)
  return Number.isFinite(seconds) && seconds > 0 && seconds <= 86_400 ? seconds : undefined
}

function isHttpsUrl(value: unknown): value is string {
  if (typeof value !== 'string') return false
  try { return new URL(value).protocol === 'https:' } catch { return false }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}


function isNonNegativeSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

function isPositiveSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
}
