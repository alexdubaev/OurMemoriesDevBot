import type { AuthenticatedPrincipal } from '../domain/user'
import { AuthFailure } from '../domain/errors'
import type { TelegramLinkRepository, TelegramLinkTokens } from './ports'

export class TelegramLinkService {
  constructor(private readonly dependencies: {
    repository: TelegramLinkRepository
    tokens: TelegramLinkTokens
    sessionAbsoluteTtlDays: number
    configured: boolean
  }) {}

  async status(principal: AuthenticatedPrincipal) {
    this.assertMax(principal)
    return { connected: await this.dependencies.repository.isConnected(principal.id) }
  }

  async start(principal: AuthenticatedPrincipal) {
    this.assertMax(principal)
    const result = await this.dependencies.repository.start({
      userId: principal.id,
      sessionId: principal.sessionId,
      identityId: principal.externalIdentity!.id,
      absoluteTtlMs: this.dependencies.sessionAbsoluteTtlDays * 86400_000,
    })
    if (!result) throw new AuthFailure('session_invalid', 'MAX session is invalid or expired')
    return result.connected ? result : {
      connected: false as const,
      startParam: `link_${this.dependencies.tokens.create(principal.sessionId, result.issuedAt)}`,
      expiresAt: new Date(result.issuedAt.getTime() + 15_000).toISOString(),
    }
  }

  private assertMax(principal: AuthenticatedPrincipal) {
    if (!this.dependencies.configured || principal.externalIdentity?.provider !== 'max') {
      throw new AuthFailure('session_invalid', 'An authenticated MAX session is required')
    }
  }
}
