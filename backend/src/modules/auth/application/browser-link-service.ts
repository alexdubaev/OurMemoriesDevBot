import { createHash, randomBytes } from 'node:crypto'

import type { BrowserLinkStartResponse } from '@web-app-demo/contracts'

import { AuthFailure } from '../domain/errors'
import { sessionExpiresAt, type SessionMetadata } from '../domain/session'
import type { AuthenticatedPrincipal } from '../domain/user'
import type {
  AccessTokens,
  BrowserLinkRepository,
  Clock,
  ProjectUser,
  RefreshTokens,
  VerifiedMaxInitData,
} from './ports'

const browserLinkTtlSeconds = 5 * 60

type BrowserLinkServiceDependencies = {
  accessTokens: AccessTokens
  clock: Clock
  projectUser: ProjectUser
  refreshTokenTtlDays: number
  refreshTokens: RefreshTokens
  repository: BrowserLinkRepository
  verifyInitData(rawInitData: string): VerifiedMaxInitData
}

export class BrowserLinkService {
  constructor(private readonly dependencies: BrowserLinkServiceDependencies) {}

  async start(): Promise<BrowserLinkStartResponse & { verifier: string }> {
    const challengeId = randomDigits(24)
    const displayCode = challengeId.slice(0, 6)
    const verifier = randomBytes(32).toString('base64url')
    const now = this.dependencies.clock.now()
    const expiresAt = new Date(now.getTime() + browserLinkTtlSeconds * 1000)
    await this.dependencies.repository.createBrowserLoginChallenge({
      id: challengeId,
      verifierHash: hashVerifier(verifier),
      displayCodeHash: hashVerifier(displayCode),
      expiresAt,
      now,
    })

    return {
      challengeId,
      displayCode,
      expiresAt: expiresAt.toISOString(),
      startParam: `browser_${challengeId}`,
      verifier,
    }
  }

  getStatus(id: string, verifier: string | undefined) {
    if (!verifier) return null
    return this.dependencies.repository.getBrowserLoginChallenge({
      id,
      verifierHash: hashVerifier(verifier),
      now: this.dependencies.clock.now(),
    })
  }

  async approve(
    id: string,
    principal: AuthenticatedPrincipal,
    rawInitData: string,
    explicitApproval: boolean,
  ) {
    if (!explicitApproval || principal.externalIdentity?.provider !== 'max') {
      throw new AuthFailure('browser_link_invalid', 'Browser login approval is invalid')
    }

    let verified: VerifiedMaxInitData
    try {
      verified = this.dependencies.verifyInitData(rawInitData)
    } catch {
      throw new AuthFailure('browser_link_invalid', 'Browser login approval is invalid')
    }

    if (
      verified.startParam !== `browser_${id}` ||
      verified.identity.subject !== principal.externalIdentity.subject
    ) {
      throw new AuthFailure('browser_link_invalid', 'Browser login approval is invalid')
    }

    const result = await this.dependencies.repository.approveBrowserLoginChallenge({
      id,
      userId: principal.id,
      externalIdentityId: principal.externalIdentity.id,
      now: this.dependencies.clock.now(),
    })
    if (result === 'missing' || result === 'expired') {
      throw new AuthFailure('browser_link_invalid', 'Browser login challenge is invalid or expired')
    }
    return { approved: true as const }
  }

  async redeem(id: string, verifier: string | undefined, metadata: SessionMetadata) {
    if (!verifier) {
      throw new AuthFailure('browser_link_invalid', 'Browser login challenge is invalid')
    }

    const now = this.dependencies.clock.now()
    const refreshToken = this.dependencies.refreshTokens.create()
    const redeemed = await this.dependencies.repository.redeemBrowserLoginChallenge({
      id,
      verifierHash: hashVerifier(verifier),
      now,
      refreshTokenHash: this.dependencies.refreshTokens.hash(refreshToken),
      refreshTokenFamilyHash: this.dependencies.refreshTokens.familyHash(refreshToken),
      expiresAt: sessionExpiresAt(now, this.dependencies.refreshTokenTtlDays),
      metadata,
    })
    if (!redeemed) {
      throw new AuthFailure('browser_link_invalid', 'Browser login challenge is invalid or expired')
    }

    return {
      user: await this.dependencies.projectUser(redeemed.user),
      accessToken: await this.dependencies.accessTokens.sign({
        sub: redeemed.user.id,
        sessionId: redeemed.session.id,
      }),
      refreshTokenToSet: refreshToken,
    }
  }
}

export function hashVerifier(value: string) {
  return createHash('sha256').update(value).digest('hex')
}

function randomDigits(length: number) {
  const bytes = randomBytes(length)
  return [...bytes].map((byte) => String(byte % 10)).join('')
}
