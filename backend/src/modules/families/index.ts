import type { MiddlewareHandler } from 'hono'

import type { DbClient } from '../../db'
import type { IdempotencyExecutor, PrismaTransactionClient } from '../../idempotency'
import type { AuthHttpEnv } from '../auth'
import { FamilyService } from './application/family-service'
import { createPrismaFamilyAccess } from './infrastructure/family-access'
export { createPrismaFamilyAccess } from './infrastructure/family-access'
import { prismaPersistenceErrors } from './infrastructure/persistence-errors'
import { createFamilyRoutes } from './transport/routes'
export { createInviteStartResolver, createDetailedInviteStartResolver } from './application/invite-start'
export type { DetailedInviteStartResolution } from './application/invite-start'
export { toFamilyAppError } from './transport/errors'

export function createFamiliesModule({
  db,
  idempotencyExecutor,
  idempotencySecret,
  familyQuotaBytes,
  multiFamilyActivation,
  requireAuth,
}: {
  db: DbClient
  idempotencyExecutor: IdempotencyExecutor<PrismaTransactionClient>
  idempotencySecret: string
  familyQuotaBytes: number
  multiFamilyActivation: 'off' | 'on'
  requireAuth: MiddlewareHandler<AuthHttpEnv>
}) {
  const access = createPrismaFamilyAccess(db)
  return {
    access,
    routes: createFamilyRoutes({
      requireAuth,
      service: new FamilyService(
        db,
        access,
        prismaPersistenceErrors,
        idempotencyExecutor,
        idempotencySecret,
        familyQuotaBytes,
        undefined,
        multiFamilyActivation,
      ),
    }),
  }
}

export type { FamilyAccess, FamilyScope } from './application/ports'
export { mayEditContent, mayLike } from './domain/family-policy'
