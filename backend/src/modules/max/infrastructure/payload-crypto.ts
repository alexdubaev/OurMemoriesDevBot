import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'

export type EncryptedMaxPayload = {
  ciphertext: Uint8Array
  iv: Uint8Array
  authTag: Uint8Array
}

export function createMaxPayloadCrypto(encodedKey: string): {
  encrypt(value: unknown): EncryptedMaxPayload
  decrypt<T>(payload: EncryptedMaxPayload): T
} {
  const key = decodeKey(encodedKey)

  return {
    encrypt(value) {
      const iv = randomBytes(12)
      const cipher = createCipheriv('aes-256-gcm', key, iv)
      const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()])
      return { ciphertext, iv, authTag: cipher.getAuthTag() }
    },
    decrypt<T>(payload: EncryptedMaxPayload) {
      try {
        const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(payload.iv))
        decipher.setAuthTag(Buffer.from(payload.authTag))
        const plaintext = Buffer.concat([
          decipher.update(Buffer.from(payload.ciphertext)),
          decipher.final(),
        ]).toString('utf8')
        return JSON.parse(plaintext) as T
      } catch {
        throw new Error('MAX payload decryption failed')
      }
    },
  }
}

function decodeKey(encodedKey: string) {
  if (!/^[A-Za-z0-9_-]+$/.test(encodedKey)) throw new Error('MAX inbox encryption key must be base64url')
  const key = Buffer.from(encodedKey, 'base64url')
  if (key.byteLength !== 32) throw new Error('MAX inbox encryption key must decode to 32 bytes')
  return key
}
