import { randomUUID } from 'node:crypto'

import type { DbClient } from '../../db'
import type { Prisma } from '../../generated/prisma/client'
import type { IdempotencyExecutor, IdempotencyRunOptions } from '../application/port'

export type PrismaTransactionClient = Parameters<Parameters<DbClient['$transaction']>[0]>[0]

const idempotencyTtlMs = 24 * 60 * 60 * 1_000

export function createPrismaIdempotencyExecutor(
  db: DbClient,
): IdempotencyExecutor<PrismaTransactionClient> {
  const executor: IdempotencyExecutor<PrismaTransactionClient> = {
    async run<Result>(options: IdempotencyRunOptions<PrismaTransactionClient, Result>) {
      const {
        actorUserId,
        operation,
        key,
        payloadHash,
        now,
        execute,
        restore,
        payloadConflict,
      } = options
      return db.$transaction(
      async (tx) => {
        const lockName = `idempotency:${actorUserId}:${operation}:${key}`
        await tx.$queryRaw<Array<{ acquired: boolean }>>`
          SELECT pg_advisory_xact_lock(hashtextextended(${lockName}, 0)) IS NULL AS acquired
        `

        const existing = await tx.idempotencyRecord.findUnique({
          where: { actorUserId_operation_key: { actorUserId, operation, key } },
        })
        if (existing && existing.expiresAt > now) {
          if (existing.payloadHash !== payloadHash) throw payloadConflict()
          return {
            response: restore(existing.responseSnapshot, existing.id),
            replayed: true,
          }
        }
        if (existing) await tx.idempotencyRecord.delete({ where: { id: existing.id } })

        const idempotencyRecordId = randomUUID()
        const result = await execute(tx, idempotencyRecordId)
        await tx.idempotencyRecord.create({
          data: {
            id: idempotencyRecordId,
            actorUserId,
            operation,
            key,
            payloadHash,
            resourceId: result.resourceId,
            responseSnapshot: result.responseSnapshot as Prisma.InputJsonValue,
            createdAt: now,
            expiresAt: new Date(now.getTime() + idempotencyTtlMs),
          },
        })
        return { response: result.response, replayed: false }
      },
      { timeout: 15_000 },
      )
    },
  }
  return executor
}
