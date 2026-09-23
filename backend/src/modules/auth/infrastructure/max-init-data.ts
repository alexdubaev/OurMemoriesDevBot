import { createHash, createHmac, timingSafeEqual } from 'node:crypto'

import type { MaxIdentity, VerifiedMaxInitData } from '../application/ports'
import {
  maxAuthDataFutureToleranceSeconds,
  maxAuthDataMaxAgeSeconds,
} from '../application/max-auth-policy'

export type MaxInitDataFailure =
  | 'duplicate_field'
  | 'expired'
  | 'future'
  | 'invalid_signature'
  | 'invalid_user'
  | 'missing_field'

export class MaxInitDataError extends Error {
  constructor(readonly reason: MaxInitDataFailure) {
    super(`MAX initData rejected: ${reason}`)
    this.name = 'MaxInitDataError'
  }
}

type VerifyMaxInitDataOptions = {
  botToken: string
  now: Date
  maxAgeSeconds?: number
  futureToleranceSeconds?: number
}

export function verifyMaxInitData(
  rawInitData: string,
  {
    botToken,
    now,
    maxAgeSeconds = maxAuthDataMaxAgeSeconds,
    futureToleranceSeconds = maxAuthDataFutureToleranceSeconds,
  }: VerifyMaxInitDataOptions,
): VerifiedMaxInitData {
  const fields = parseUniqueFields(rawInitData)
  const suppliedHash = fields.get('hash')
  const authDateRaw = fields.get('auth_date')
  const userRaw = fields.get('user')
  if (!suppliedHash || !authDateRaw || !userRaw) {
    throw new MaxInitDataError('missing_field')
  }

  const launchParams = [...fields]
    .filter(([key]) => key !== 'hash')
    .sort(([left], [right]) => Buffer.from(left).compare(Buffer.from(right)))
    .map(([key, value]) => `${key}=${value}`)
    .join('\n')
  const secretKey = createHmac('sha256', 'WebAppData').update(botToken).digest()
  const expectedHash = createHmac('sha256', secretKey).update(launchParams).digest('hex')
  if (!constantTimeHexEqual(suppliedHash, expectedHash)) {
    throw new MaxInitDataError('invalid_signature')
  }

  const authDate = Number(authDateRaw)
  if (!Number.isSafeInteger(authDate)) throw new MaxInitDataError('expired')
  const nowSeconds = Math.floor(now.getTime() / 1000)
  if (authDate > nowSeconds + futureToleranceSeconds) throw new MaxInitDataError('future')
  if (authDate < nowSeconds - maxAgeSeconds) throw new MaxInitDataError('expired')

  return {
    identity: parseMaxUser(userRaw),
    replayFingerprintHash: createHash('sha256').update(suppliedHash.toLowerCase()).digest('hex'),
    authDateSeconds: authDate,
    ...(fields.get('start_param') ? { startParam: fields.get('start_param') } : {}),
  }
}

function parseUniqueFields(rawInitData: string) {
  const fields = new Map<string, string>()
  for (const [key, value] of new URLSearchParams(rawInitData)) {
    if (fields.has(key)) throw new MaxInitDataError('duplicate_field')
    fields.set(key, value)
  }
  return fields
}

function constantTimeHexEqual(supplied: string, expected: string) {
  if (!/^[0-9a-f]{64}$/i.test(supplied)) return false
  const suppliedBytes = Buffer.from(supplied, 'hex')
  const expectedBytes = Buffer.from(expected, 'hex')
  return suppliedBytes.length === expectedBytes.length && timingSafeEqual(suppliedBytes, expectedBytes)
}

function parseMaxUser(rawUser: string): MaxIdentity {
  let user: unknown
  try {
    user = JSON.parse(rawUser)
  } catch {
    throw new MaxInitDataError('invalid_user')
  }
  if (!isRecord(user)) throw new MaxInitDataError('invalid_user')
  if (!Number.isSafeInteger(user.id) || Number(user.id) <= 0) {
    throw new MaxInitDataError('invalid_user')
  }
  if (typeof user.first_name !== 'string' || user.first_name.trim().length === 0) {
    throw new MaxInitDataError('invalid_user')
  }
  const lastName = typeof user.last_name === 'string' ? user.last_name.trim() : ''
  return {
    provider: 'max',
    subject: String(user.id),
    displayName: [user.first_name.trim(), lastName].filter(Boolean).join(' '),
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
