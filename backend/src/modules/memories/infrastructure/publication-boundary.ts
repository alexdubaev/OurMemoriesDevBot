import type { PrismaTransactionClient } from '../../../idempotency'
import { MemoryFailure } from '../domain/errors'

/** Join, activation and first publication serialize on this row. Call after the actor user lock. */
export async function lockPublicationFamily(tx: PrismaTransactionClient, familyId: string) {
  const rows = await tx.$queryRaw<Array<{ publicationOrdinal: bigint; trackingActivated: boolean }>>`
    SELECT publication_ordinal AS "publicationOrdinal",
           unread_tracking_activated_at IS NOT NULL AS "trackingActivated"
      FROM families WHERE id = ${familyId}::uuid AND status = 'active' FOR UPDATE
  `
  if (!rows[0]) throw new MemoryFailure('not_found', 'Семья не найдена')
  return rows[0]
}

/** Allocate only for the first published state transition, inside its writer transaction. */
export async function allocatePublicationOrdinal(tx: PrismaTransactionClient, familyId: string, trackingActivated: boolean) {
  if (!trackingActivated) return null
  const rows = await tx.$queryRaw<Array<{ publicationOrdinal: bigint }>>`
    UPDATE families SET publication_ordinal = publication_ordinal + 1
     WHERE id = ${familyId}::uuid
     RETURNING publication_ordinal AS "publicationOrdinal"
  `
  if (!rows[0]) throw new MemoryFailure('not_found', 'Семья не найдена')
  return rows[0].publicationOrdinal
}

/** Publication time is independent of unread tracking and is assigned at every first publish. */
export function firstPublicationTime(now = new Date()) {
  return now
}
