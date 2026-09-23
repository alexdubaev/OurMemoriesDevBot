import {
  acquireUserAuthenticationAuthorityLock,
  type DbClient,
  userAuthenticationSessionTransactionOptions,
} from '../../../db'
import { Prisma } from '../../../generated/prisma/client'
import { enqueueTask } from '../../../outbox'
import type {
  AuthRepository,
  BrowserLinkRepository,
  MaxAuthRepository,
  TelegramAuthRepository,
} from '../application/ports'
import { AuthFailure } from '../domain/errors'

export function createPrismaAuthRepository(db: DbClient): AuthRepository {
  return {
    findUserByEmail(email) {
      return db.user.findUnique({ where: { email } })
    },

    async createPasswordUserWithSession(input) {
      try {
        return await db.$transaction(async (tx) => {
          const user = await tx.user.create({
            data: {
              email: input.user.email,
              passwordHash: input.user.passwordHash,
              displayName: input.user.displayName,
              role: 'user',
            },
          })
          const session = await tx.authSession.create({
            data: {
              userId: user.id,
              refreshTokenHash: input.session.refreshTokenHash,
              refreshTokenFamilyHash: input.session.refreshTokenFamilyHash,
              expiresAt: input.session.expiresAt,
              userAgent: input.session.metadata.userAgent,
              ipAddress: input.session.metadata.ipAddress,
            },
            select: { id: true },
          })

          return { user, session }
        })
      } catch (error) {
        if (isUniqueConstraintError(error)) {
          throw new AuthFailure('email_already_exists', 'User with this email already exists')
        }
        throw error
      }
    },

    createSession(input) {
      return db.$transaction(async (tx) => {
        await acquireUserAuthenticationAuthorityLock(tx, input.userId)
        const user = await tx.user.findUnique({
          where: { id: input.userId },
        })
        if (!user || !(await input.authorizeUser(user))) return null

        const session = await tx.authSession.create({
          data: {
            userId: user.id,
            refreshTokenHash: input.refreshTokenHash,
            refreshTokenFamilyHash: input.refreshTokenFamilyHash,
            expiresAt: input.expiresAt,
            userAgent: input.metadata.userAgent,
            ipAddress: input.metadata.ipAddress,
          },
          select: { id: true },
        })
        return { user, session }
      }, userAuthenticationSessionTransactionOptions)
    },

    async findActiveRefreshSession(input) {
      const family = await db.authSession.findFirst({
        where: {
          refreshTokenFamilyHash: input.refreshTokenFamilyHash,
          revokedAt: null,
          expiresAt: { gt: input.now },
          createdAt: { gt: input.createdAfter },
        },
        include: { user: true },
      })
      if (family) {
        if (family.refreshTokenHash === input.refreshTokenHash) {
          return { ...family, credentialState: 'current' as const }
        }

        const isPrevious = family.previousRefreshTokenHash === input.refreshTokenHash
        const withinGrace =
          isPrevious &&
          family.refreshRotatedAt !== null &&
          family.refreshRotatedAt >= input.reuseGraceAfter
        return {
          ...family,
          credentialState: withinGrace
            ? ('previous_within_grace' as const)
            : ('reused' as const),
        }
      }

      const current = await db.authSession.findFirst({
        where: {
          refreshTokenHash: input.refreshTokenHash,
          revokedAt: null,
          expiresAt: { gt: input.now },
          createdAt: { gt: input.createdAfter },
        },
        include: { user: true },
      })
      if (current) {
        return { ...current, credentialState: 'current' as const }
      }

      const previous = await db.authSession.findFirst({
        where: {
          previousRefreshTokenHash: input.refreshTokenHash,
          revokedAt: null,
          expiresAt: { gt: input.now },
          createdAt: { gt: input.createdAfter },
        },
        include: { user: true },
      })
      if (!previous) return null

      const withinGrace =
        previous.refreshRotatedAt !== null && previous.refreshRotatedAt >= input.reuseGraceAfter
      return {
        ...previous,
        credentialState: withinGrace
          ? ('previous_within_grace' as const)
          : ('reused' as const),
      }
    },

    rotateRefreshSession(input) {
      return db.authSession.updateMany({
        where: {
          id: input.currentSessionId,
          refreshTokenHash: input.currentRefreshTokenHash,
          revokedAt: null,
          expiresAt: { gt: input.now },
        },
        data: {
          previousRefreshTokenHash: input.currentRefreshTokenHash,
          refreshTokenHash: input.nextRefreshTokenHash,
          refreshTokenFamilyHash: input.nextRefreshTokenFamilyHash,
          refreshRotatedAt: input.now,
          expiresAt: input.nextExpiresAt,
          userAgent: input.metadata.userAgent,
          ipAddress: input.metadata.ipAddress,
        },
      }).then(({ count }) => count === 1)
    },

    revokeSessionById(input) {
      return db.authSession.updateMany({
        where: { id: input.sessionId, revokedAt: null },
        data: { revokedAt: input.now },
      }).then(({ count }) => count === 1)
    },

    findActiveAccessSession(input) {
      return db.authSession.findFirst({
        where: {
          id: input.sessionId,
          userId: input.userId,
          revokedAt: null,
          expiresAt: { gt: input.now },
          createdAt: { gt: input.createdAfter },
          OR: [
            { externalIdentityId: null },
            { externalIdentity: { is: { userId: input.userId } } },
          ],
        },
        include: {
          user: true,
          externalIdentity: { select: { id: true, provider: true, subject: true } },
        },
      }).then((session) => session && {
        id: session.id,
        user: session.user,
        externalIdentity: session.externalIdentity,
      })
    },

    revokeSession(input) {
      return db.$transaction(async (tx) => {
        const session = await tx.authSession.findFirst({
          where: {
            OR: [
              { refreshTokenHash: input.refreshTokenHash },
              { previousRefreshTokenHash: input.refreshTokenHash },
              { refreshTokenFamilyHash: input.refreshTokenFamilyHash },
            ],
            revokedAt: null,
          },
          select: { id: true, userId: true },
        })
        if (!session) return null

        const revoked = await tx.authSession.updateMany({
          where: { id: session.id, revokedAt: null },
          data: { revokedAt: input.now },
        })
        return revoked.count === 1 ? session.userId : null
      })
    },

    createPasswordResetToken(input) {
      return db.$transaction(async (tx) => {
        await acquireUserAuthenticationAuthorityLock(tx, input.userId)
        const recentToken = await tx.passwordResetToken.findFirst({
          where: {
            userId: input.userId,
            createdAt: { gte: input.createdAfter },
          },
          select: { id: true },
        })
        if (recentToken) return false

        await tx.passwordResetToken.updateMany({
          where: { userId: input.userId, usedAt: null },
          data: { usedAt: input.now },
        })
        await tx.passwordResetToken.create({
          data: {
            userId: input.userId,
            tokenHash: input.tokenHash,
            expiresAt: input.expiresAt,
          },
        })
        return true
      }, userAuthenticationSessionTransactionOptions)
    },

    async invalidatePasswordResetToken(input) {
      await db.passwordResetToken.updateMany({
        where: { tokenHash: input.tokenHash, usedAt: null },
        data: { usedAt: input.now },
      })
    },

    async hasActivePasswordResetToken(input) {
      const token = await db.passwordResetToken.findFirst({
        where: {
          tokenHash: input.tokenHash,
          usedAt: null,
          expiresAt: { gt: input.now },
        },
        select: { id: true },
      })
      return token !== null
    },

    completePasswordReset(input) {
      return db.$transaction(async (tx) => {
        const candidate = await tx.passwordResetToken.findFirst({
          where: {
            tokenHash: input.tokenHash,
            usedAt: null,
            expiresAt: { gt: input.now },
          },
          select: { userId: true },
        })
        if (!candidate) return null

        await acquireUserAuthenticationAuthorityLock(tx, candidate.userId)
        const token = await tx.passwordResetToken.findFirst({
          where: {
            tokenHash: input.tokenHash,
            userId: candidate.userId,
            usedAt: null,
            expiresAt: { gt: input.now },
          },
          select: { user: { select: { email: true } } },
        })
        if (!token?.user.email) return null

        await tx.user.update({
          where: { id: candidate.userId },
          data: { passwordHash: input.passwordHash },
        })
        await tx.passwordResetToken.updateMany({
          where: { userId: candidate.userId, usedAt: null },
          data: { usedAt: input.now },
        })
        await tx.authSession.updateMany({
          where: { userId: candidate.userId, revokedAt: null },
          data: { revokedAt: input.now },
        })

        // Inside the transaction on purpose: the committed password change and the queued notice
        // stand or fall together, so neither a crash nor a failed insert can leave one without
        // the other.
        await input.queueNotice(token.user.email, async (task) => {
          await enqueueTask(tx, task)
        })

        return { email: token.user.email }
      }, userAuthenticationSessionTransactionOptions)
    },
  }
}

export function createPrismaTelegramAuthRepository(
  db: DbClient,
  sessions: AuthRepository,
): TelegramAuthRepository {
  return {
    findActiveRefreshSession: sessions.findActiveRefreshSession,

    async exchangeTelegramIdentity(input) {
      try {
        return await db.$transaction(async (tx) => {
          await tx.telegramAuthReplay.deleteMany({
            where: { expiresAt: { lte: input.now } },
          })
          const replay = await tx.telegramAuthReplay.findUnique({
            where: { fingerprintHash: input.fingerprintHash },
            select: { sessionId: true },
          })
          if (replay) {
            if (!input.existingSessionId || replay.sessionId !== input.existingSessionId) {
              return { state: 'replayed' as const }
            }
            const existing = await tx.authSession.findFirst({
              where: {
                id: input.existingSessionId,
                revokedAt: null,
                expiresAt: { gt: input.now },
              },
              include: { user: true },
            })
            return existing
              ? { state: 'same_session' as const, user: existing.user, session: { id: existing.id } }
              : { state: 'replayed' as const }
          }

          const externalIdentity = await tx.externalIdentity.upsert({
            where: {
              provider_subject: {
                provider: input.identity.provider,
                subject: input.identity.subject,
              },
            },
            update: {},
            create: {
              provider: input.identity.provider,
              subject: input.identity.subject,
              user: {
                create: {
                  email: null,
                  passwordHash: null,
                  displayName: input.identity.displayName,
                  role: 'user',
                },
              },
            },
            include: { user: true },
          })
          const session = await tx.authSession.create({
            data: {
              userId: externalIdentity.userId,
              externalIdentityId: externalIdentity.id,
              refreshTokenHash: input.session.refreshTokenHash,
              refreshTokenFamilyHash: input.session.refreshTokenFamilyHash,
              expiresAt: input.session.expiresAt,
              userAgent: input.session.metadata.userAgent,
              ipAddress: input.session.metadata.ipAddress,
            },
            select: { id: true },
          })
          await tx.telegramAuthReplay.create({
            data: {
              fingerprintHash: input.fingerprintHash,
              sessionId: session.id,
              expiresAt: input.replayExpiresAt,
            },
          })
          return { state: 'issued' as const, user: externalIdentity.user, session }
        }, userAuthenticationSessionTransactionOptions)
      } catch (error) {
        const replay = await db.telegramAuthReplay.findUnique({
          where: { fingerprintHash: input.fingerprintHash },
          select: { sessionId: true },
        })
        if (isUniqueConstraintError(error) && replay) return { state: 'replayed' as const }
        throw error
      }
    },
  }
}

export function createPrismaMaxAuthRepository(
  db: DbClient,
  sessions: AuthRepository,
): MaxAuthRepository {
  return {
    findActiveRefreshSession: sessions.findActiveRefreshSession,

    async exchangeMaxIdentity(input) {
      try {
        return await db.$transaction(async (tx) => {
          await tx.$executeRaw(
            Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${`max-auth:${input.identity.provider}:${input.identity.subject}`}, 0))`,
          )
          await tx.maxAuthReplay.deleteMany({
            where: { expiresAt: { lte: input.now } },
          })
          const replay = await tx.maxAuthReplay.findUnique({
            where: { fingerprintHash: input.fingerprintHash },
            select: { sessionId: true },
          })
          if (replay) {
            if (!input.existingSessionId || replay.sessionId !== input.existingSessionId) {
              return { state: 'replayed' as const }
            }
            const existing = await tx.authSession.findFirst({
              where: {
                id: input.existingSessionId,
                revokedAt: null,
                expiresAt: { gt: input.now },
              },
              include: { user: true },
            })
            return existing
              ? { state: 'same_session' as const, user: existing.user, session: { id: existing.id } }
              : { state: 'replayed' as const }
          }

          const externalIdentity = await tx.externalIdentity.upsert({
            where: {
              provider_subject: {
                provider: input.identity.provider,
                subject: input.identity.subject,
              },
            },
            update: {},
            create: {
              provider: input.identity.provider,
              subject: input.identity.subject,
              user: {
                create: {
                  email: null,
                  passwordHash: null,
                  displayName: input.identity.displayName,
                  role: 'user',
                },
              },
            },
            include: { user: true },
          })
          const session = await tx.authSession.create({
            data: {
              userId: externalIdentity.userId,
              externalIdentityId: externalIdentity.id,
              refreshTokenHash: input.session.refreshTokenHash,
              refreshTokenFamilyHash: input.session.refreshTokenFamilyHash,
              expiresAt: input.session.expiresAt,
              userAgent: input.session.metadata.userAgent,
              ipAddress: input.session.metadata.ipAddress,
            },
            select: { id: true },
          })
          await tx.maxAuthReplay.create({
            data: {
              fingerprintHash: input.fingerprintHash,
              sessionId: session.id,
              expiresAt: input.replayExpiresAt,
            },
          })
          return { state: 'issued' as const, user: externalIdentity.user, session }
        }, userAuthenticationSessionTransactionOptions)
      } catch (error) {
        const replay = await db.maxAuthReplay.findUnique({
          where: { fingerprintHash: input.fingerprintHash },
          select: { sessionId: true },
        })
        if (isUniqueConstraintError(error) && replay) return { state: 'replayed' as const }
        throw error
      }
    },
  }
}

export function createPrismaBrowserLinkRepository(db: DbClient): BrowserLinkRepository {
  return {
    createBrowserLoginChallenge(input) {
      return db.$transaction(async (tx) => {
        const stale = await tx.browserLoginChallenge.findMany({
          where: { expiresAt: { lte: input.now } },
          select: { id: true },
          orderBy: { expiresAt: 'asc' },
          take: 100,
        })
        if (stale.length > 0) {
          await tx.browserLoginChallenge.deleteMany({
            where: { id: { in: stale.map(({ id }) => id) } },
          })
        }
        await tx.browserLoginChallenge.create({
          data: {
            id: input.id,
            verifierHash: input.verifierHash,
            displayCodeHash: input.displayCodeHash,
            expiresAt: input.expiresAt,
          },
          select: { id: true },
        })
      }).then(() => undefined)
    },

    async getBrowserLoginChallenge(input) {
      const challenge = await db.browserLoginChallenge.findUnique({
        where: { id: input.id, verifierHash: input.verifierHash },
        select: { state: true, expiresAt: true },
      })
      if (!challenge) return null
      if (challenge.state === 'redeemed' || challenge.expiresAt <= input.now) {
        return { state: 'expired' as const, expiresAt: challenge.expiresAt }
      }
      return {
        state: challenge.state === 'approved' ? ('approved' as const) : ('pending' as const),
        expiresAt: challenge.expiresAt,
      }
    },

    async approveBrowserLoginChallenge(input) {
      return db.$transaction(async (tx) => {
        const challenge = await tx.browserLoginChallenge.findUnique({
          where: { id: input.id },
          select: {
            state: true,
            expiresAt: true,
            approvedUserId: true,
            approvedExternalIdentityId: true,
          },
        })
        if (!challenge) return 'missing' as const
        if (challenge.expiresAt <= input.now) return 'expired' as const
        if (challenge.state === 'approved') {
          return challenge.approvedUserId === input.userId &&
            challenge.approvedExternalIdentityId === input.externalIdentityId
            ? ('already_approved' as const)
            : ('missing' as const)
        }
        if (challenge.state !== 'pending') {
          return 'expired' as const
        }

        const identity = await tx.externalIdentity.findFirst({
          where: {
            id: input.externalIdentityId,
            userId: input.userId,
            provider: 'max',
          },
          select: { id: true },
        })
        if (!identity) return 'missing' as const

        const updated = await tx.browserLoginChallenge.updateMany({
          where: {
            id: input.id,
            state: 'pending',
            expiresAt: { gt: input.now },
          },
          data: {
            state: 'approved',
            approvedAt: input.now,
            approvedUserId: input.userId,
            approvedExternalIdentityId: input.externalIdentityId,
          },
        })
        return updated.count === 1 ? ('approved' as const) : ('missing' as const)
      }, userAuthenticationSessionTransactionOptions)
    },

    async redeemBrowserLoginChallenge(input) {
      return db.$transaction(async (tx) => {
        await tx.$queryRaw(Prisma.sql`
          SELECT id FROM browser_login_challenges WHERE id = ${input.id} FOR UPDATE
        `)
        const challenge = await tx.browserLoginChallenge.findUnique({
          where: { id: input.id, verifierHash: input.verifierHash },
          select: {
            state: true,
            expiresAt: true,
            approvedUserId: true,
            approvedExternalIdentityId: true,
          },
        })
        if (
          !challenge ||
          challenge.state !== 'approved' ||
          challenge.expiresAt <= input.now ||
          !challenge.approvedUserId ||
          !challenge.approvedExternalIdentityId
        ) return null

        const identity = await tx.externalIdentity.findFirst({
          where: {
            id: challenge.approvedExternalIdentityId,
            userId: challenge.approvedUserId,
            provider: 'max',
          },
          include: { user: true },
        })
        if (!identity) return null

        const consumed = await tx.browserLoginChallenge.updateMany({
          where: { id: input.id, state: 'approved' },
          data: { state: 'redeemed', redeemedAt: input.now },
        })
        if (consumed.count !== 1) throw new Error('Browser login challenge consume race')

        const session = await tx.authSession.create({
          data: {
            userId: identity.userId,
            externalIdentityId: identity.id,
            refreshTokenHash: input.refreshTokenHash,
            refreshTokenFamilyHash: input.refreshTokenFamilyHash,
            expiresAt: input.expiresAt,
            userAgent: input.metadata.userAgent,
            ipAddress: input.metadata.ipAddress,
          },
          select: { id: true },
        })
        return { user: identity.user, session }
      }, userAuthenticationSessionTransactionOptions)
    },
  }
}

function isUniqueConstraintError(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002'
}
