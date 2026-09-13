import type { MiddlewareHandler } from 'hono'

import type { DbClient } from '../../db'
import type { IdempotencyExecutor, PrismaTransactionClient } from '../../idempotency'
import type { AuthHttpEnv } from '../auth'
import type { FamilyAccess } from '../families'
import { TelegramVideoDeliveryService } from '../telegram'
import { MemoryService } from './application/memory-service'
import type { MediaMemoryCatalog } from './application/ports'
import { unavailableMediaMemoryCatalog } from './infrastructure/media-memory-catalog'
export { createMediaMemoryCatalog } from './infrastructure/media-memory-catalog'
import { PrismaMemoryRepository } from './infrastructure/prisma-memory-repository'
export { createSourceMemoryPublisher } from './infrastructure/source-memory-publisher'
import { createMemoryRoutes } from './transport/routes'

export function createMemoriesModule({
  db,
  familyAccess,
  idempotencyExecutor,
  idempotencySecret,
  requireAuth,
  mediaCatalog = unavailableMediaMemoryCatalog,
  telegramBotUsername,
}: {
  db: DbClient
  familyAccess: FamilyAccess
  idempotencyExecutor: IdempotencyExecutor<PrismaTransactionClient>
  idempotencySecret: string
  requireAuth: MiddlewareHandler<AuthHttpEnv>
  mediaCatalog?: MediaMemoryCatalog
  telegramBotUsername: string
}) {
  const repository = new PrismaMemoryRepository(db, idempotencyExecutor)
  const service = new MemoryService(familyAccess, repository, mediaCatalog, idempotencySecret)
  const telegramVideoDelivery = new TelegramVideoDeliveryService(db, familyAccess, telegramBotUsername)
  return { routes: createMemoryRoutes({ requireAuth, service, telegramVideoDelivery }) }
}

export type { MediaMemoryCatalog, MemoryRepository } from './application/ports'
export { MemoryService } from './application/memory-service'
export { MemoryFailure } from './domain/errors'
