import type {
  MaxApiPort,
  MaxBotIdentity,
  MaxSubscription,
  MaxSubscriptionInput,
  MaxSubscriptionResult,
} from '../application/ports'

const MAX_API_BASE = 'https://platform-api2.max.ru'
const REQUEST_TIMEOUT_MS = 10_000

export class MaxProviderError extends Error {
  constructor() {
    super('MAX provider request failed')
    this.name = 'MaxProviderError'
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
      if (!response.ok) throw new MaxProviderError()
      try {
        return await response.json()
      } catch {
        throw new MaxProviderError()
      }
    } catch (error) {
      if (error instanceof MaxProviderError) throw error
      throw new MaxProviderError()
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
  }
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

function isHttpsUrl(value: unknown): value is string {
  if (typeof value !== 'string') return false
  try { return new URL(value).protocol === 'https:' } catch { return false }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isPositiveSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
}

function isNonNegativeSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}
