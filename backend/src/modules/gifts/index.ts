import type { MiddlewareHandler } from 'hono'

import type { DbClient } from '../../db'
import type { IdempotencyExecutor, PrismaTransactionClient } from '../../idempotency'
import type { AuthHttpEnv } from '../auth'
import type { FamilyAccess } from '../families'
import { GiftService } from './application/gift-service'
import { PrismaGiftRepository } from './infrastructure/prisma-gift-repository'
import { createGiftRoutes } from './transport/routes'
export { giftPrivacyMiddleware } from './transport/routes'
export { GiftService } from './application/gift-service'
export type { GiftRepository } from './application/ports'
export { GiftFailure } from './domain/errors'

export function createGiftsModule({
  db,
  familyAccess,
  idempotencyExecutor,
  requireAuth,
  now,
}: {
  db: DbClient
  familyAccess: FamilyAccess
  idempotencyExecutor: IdempotencyExecutor<PrismaTransactionClient>
  /** Accepted for parity with the other content modules; gifts sign nothing today. */
  idempotencySecret?: string
  requireAuth: MiddlewareHandler<AuthHttpEnv>
  now?: () => Date
}) {
  const service = new GiftService(familyAccess, new PrismaGiftRepository(db, idempotencyExecutor), now)
  return { routes: createGiftRoutes({ requireAuth, service }) }
}
