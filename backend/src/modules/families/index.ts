import type { MiddlewareHandler } from 'hono'

import type { DbClient } from '../../db'
import type { AuthHttpEnv } from '../auth'
import { FamilyService } from './application/family-service'
import { createPrismaFamilyAccess } from './infrastructure/family-access'
import { prismaPersistenceErrors } from './infrastructure/persistence-errors'
import { createFamilyRoutes } from './transport/routes'

export function createFamiliesModule({
  db,
  idempotencySecret,
  requireAuth,
}: {
  db: DbClient
  idempotencySecret: string
  requireAuth: MiddlewareHandler<AuthHttpEnv>
}) {
  const access = createPrismaFamilyAccess(db)
  return {
    access,
    routes: createFamilyRoutes({
      requireAuth,
      service: new FamilyService(db, access, prismaPersistenceErrors, idempotencySecret),
    }),
  }
}

export type { FamilyAccess, FamilyScope } from './application/ports'
export { mayEditContent, mayLike } from './domain/family-policy'
