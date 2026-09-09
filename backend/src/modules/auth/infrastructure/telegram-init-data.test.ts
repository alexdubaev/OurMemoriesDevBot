import { createHmac } from 'node:crypto'
import { describe, expect, test } from 'bun:test'

import { TelegramInitDataError, verifyTelegramInitData } from './telegram-init-data'

const botToken = '123456:telegram-test-token'
const now = new Date('2026-09-09T12:00:00.000Z')

function signedInitData(overrides: Record<string, string> = {}) {
  const fields = new Map<string, string>([
    ['auth_date', String(Math.floor(now.getTime() / 1000))],
    ['query_id', 'AAHdF6IQAAAAAN0XohDhrOrc'],
    ['user', JSON.stringify({ id: 99281912, first_name: 'Алекс', last_name: 'Тестов' })],
  ])
  for (const [key, value] of Object.entries(overrides)) fields.set(key, value)
  const dataCheckString = [...fields]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${value}`)
    .join('\n')
  const secretKey = createHmac('sha256', 'WebAppData').update(botToken).digest()
  const hash = createHmac('sha256', secretKey).update(dataCheckString).digest('hex')
  const params = new URLSearchParams([...fields])
  params.set('hash', hash)
  return params.toString()
}

describe('Telegram Mini App initData verification', () => {
  test('returns only the canonical Telegram subject and safe profile fields', () => {
    expect(verifyTelegramInitData(signedInitData(), { botToken, now })).toEqual({
      identity: {
        provider: 'telegram',
        subject: '99281912',
        displayName: 'Алекс Тестов',
      },
      replayFingerprintHash: expect.stringMatching(/^[0-9a-f]{64}$/),
    })
  })

  test('uses the verified signature as a canonical replay boundary', () => {
    const original = signedInitData()
    const reordered = new URLSearchParams(
      [...new URLSearchParams(original).entries()].reverse(),
    ).toString()

    expect(verifyTelegramInitData(reordered, { botToken, now }).replayFingerprintHash).toBe(
      verifyTelegramInitData(original, { botToken, now }).replayFingerprintHash,
    )
  })

  test('includes the Telegram signature field in bot-token HMAC validation', () => {
    const raw = signedInitData({ signature: 'third-party-ed25519-signature' })

    expect(verifyTelegramInitData(raw, { botToken, now }).identity.subject).toBe('99281912')
  })

  test('rejects a signature field changed after Telegram formed the hash', () => {
    const params = new URLSearchParams(signedInitData({ signature: 'original-signature' }))
    params.set('signature', 'tampered-signature')

    expect(() => verifyTelegramInitData(params.toString(), { botToken, now })).toThrow(
      new TelegramInitDataError('invalid_signature'),
    )
  })

  test('rejects a forged signature', () => {
    const raw = signedInitData().replace('first_name', 'first_namf')
    expect(() => verifyTelegramInitData(raw, { botToken, now })).toThrow(
      new TelegramInitDataError('invalid_signature'),
    )
  })

  test('rejects duplicate fields before signature verification', () => {
    const raw = `${signedInitData()}&auth_date=${Math.floor(now.getTime() / 1000)}`
    expect(() => verifyTelegramInitData(raw, { botToken, now })).toThrow(
      new TelegramInitDataError('duplicate_field'),
    )
  })

  test('rejects expired and future auth timestamps', () => {
    const expired = signedInitData({ auth_date: String(Math.floor(now.getTime() / 1000) - 301) })
    const future = signedInitData({ auth_date: String(Math.floor(now.getTime() / 1000) + 31) })

    expect(() => verifyTelegramInitData(expired, { botToken, now })).toThrow(
      new TelegramInitDataError('expired'),
    )
    expect(() => verifyTelegramInitData(future, { botToken, now })).toThrow(
      new TelegramInitDataError('future'),
    )
  })

  test('rejects missing or malformed Telegram users', () => {
    expect(() => verifyTelegramInitData(signedInitData({ user: '{}' }), { botToken, now })).toThrow(
      new TelegramInitDataError('invalid_user'),
    )
    expect(() =>
      verifyTelegramInitData(signedInitData({ user: '{not-json' }), { botToken, now }),
    ).toThrow(new TelegramInitDataError('invalid_user'))
  })
})
