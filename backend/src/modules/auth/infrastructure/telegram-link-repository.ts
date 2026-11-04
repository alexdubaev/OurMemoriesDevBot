import { acquireUserAuthenticationAuthorityLock, type DbClient, userAuthenticationSessionTransactionOptions } from '../../../db'
import { Prisma } from '../../../generated/prisma/client'
import type { TelegramLinkRepository } from '../application/ports'

type Transaction = Prisma.TransactionClient

export function createPrismaTelegramLinkRepository(db: DbClient): TelegramLinkRepository {
  return {
    async isConnected(userId) {
      return (await db.externalIdentity.count({ where: { userId, provider: 'telegram' } })) > 0
    },
    start(input) {
      return db.$transaction(async (tx) => {
        await acquireUserAuthenticationAuthorityLock(tx, input.userId)
        await lockSourceSession(tx, input.sessionId)
        const now = await databaseNow(tx)
        const source = await activeMaxSource(tx, input.sessionId, now, new Date(now.getTime() - input.absoluteTtlMs))
        if (!source || source.userId !== input.userId || source.externalIdentityId !== input.identityId) return null
        if (await tx.externalIdentity.count({ where: { userId: input.userId, provider: 'telegram' } })) {
          return { connected: true as const }
        }
        return { connected: false as const, issuedAt: now }
      }, userAuthenticationSessionTransactionOptions)
    },
  }
}

// Called only inside the identity + session + replay transaction. No account is ever reparented.
export async function resolveTelegramLink(tx: Transaction, input: {
  sourceSessionId: string
  issuedAt: number
  tokenHash: string
  authDateSeconds: number
  sourceAbsoluteTtlMs: number
}, subject: string) {
  const candidate = await tx.authSession.findUnique({ where: { id: input.sourceSessionId } })
  if (!candidate) return { state: 'link_invalid' as const }
  await acquireUserAuthenticationAuthorityLock(tx, candidate.userId)
  await lockSourceSession(tx, candidate.id)
  const now = await databaseNow(tx)
  if (input.issuedAt > now.getTime() || input.issuedAt + 15_000 <= now.getTime() || input.authDateSeconds < Math.floor(input.issuedAt / 1000)) {
    return { state: 'link_invalid' as const }
  }
  const source = await activeMaxSource(tx, candidate.id, now, new Date(now.getTime() - input.sourceAbsoluteTtlMs))
  if (!source || source.userId !== candidate.userId) return { state: 'link_invalid' as const }
  const fingerprintHash = input.tokenHash
  if (await tx.telegramAuthReplay.findUnique({ where: { fingerprintHash } })) return { state: 'link_invalid' as const }
  const identity = await tx.externalIdentity.findUnique({ where: { provider_subject: { provider: 'telegram', subject } } })
  const connected = await tx.externalIdentity.findFirst({ where: { provider: 'telegram', userId: source.userId } })
  if (identity || connected) {
    return { state: 'link_conflict' as const }
  }
  // Recheck after potentially blocking reads. The domain-separated fingerprint is a one-use Telegram
  // authorization capability, stored atomically with the identity/session in the existing registry.
  const consumeAt = await databaseNow(tx)
  if (input.issuedAt + 15_000 <= consumeAt.getTime()) return { state: 'link_invalid' as const }
  await tx.telegramAuthReplay.create({ data: { fingerprintHash, expiresAt: new Date(input.issuedAt + 315_000) } })
  const externalIdentity = await tx.externalIdentity.create({ data: { provider: 'telegram', subject, userId: source.userId }, include: { user: true } })
  return { state: 'linked' as const, externalIdentity }
}

function lockSourceSession(tx: Transaction, sessionId: string) {
  return tx.$queryRaw`SELECT id FROM auth_sessions WHERE id = ${sessionId}::uuid FOR UPDATE`
}

async function databaseNow(tx: Transaction) {
  const [row] = await tx.$queryRaw<Array<{ now: Date }>>`SELECT clock_timestamp() AS now`
  return row!.now
}

function activeMaxSource(tx: Transaction, sessionId: string, now: Date, createdAfter: Date) {
  return tx.authSession.findFirst({ where: {
    id: sessionId, revokedAt: null, expiresAt: { gt: now }, createdAt: { gt: createdAfter },
    user: { is: { controlState: 'active' } },
    externalIdentity: { is: { provider: 'max' } },
  } }).then(async (session) => {
    if (!session) return null
    const identity = await tx.externalIdentity.findUnique({ where: { id: session.externalIdentityId! } })
    return identity?.userId === session.userId ? session : null
  })
}
