import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'

import type { EncryptedTelegramPayload } from '../application/ports'

export function createTelegramPayloadCrypto(encodedKey: string) {
  const key = Buffer.from(encodedKey, 'base64url')
  if (key.byteLength !== 32) throw new Error('Telegram inbox encryption key must contain 32 bytes')

  return {
    encrypt(value: unknown): EncryptedTelegramPayload {
      const iv = randomBytes(12)
      const cipher = createCipheriv('aes-256-gcm', key, iv)
      const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()])
      return { ciphertext, iv, authTag: cipher.getAuthTag() }
    },
    decrypt<T>(payload: EncryptedTelegramPayload): T {
      const decipher = createDecipheriv('aes-256-gcm', key, payload.iv)
      decipher.setAuthTag(payload.authTag)
      const plaintext = Buffer.concat([decipher.update(payload.ciphertext), decipher.final()])
      return JSON.parse(plaintext.toString('utf8')) as T
    },
  }
}
