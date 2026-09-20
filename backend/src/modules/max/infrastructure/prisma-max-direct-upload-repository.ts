import { randomUUID } from 'node:crypto'

import type { DbClient } from '../../../db'
import type {
  MaxDirectUploadRepository,
  MaxOutboundSource,
  MaxOutboundSourceInput,
  MaxVideoUploadReservation,
  MaxVideoUploadReserveInput,
  MaxVideoUploadSession,
} from '../application/ports'

const processingLeaseMs = 60_000

export class PrismaMaxDirectUploadRepository implements MaxDirectUploadRepository {
  constructor(private readonly db: DbClient) {}

  async reserve(input: MaxVideoUploadReserveInput): Promise<MaxVideoUploadReservation> {
    const body = input.body.trim()
    if (!body || body.length > 4_000 || !input.idempotencyKey || !input.idempotencyFingerprint) {
      throw new Error('Invalid MAX video upload reservation')
    }

    return this.db.$transaction(async (tx) => {
      const existingByKey = await tx.maxVideoUploadSession.findUnique({
        where: { familyId_idempotencyKey: { familyId: input.familyId, idempotencyKey: input.idempotencyKey } },
      })
      if (existingByKey && existingByKey.idempotencyFingerprint !== input.idempotencyFingerprint) {
        throw new Error('MAX direct upload idempotency key was reused with different metadata')
      }
      const existing = existingByKey ?? await tx.maxVideoUploadSession.findUnique({
        where: { familyId_idempotencyFingerprint: { familyId: input.familyId, idempotencyFingerprint: input.idempotencyFingerprint } },
      })
      if (existing) return { session: normalizeSession(existing), created: false }

      const data = {
        id: randomUUID(),
        familyId: input.familyId,
        authorId: input.authorId,
        childId: input.childId,
        plannedMemoryId: input.plannedMemoryId,
        body,
        occurredAt: input.occurredAt,
        idempotencyFingerprint: input.idempotencyFingerprint,
        idempotencyKey: input.idempotencyKey,
        expiresAt: input.expiresAt,
        state: 'reserved' as const,
        retryCount: 0,
        createdAt: input.now,
        updatedAt: input.now,
      }
      try {
        const created = await tx.maxVideoUploadSession.create({ data })
        return { session: normalizeSession(created), created: true }
      } catch (error) {
        if (!isUniqueViolation(error)) throw error
        const raced = await tx.maxVideoUploadSession.findUnique({
          where: { familyId_idempotencyKey: { familyId: input.familyId, idempotencyKey: input.idempotencyKey } },
        }) ?? await tx.maxVideoUploadSession.findUnique({
          where: { familyId_idempotencyFingerprint: { familyId: input.familyId, idempotencyFingerprint: input.idempotencyFingerprint } },
        })
        if (!raced) throw error
        return { session: normalizeSession(raced), created: false }
      }
    })
  }

  async createOutboundSource(input: MaxOutboundSourceInput): Promise<MaxOutboundSource> {
    const created = await this.db.maxOutboundSource.create({ data: {
      id: randomUUID(),
      uploadSessionId: input.uploadSessionId,
      familyId: input.familyId,
      recipientId: BigInt(input.recipientId),
      messageId: input.messageId,
      providerAttachmentId: input.providerAttachmentId,
    } })
    return normalizeOutboundSource(created)
  }

  async find(familyId: string, sessionId: string): Promise<MaxVideoUploadSession | null> {
    const row = await this.db.maxVideoUploadSession.findUnique({ where: { id_familyId: { id: sessionId, familyId } } })
    return row ? normalizeSession(row) : null
  }

  async claim(familyId: string, sessionId: string, now: Date) {
    return this.db.$transaction(async (tx) => {
      const row = await tx.maxVideoUploadSession.findUnique({ where: { id_familyId: { id: sessionId, familyId } } })
      if (!row) return null
      const current = normalizeSession(row)
      if (current.state === 'finalized' || current.state === 'failed' || current.state === 'expired') {
        return { session: current, claimed: false }
      }
      const claimed = await tx.maxVideoUploadSession.updateMany({
        where: {
          id: sessionId,
          familyId,
          OR: [
            { state: { in: ['reserved', 'uploaded', 'message_sent'] } },
            // A crashed process can leave a durable claim behind. Only reclaim it
            // after the provider request deadline has elapsed; a live concurrent
            // finalize must observe claimed=false and never send again.
            { state: 'processing', lastRetryAt: { lt: new Date(now.getTime() - processingLeaseMs) } },
          ],
        },
        data: { state: 'processing', lastRetryAt: now, retryCount: { increment: 1 } },
      })
      const fresh = await tx.maxVideoUploadSession.findUnique({ where: { id_familyId: { id: sessionId, familyId } } })
      if (!fresh) return null
      return { session: normalizeSession(fresh), claimed: claimed.count === 1 }
    })
  }

  async update(session: MaxVideoUploadSession, patch: Partial<Pick<MaxVideoUploadSession, 'state' | 'providerUploadToken' | 'providerMessageId' | 'retryCount' | 'lastRetryAt' | 'lastErrorCode'>>) {
    const updated = await this.db.maxVideoUploadSession.update({
      where: { id_familyId: { id: session.id, familyId: session.familyId } },
      data: patch,
    })
    return normalizeSession(updated)
  }

  async findOutboundSource(uploadSessionId: string, familyId: string) {
    const row = await this.db.maxOutboundSource.findFirst({ where: { uploadSessionId, familyId } })
    return row ? normalizeOutboundSource(row) : null
  }

  async findRecipientId(familyId: string, userId: string) {
    const identity = await this.db.externalIdentity.findFirst({
      where: { userId, provider: 'max', user: { familyMemberships: { some: { familyId, revokedAt: null } } } },
      select: { subject: true },
    })
    return identity?.subject ?? null
  }

  async assertChild(familyId: string, childId: string) {
    const child = await this.db.child.findFirst({ where: { id: childId, familyId }, select: { id: true } })
    return child !== null
  }
}

function normalizeSession(value: Record<string, unknown>): MaxVideoUploadSession {
  return {
    id: String(value.id),
    familyId: String(value.familyId),
    authorId: String(value.authorId),
    childId: String(value.childId),
    plannedMemoryId: String(value.plannedMemoryId),
    body: String(value.body),
    occurredAt: asDate(value.occurredAt),
    idempotencyFingerprint: String(value.idempotencyFingerprint),
    idempotencyKey: String(value.idempotencyKey),
    expiresAt: asDate(value.expiresAt),
    state: value.state as MaxVideoUploadSession['state'],
    providerUploadToken: nullableString(value.providerUploadToken),
    providerMessageId: nullableString(value.providerMessageId),
    retryCount: typeof value.retryCount === 'number' ? value.retryCount : 0,
    lastRetryAt: value.lastRetryAt == null ? null : asDate(value.lastRetryAt),
    lastErrorCode: nullableString(value.lastErrorCode),
    createdAt: asDate(value.createdAt),
    updatedAt: asDate(value.updatedAt),
  }
}

function normalizeOutboundSource(value: Record<string, unknown>): MaxOutboundSource {
  return {
    id: String(value.id),
    uploadSessionId: String(value.uploadSessionId),
    familyId: String(value.familyId),
    recipientId: String(value.recipientId),
    messageId: String(value.messageId),
    providerAttachmentId: String(value.providerAttachmentId),
    createdAt: asDate(value.createdAt),
    updatedAt: asDate(value.updatedAt),
  }
}

function asDate(value: unknown) {
  return value instanceof Date ? value : new Date(String(value))
}

function nullableString(value: unknown) {
  return value === null || value === undefined ? null : String(value)
}

function isUniqueViolation(error: unknown) {
  return typeof error === 'object' && error !== null && 'code' in error && (error as { code?: unknown }).code === 'P2002'
}
