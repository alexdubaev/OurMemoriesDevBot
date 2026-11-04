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
        const source = await activeMaxSource(tx, input.sessionId, now, input.createdAfter)
        if (!source || source.userId !== input.userId || source.externalIdentityId !== input.identityId) return null
        if (await tx.externalIdentity.count({ where: { userId: input.userId, provider: 'telegram' } })) {
          return { connected: true as const }
        }
        const expiresAt = new Date(now.getTime() + 15_000)
        await tx.telegramIdentityLink.upsert({
          where: { sourceSessionId: input.sessionId },
          create: { sourceSessionId: input.sessionId, tokenHash: input.tokenHash, createdAt: now, expiresAt },
          update: { tokenHash: input.tokenHash, createdAt: now, expiresAt, consumedAt: null },
        })
        return { connected: false as const, expiresAt }
      }, userAuthenticationSessionTransactionOptions)
    },
  }
}

// Called only inside the identity + session + replay transaction. No account is ever reparented.
export async function resolveTelegramLink(tx: Transaction, input: {
  tokenHash: string
  authDateSeconds: number
  sourceCreatedAfter: Date
}, subject: string) {
  const candidate = await tx.telegramIdentityLink.findUnique({
    where: { tokenHash: input.tokenHash }, include: { sourceSession: true },
  })
  if (!candidate) return { state: 'link_invalid' as const }
  await acquireUserAuthenticationAuthorityLock(tx, candidate.sourceSession.userId)
  await lockSourceSession(tx, candidate.sourceSessionId)
  await tx.$queryRaw`SELECT source_session_id FROM telegram_identity_links WHERE token_hash = ${input.tokenHash} FOR UPDATE`
  const now = await databaseNow(tx)
  const link = await tx.telegramIdentityLink.findUnique({ where: { tokenHash: input.tokenHash } })
  if (!link || link.consumedAt || link.expiresAt <= now || input.authDateSeconds < Math.floor(link.createdAt.getTime() / 1000)) {
    return { state: 'link_invalid' as const }
  }
  const source = await activeMaxSource(tx, link.sourceSessionId, now, input.sourceCreatedAfter)
  if (!source || source.userId !== candidate.sourceSession.userId) return { state: 'link_invalid' as const }
  const identity = await tx.externalIdentity.findUnique({ where: { provider_subject: { provider: 'telegram', subject } } })
  const connected = await tx.externalIdentity.findFirst({ where: { provider: 'telegram', userId: source.userId } })
  if (identity && identity.userId !== source.userId || connected && connected.subject !== subject) {
    return { state: 'link_conflict' as const }
  }
  // Recheck the deadline in SQL at consumption, after all potentially blocking reads.
  const consumed = await tx.$executeRaw`
    UPDATE telegram_identity_links SET consumed_at = clock_timestamp()
    WHERE token_hash = ${input.tokenHash} AND consumed_at IS NULL AND expires_at > clock_timestamp()
  `
  if (consumed !== 1) return { state: 'link_invalid' as const }
  const externalIdentity = identity
    ? await tx.externalIdentity.findUniqueOrThrow({ where: { id: identity.id }, include: { user: true } })
    : await tx.externalIdentity.create({ data: { provider: 'telegram', subject, userId: source.userId }, include: { user: true } })
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
