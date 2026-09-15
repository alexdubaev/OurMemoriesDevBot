import { describe, expect, test } from 'bun:test'

import { createMaxPayloadCrypto } from './payload-crypto'

const key = Buffer.alloc(32, 1).toString('base64url')
const wrongKey = Buffer.alloc(32, 2).toString('base64url')

describe('MAX payload crypto', () => {
  test('round trips an encrypted normalized payload with AES-256-GCM', () => {
    const crypto = createMaxPayloadCrypto(key)
    const value = { kind: 'message_created', text: 'synthetic note', nested: [1, true] }

    const encrypted = crypto.encrypt(value)

    expect(encrypted.ciphertext).toBeInstanceOf(Uint8Array)
    expect(encrypted.iv).toHaveLength(12)
    expect(encrypted.authTag).toHaveLength(16)
    expect(crypto.decrypt<typeof value>(encrypted)).toEqual(value)
  })

  test('rejects a wrong key and an altered auth tag without exposing plaintext', () => {
    const plaintext = 'synthetic MAX plaintext that must not leak'
    const encrypted = createMaxPayloadCrypto(key).encrypt({ plaintext })

    const wrongKeyError = captureError(() => createMaxPayloadCrypto(wrongKey).decrypt(encrypted))
    expect(wrongKeyError).toBeDefined()
    expect(String(wrongKeyError)).not.toContain(plaintext)

    const alteredTag = new Uint8Array(encrypted.authTag)
    alteredTag[0] ^= 1
    const alteredTagError = captureError(() => createMaxPayloadCrypto(key).decrypt({ ...encrypted, authTag: alteredTag }))
    expect(alteredTagError).toBeDefined()
    expect(String(alteredTagError)).not.toContain(plaintext)
  })

  test('rejects keys that do not decode to exactly 32 bytes', () => {
    expect(() => createMaxPayloadCrypto('too-short')).toThrow()
  })
})

function captureError(operation: () => unknown) {
  try {
    operation()
  } catch (error) {
    return error
  }
  return undefined
}
