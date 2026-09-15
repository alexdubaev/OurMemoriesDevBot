import { createHmac } from 'node:crypto'
import { describe, expect, test } from 'bun:test'

import { MaxInitDataError, verifyMaxInitData } from './max-init-data'

const botToken = '987654:max-test-token'
const now = new Date('2026-09-09T12:00:00.000Z')
const validInitData =
  'auth_date=1788955200&query_id=AAHdF6IQAAAAAN0XohDhrOrc&user=%7B%22id%22%3A31415926%2C%22first_name%22%3A%22Max%22%2C%22last_name%22%3A%22User%22%7D&hash=5709fa6626f5077acda14b0042c7296733fb4c746bbf6d51f00f895960316e00'

describe('MAX Mini App initData verification', () => {
  test('verifies the literal golden fixture and exposes only the canonical identity', () => {
    expect(verifyMaxInitData(validInitData, { botToken, now })).toEqual({
      identity: {
        provider: 'max',
        subject: '31415926',
        displayName: 'Max User',
      },
      replayFingerprintHash: 'b29271a7f830c6ceb01fb036a9d5d89076066898cd146625ba660f26d87558ad',
      authDateSeconds: 1788955200,
    })
  })

  test('keeps the verified hash as the replay boundary when parameters are reordered', () => {
    const reordered = new URLSearchParams([...new URLSearchParams(validInitData).entries()].reverse())
      .toString()

    expect(verifyMaxInitData(reordered, { botToken, now }).replayFingerprintHash).toBe(
      'b29271a7f830c6ceb01fb036a9d5d89076066898cd146625ba660f26d87558ad',
    )
  })

  test('rejects forged, tampered, malformed, duplicate, and incomplete signed data', () => {
    expect(() => verifyMaxInitData(validInitData.replace('Max', 'Mqx'), { botToken, now })).toThrow(
      new MaxInitDataError('invalid_signature'),
    )
    expect(() => verifyMaxInitData(validInitData.replace(/hash=[0-9a-f]+/, 'hash=not-a-hash'), { botToken, now })).toThrow(
      new MaxInitDataError('invalid_signature'),
    )
    expect(() => verifyMaxInitData(`${validInitData}&auth_date=1788955200`, { botToken, now })).toThrow(
      new MaxInitDataError('duplicate_field'),
    )
    expect(() => verifyMaxInitData(validInitData.replace(/&user=.*?&hash=/, '&hash='), { botToken, now })).toThrow(
      new MaxInitDataError('missing_field'),
    )
    expect(() => verifyMaxInitData(validInitData.replace(/auth_date=[^&]+/, 'auth_date='), { botToken, now })).toThrow(
      new MaxInitDataError('missing_field'),
    )
  })

  test('rejects invalid MAX users only after a valid signature', () => {
    for (const user of [
      {},
      { id: 0, first_name: 'Max' },
      { id: -1, first_name: 'Max' },
      { id: Number.MAX_SAFE_INTEGER + 1, first_name: 'Max' },
      { id: 31415926, first_name: '' },
      { id: 31415926, first_name: '   ' },
    ]) {
      expect(() => verifyMaxInitData(signed({ user }), { botToken, now })).toThrow(
        new MaxInitDataError('invalid_user'),
      )
    }
  })

  test('rejects stale and future auth timestamps', () => {
    expect(() => verifyMaxInitData(signed({ auth_date: '1788954899' }), { botToken, now })).toThrow(
      new MaxInitDataError('expired'),
    )
    expect(() => verifyMaxInitData(signed({ auth_date: '1788955231' }), { botToken, now })).toThrow(
      new MaxInitDataError('future'),
    )
  })

  test('rejects duplicate required fields before signature work', () => {
    expect(() => verifyMaxInitData(`${validInitData}&hash=`, { botToken, now })).toThrow(
      new MaxInitDataError('duplicate_field'),
    )
  })
})

function signed(overrides: { auth_date?: string; user?: unknown } = {}) {
  const fields = new Map([
    ['auth_date', overrides.auth_date ?? '1788955200'],
    ['query_id', 'AAHdF6IQAAAAAN0XohDhrOrc'],
    ['user', JSON.stringify(overrides.user ?? { id: 31415926, first_name: 'Max' })],
  ])
  const launchParams = [...fields]
    .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
    .map(([key, value]) => `${key}=${value}`)
    .join('\n')
  const secretKey = createHmac('sha256', 'WebAppData').update(botToken).digest()
  fields.set('hash', createHmac('sha256', secretKey).update(launchParams).digest('hex'))
  return new URLSearchParams([...fields]).toString()
}
