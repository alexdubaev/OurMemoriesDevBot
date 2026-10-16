import { sessionExpiresAt, type SessionMetadata } from '../domain/session'
import { AuthFailure } from '../domain/errors'
import { maxAuthDataMaxAgeSeconds, maxAuthReplayBoundaryPaddingSeconds } from './max-auth-policy'
import type {
  AccessTokens,
  Clock,
  MaxAuthRepository,
  ProjectUser,
  RefreshTokens,
  VerifiedMaxInitData,
} from './ports'

type MaxAuthServiceDependencies = {
  accessTokens: AccessTokens
  clock: Clock
  projectUser: ProjectUser
  refreshReuseGraceSeconds: number
  refreshTokenTtlDays: number
  sessionAbsoluteTtlDays: number
  refreshTokens: RefreshTokens
  repository: MaxAuthRepository
  verifyInitData(rawInitData: string): VerifiedMaxInitData
}

export class MaxAuthService {
  constructor(private readonly dependencies: MaxAuthServiceDependencies) {}

  verifyInitData(rawInitData: string): VerifiedMaxInitData {
    try {
      return this.dependencies.verifyInitData(rawInitData)
    } catch {
      throw new AuthFailure('max_init_data_invalid', 'MAX authorization data is invalid or expired')
    }
  }

  async exchange(
    rawInitData: string,
    presentedRefreshToken: string | undefined,
    metadata: SessionMetadata,
  ) {
    let verified: VerifiedMaxInitData
    verified = this.verifyInitData(rawInitData)

    const now = this.dependencies.clock.now()
    const predecessor = presentedRefreshToken
      ? {
          refreshTokenHash: this.dependencies.refreshTokens.hash(presentedRefreshToken),
          refreshTokenFamilyHash: this.dependencies.refreshTokens.familyHash(presentedRefreshToken),
          now,
          createdAfter: new Date(
            now.getTime() - this.dependencies.sessionAbsoluteTtlDays * 24 * 60 * 60 * 1000,
          ),
          reuseGraceAfter: new Date(
            now.getTime() - this.dependencies.refreshReuseGraceSeconds * 1000,
          ),
        }
      : undefined
    const refreshToken = this.dependencies.refreshTokens.create()
    const exchanged = await this.dependencies.repository.exchangeMaxIdentity({
      identity: verified.identity,
      fingerprintHash: verified.replayFingerprintHash,
      replayExpiresAt: new Date(
        (verified.authDateSeconds + maxAuthDataMaxAgeSeconds + maxAuthReplayBoundaryPaddingSeconds) * 1000,
      ),
      predecessor,
      now,
      session: {
        refreshTokenHash: this.dependencies.refreshTokens.hash(refreshToken),
        refreshTokenFamilyHash: this.dependencies.refreshTokens.familyHash(refreshToken),
        expiresAt: sessionExpiresAt(now, this.dependencies.refreshTokenTtlDays),
        metadata,
      },
    })

    if (exchanged.state === 'replayed') {
      throw new AuthFailure(
        'max_init_data_replayed',
        'MAX authorization data was already used; reopen the Mini App',
      )
    }

    if (exchanged.state === 'invalid_session') {
      throw new AuthFailure('refresh_session_invalid', 'Browser session is no longer valid')
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

}
