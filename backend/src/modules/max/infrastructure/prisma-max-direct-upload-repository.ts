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

export class PrismaMaxDirectUploadRepository implements MaxDirectUploadRepository {
  constructor(private readonly db: DbClient) {}

  async reserve(input: MaxVideoUploadReserveInput): Promise<MaxVideoUploadReservation> {
    const body = input.body.trim()
    if (!body || body.length > 4_000 || !input.idempotencyKey || !input.idempotencyFingerprint) {
      throw new Error('Invalid MAX video upload reservation')
    }

    return this.db.$transaction(async (tx) => {
      const existing = await tx.maxVideoUploadSession.findUnique({
        where: { familyId_idempotencyKey: { familyId: input.familyId, idempotencyKey: input.idempotencyKey } },
      }) ?? await tx.maxVideoUploadSession.findUnique({
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
