import { createHash, randomBytes } from 'node:crypto'
import type { AuthenticatedPrincipal } from '../domain/user'
import { AuthFailure } from '../domain/errors'
import type { TelegramLinkRepository } from './ports'

export function hashTelegramLinkToken(token: string) {
  return createHash('sha256').update(token).digest('hex')
}

export class TelegramLinkService {
  constructor(private readonly dependencies: {
    repository: TelegramLinkRepository
    sessionAbsoluteTtlDays: number
    configured: boolean
  }) {}

  async status(principal: AuthenticatedPrincipal) {
    this.assertMax(principal)
    return { connected: await this.dependencies.repository.isConnected(principal.id) }
  }

  async start(principal: AuthenticatedPrincipal) {
    this.assertMax(principal)
    const token = randomBytes(32).toString('base64url')
    const result = await this.dependencies.repository.start({
      userId: principal.id,
      sessionId: principal.sessionId,
      identityId: principal.externalIdentity!.id,
      tokenHash: hashTelegramLinkToken(token),
      absoluteTtlMs: this.dependencies.sessionAbsoluteTtlDays * 86400_000,
    })
    if (!result) throw new AuthFailure('session_invalid', 'MAX session is invalid or expired')
    return result.connected ? result : {
      connected: false as const,
      startParam: `link_${token}`,
      expiresAt: result.expiresAt.toISOString(),
    }
  }

  private assertMax(principal: AuthenticatedPrincipal) {
    if (!this.dependencies.configured || principal.externalIdentity?.provider !== 'max') {
      throw new AuthFailure('session_invalid', 'An authenticated MAX session is required')
    }
  }
}
