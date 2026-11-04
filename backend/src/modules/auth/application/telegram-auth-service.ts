import { sessionExpiresAt, type SessionMetadata } from '../domain/session'
import { AuthFailure } from '../domain/errors'
import { hashTelegramLinkToken } from './telegram-link-service'
import type {
  AccessTokens,
  Clock,
  ProjectUser,
  RefreshTokens,
  TelegramAuthRepository,
  VerifiedTelegramInitData,
} from './ports'

type TelegramAuthServiceDependencies = {
  accessTokens: AccessTokens
  clock: Clock
  projectUser: ProjectUser
  refreshReuseGraceSeconds: number
  refreshTokenTtlDays: number
  sessionAbsoluteTtlDays: number
  refreshTokens: RefreshTokens
  repository: TelegramAuthRepository
  verifyInitData(rawInitData: string): VerifiedTelegramInitData
}

export class TelegramAuthService {
  constructor(private readonly dependencies: TelegramAuthServiceDependencies) {}

  async exchange(
    rawInitData: string,
    presentedRefreshToken: string | undefined,
    metadata: SessionMetadata,
  ) {
    let verified: VerifiedTelegramInitData
    try {
      verified = this.dependencies.verifyInitData(rawInitData)
    } catch {
      throw new AuthFailure('telegram_init_data_invalid', 'Telegram authorization data is invalid or expired')
    }

    const now = this.dependencies.clock.now()
    const isLink = verified.startParam?.startsWith('link_') ?? false
    const linkToken = isLink ? verified.startParam!.match(/^link_([A-Za-z0-9_-]{43})$/)?.[1] : undefined
    if (isLink && !linkToken) throw new AuthFailure('telegram_link_invalid', 'Invalid link payload')
    const existingSessionId = await this.currentSessionId(presentedRefreshToken, now)
    const refreshToken = this.dependencies.refreshTokens.create()
    const exchanged = await this.dependencies.repository.exchangeTelegramIdentity({
      identity: verified.identity,
      fingerprintHash: verified.replayFingerprintHash,
      replayExpiresAt: new Date(now.getTime() + 5 * 60 * 1000),
      existingSessionId,
      link: linkToken ? {
        tokenHash: hashTelegramLinkToken(linkToken),
        authDateSeconds: verified.authDateSeconds,
        sourceAbsoluteTtlMs: this.dependencies.sessionAbsoluteTtlDays * 86400_000,
      } : undefined,
      now,
      session: {
        refreshTokenHash: this.dependencies.refreshTokens.hash(refreshToken),
        refreshTokenFamilyHash: this.dependencies.refreshTokens.familyHash(refreshToken),
        expiresAt: sessionExpiresAt(now, this.dependencies.refreshTokenTtlDays),
        metadata,
      },
    })

    if (exchanged.state === 'link_invalid' || exchanged.state === 'link_conflict') {
      throw new AuthFailure(exchanged.state === 'link_invalid' ? 'telegram_link_invalid' : 'telegram_link_conflict', 'Telegram link rejected')
    }
    if (exchanged.state === 'replayed') {
      throw new AuthFailure(
        'telegram_init_data_replayed',
        'Telegram authorization data was already used; reopen the Mini App',
      )
    }

    if (exchanged.state === 'invalid_account') {
      throw new AuthFailure('session_invalid', 'Session is invalid or expired')
    }

    return {
      user: await this.dependencies.projectUser(exchanged.user),
      accessToken: await this.dependencies.accessTokens.sign({
        sub: exchanged.user.id,
        sessionId: exchanged.session.id,
      }),
      refreshTokenToSet: exchanged.state === 'issued' ? refreshToken : undefined,
    }
  }

  private async currentSessionId(refreshToken: string | undefined, now: Date) {
    if (!refreshToken) return undefined

    const session = await this.dependencies.repository.findActiveRefreshSession({
      refreshTokenHash: this.dependencies.refreshTokens.hash(refreshToken),
      refreshTokenFamilyHash: this.dependencies.refreshTokens.familyHash(refreshToken),
      now,
      createdAfter: new Date(
        now.getTime() - this.dependencies.sessionAbsoluteTtlDays * 24 * 60 * 60 * 1000,
      ),
      reuseGraceAfter: new Date(
        now.getTime() - this.dependencies.refreshReuseGraceSeconds * 1000,
      ),
    })
    return session?.credentialState === 'current' ? session.id : undefined
  }
}
