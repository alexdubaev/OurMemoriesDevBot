import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes } from 'node:crypto'
import type { TelegramLinkTokens } from '../application/ports'

const context = Buffer.from('memoly:telegram-identity-link:v1')

// Dedicated authenticated encryption: no user/session identifiers or signing material in URLs.
// 12-byte random nonce + 24-byte payload + 16-byte authentication tag = 70 base64url chars.
export function createTelegramLinkTokens(secret: string): TelegramLinkTokens {
  const key = createHmac('sha256', secret).update(context).digest()
  return {
    create(sourceSessionId, issuedAt) {
      const payload = Buffer.alloc(24)
      Buffer.from(sourceSessionId.replaceAll('-', ''), 'hex').copy(payload, 0)
      payload.writeBigUInt64BE(BigInt(issuedAt.getTime()), 16)
      const nonce = randomBytes(12)
      const cipher = createCipheriv('aes-256-gcm', key, nonce)
      cipher.setAAD(context)
      const ciphertext = Buffer.concat([cipher.update(payload), cipher.final()])
      return Buffer.concat([nonce, ciphertext, cipher.getAuthTag()]).toString('base64url')
    },
    verify(token) {
      if (!/^[A-Za-z0-9_-]{70}$/.test(token)) throw new Error('Invalid Telegram link')
      const bytes = Buffer.from(token, 'base64url')
      if (bytes.toString('base64url') !== token || bytes.length !== 52) throw new Error('Invalid Telegram link')
      const decipher = createDecipheriv('aes-256-gcm', key, bytes.subarray(0, 12))
      decipher.setAAD(context)
      decipher.setAuthTag(bytes.subarray(36))
      const payload = Buffer.concat([decipher.update(bytes.subarray(12, 36)), decipher.final()])
      const hex = payload.subarray(0, 16).toString('hex')
      const sourceSessionId = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
      const issuedAt = Number(payload.readBigUInt64BE(16))
      if (!Number.isSafeInteger(issuedAt)) throw new Error('Invalid Telegram link')
      return { sourceSessionId, issuedAt, tokenHash: createHash('sha256').update(token).digest('hex') }
    },
  }
}
