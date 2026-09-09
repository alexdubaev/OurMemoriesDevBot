import { createHash, createHmac, timingSafeEqual } from 'node:crypto'

import type { TelegramIdentity, VerifiedTelegramInitData } from '../application/ports'

export type TelegramInitDataFailure =
  | 'duplicate_field'
  | 'expired'
  | 'future'
  | 'invalid_signature'
  | 'invalid_user'
  | 'missing_field'

export class TelegramInitDataError extends Error {
  constructor(readonly reason: TelegramInitDataFailure) {
    super(`Telegram initData rejected: ${reason}`)
    this.name = 'TelegramInitDataError'
  }
}

type VerifyTelegramInitDataOptions = {
  botToken: string
  now: Date
  maxAgeSeconds?: number
  futureToleranceSeconds?: number
}

export function verifyTelegramInitData(
  rawInitData: string,
  {
    botToken,
    now,
    maxAgeSeconds = 300,
    futureToleranceSeconds = 30,
  }: VerifyTelegramInitDataOptions,
): VerifiedTelegramInitData {
  const fields = parseUniqueFields(rawInitData)
  const suppliedHash = fields.get('hash')
  const authDateRaw = fields.get('auth_date')
  const userRaw = fields.get('user')
  if (!suppliedHash || !authDateRaw || !userRaw) {
    throw new TelegramInitDataError('missing_field')
  }

  const expectedHash = telegramHash(fields, botToken)
  if (!constantTimeHexEqual(suppliedHash, expectedHash)) {
    throw new TelegramInitDataError('invalid_signature')
  }

  const authDate = Number(authDateRaw)
  if (!Number.isSafeInteger(authDate)) throw new TelegramInitDataError('expired')
  const nowSeconds = Math.floor(now.getTime() / 1000)
  if (authDate > nowSeconds + futureToleranceSeconds) throw new TelegramInitDataError('future')
  if (authDate < nowSeconds - maxAgeSeconds) throw new TelegramInitDataError('expired')

  return {
    identity: parseTelegramUser(userRaw),
    // Telegram's HMAC is stable for the signed field set even if the query parameters are
    // reordered or percent-encoded differently. Hash it once more so the replay table stores
    // neither raw initData nor a directly reusable Telegram signature.
    replayFingerprintHash: createHash('sha256').update(suppliedHash.toLowerCase()).digest('hex'),
  }
}

function parseUniqueFields(rawInitData: string) {
  const fields = new Map<string, string>()
  for (const [key, value] of new URLSearchParams(rawInitData)) {
    if (fields.has(key)) throw new TelegramInitDataError('duplicate_field')
    fields.set(key, value)
  }
  return fields
}

function telegramHash(fields: Map<string, string>, botToken: string) {
  const dataCheckString = [...fields]
    .filter(([key]) => key !== 'hash')
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([key, value]) => `${key}=${value}`)
    .join('\n')
  const secretKey = createHmac('sha256', 'WebAppData').update(botToken).digest()
  return createHmac('sha256', secretKey).update(dataCheckString).digest('hex')
}

function constantTimeHexEqual(supplied: string, expected: string) {
  if (!/^[0-9a-f]{64}$/i.test(supplied)) return false
  const suppliedBytes = Buffer.from(supplied, 'hex')
  const expectedBytes = Buffer.from(expected, 'hex')
  return suppliedBytes.length === expectedBytes.length && timingSafeEqual(suppliedBytes, expectedBytes)
}

function parseTelegramUser(rawUser: string): TelegramIdentity {
  let user: unknown
  try {
    user = JSON.parse(rawUser)
  } catch {
    throw new TelegramInitDataError('invalid_user')
  }
  if (!isRecord(user)) throw new TelegramInitDataError('invalid_user')
  if (!Number.isSafeInteger(user.id) || Number(user.id) <= 0) {
    throw new TelegramInitDataError('invalid_user')
  }
  if (typeof user.first_name !== 'string' || user.first_name.trim().length === 0) {
    throw new TelegramInitDataError('invalid_user')
  }
  const lastName = typeof user.last_name === 'string' ? user.last_name.trim() : ''
  const displayName = [user.first_name.trim(), lastName].filter(Boolean).join(' ')
  return {
    provider: 'telegram',
    subject: String(user.id),
    displayName,
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
