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
} from '../application/ports'

const MAX_API_BASE = 'https://platform-api2.max.ru'
const REQUEST_TIMEOUT_MS = 10_000

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
  const request = async (path: string, init: RequestInit, callerSignal?: AbortSignal): Promise<unknown> => {
    const controller = new AbortController()
    const onCallerAbort = () => controller.abort()
    callerSignal?.addEventListener('abort', onCallerAbort, { once: true })
    if (callerSignal?.aborted) controller.abort()
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
    try {
      const response = await (options.fetch ?? fetch)(`${MAX_API_BASE}${path}`, {
        ...init,
        headers: { ...(init.headers ?? {}), Authorization: token },
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
        return await response.json()
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
        body: JSON.stringify({ text: input.text }),
      }, signal)
      if (!isRecord(value) || !isRecord(value.message)) throw new MaxProviderError()
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
    async getMessage(messageId, signal) {
      if (typeof messageId !== 'string' || messageId.length === 0 || messageId.length > 512) throw new MaxProviderError()
      return normalizeMessageLookup(await request(`/messages?${new URLSearchParams({ message_ids: messageId }).toString()}`, { method: 'GET' }, signal), messageId)
    },
    async getVideo(videoToken, signal) {
      if (typeof videoToken !== 'string' || videoToken.length === 0 || videoToken.length > 4_096) throw new MaxProviderError()
      return normalizeVideo(await request(`/videos/${encodeURIComponent(videoToken)}`, { method: 'GET' }, signal))
    },
  }
}

function normalizeMessageLookup(value: unknown, expectedMessageId: string): MaxResolvedMessage {
  const candidate = isRecord(value) && Array.isArray(value.messages) ? value.messages[0] :
    isRecord(value) && isRecord(value.message) ? value.message : value
  if (!isRecord(candidate) || !isRecord(candidate.sender) || !isRecord(candidate.recipient) || !isRecord(candidate.body) ||
      !isPositiveSafeInteger(candidate.sender.user_id) || !isPositiveSafeInteger(candidate.recipient.user_id) ||
      (candidate.recipient.chat_id !== null && !isPositiveSafeInteger(candidate.recipient.chat_id)) || candidate.recipient.chat_type !== 'dialog' ||
      typeof candidate.body.mid !== 'string' || candidate.body.mid !== expectedMessageId ||
      !Array.isArray(candidate.body.attachments)) throw new MaxProviderError()
  const attachments = candidate.body.attachments.map(normalizeResolvedAttachment)
  return { messageId: expectedMessageId, senderId: String(candidate.sender.user_id), recipientId: String(candidate.recipient.user_id), attachments }
}

function normalizeResolvedAttachment(value: unknown) {
  if (!isRecord(value) || (value.type !== 'image' && value.type !== 'file' && value.type !== 'video') || !isRecord(value.payload)) throw new MaxProviderError()
  const payload = value.payload
  const rawId = value.type === 'image' ? payload.photo_id : value.type === 'video' ? payload.id : payload.fileId
  const id = value.type === 'file'
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
  return { width, height, renditions, durationMs: duration ?? null }
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
      input.updateTypes.some((type) => type !== 'message_created' && type !== 'bot_started') ||
      new Set(input.updateTypes).size !== input.updateTypes.length ||
      typeof input.secret !== 'string' || !/^[A-Za-z0-9_-]{5,256}$/.test(input.secret)) {
    throw new MaxProviderError()
  }
}

function validateSendMessageInput(input: { userId: string; text: string }) {
  if (typeof input.userId !== 'string' || !/^[1-9][0-9]*$/.test(input.userId) ||
      typeof input.text !== 'string' || input.text.length === 0 || [...input.text].length > 4_000) {
    throw new MaxProviderError()
  }
}

function validateSendVideoMessageInput(input: MaxSendVideoMessageInput) {
  validateSendMessageInput(input)
  if (typeof input.uploadToken !== 'string' || input.uploadToken.length === 0 || input.uploadToken.length > 4_096) {
    throw new MaxProviderError()
  }
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
  const rawId = value.message.mid ?? value.message.id
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
