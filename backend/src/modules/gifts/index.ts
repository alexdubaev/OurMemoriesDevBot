import type { MiddlewareHandler } from 'hono'

import type { DbClient } from '../../db'
import type { IdempotencyExecutor, PrismaTransactionClient } from '../../idempotency'
import type { AuthHttpEnv } from '../auth'
import type { FamilyAccess } from '../families'
import { GiftService } from './application/gift-service'
import { PrismaGiftRepository } from './infrastructure/prisma-gift-repository'
import { createGiftRoutes } from './transport/routes'
import { createGiftMetadataProvider } from './infrastructure/gift-metadata'
import type { GiftMetadataProvider } from './application/ports'
export { giftPrivacyMiddleware } from './transport/routes'
export { GiftService } from './application/gift-service'
export type { GiftRepository } from './application/ports'
export { GiftFailure } from './domain/errors'
export type { GiftMetadataProvider } from './application/ports'

export function createGiftsModule({
  db,
  familyAccess,
  idempotencyExecutor,
  requireAuth,
  metadataProvider = createGiftMetadataProvider(),
  now,
}: {
  db: DbClient
  familyAccess: FamilyAccess
  idempotencyExecutor: IdempotencyExecutor<PrismaTransactionClient>
  /** Accepted for parity with the other content modules; gifts sign nothing today. */
  idempotencySecret?: string
  requireAuth: MiddlewareHandler<AuthHttpEnv>
  metadataProvider?: GiftMetadataProvider
  now?: () => Date
}) {
  const service = new GiftService(familyAccess, new PrismaGiftRepository(db, idempotencyExecutor), metadataProvider, now)
  return { routes: createGiftRoutes({ requireAuth, service }) }
}
