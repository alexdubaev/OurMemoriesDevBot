import type { MiddlewareHandler } from 'hono'

import type { DbClient } from '../../db'
import type { AuthHttpEnv } from '../auth'
import type { FamilyAccess } from '../families'
import { MemoryService } from './application/memory-service'
import type { MediaMemoryCatalog } from './application/ports'
import { unavailableMediaMemoryCatalog } from './infrastructure/media-memory-catalog'
import { createMemoryRoutes } from './transport/routes'

export function createMemoriesModule({
  db,
  familyAccess,
  idempotencySecret,
  requireAuth,
  mediaCatalog = unavailableMediaMemoryCatalog,
}: {
  db: DbClient
  familyAccess: FamilyAccess
  idempotencySecret: string
  requireAuth: MiddlewareHandler<AuthHttpEnv>
  mediaCatalog?: MediaMemoryCatalog
}) {
  const service = new MemoryService(db, familyAccess, mediaCatalog, idempotencySecret)
  return { routes: createMemoryRoutes({ requireAuth, service }) }
}

export type { MediaMemoryCatalog } from './application/ports'
export { MemoryService } from './application/memory-service'
