import type { MiddlewareHandler } from 'hono'

import type { DbClient } from '../../db'
import type { MaxNotificationPilot } from '../../max-notifications-pilot'
import type { IdempotencyExecutor, PrismaTransactionClient } from '../../idempotency'
import type { AuthHttpEnv } from '../auth'
import type { FamilyAccess } from '../families'
import { TelegramVideoDeliveryService } from '../telegram'
import { MemoryService } from './application/memory-service'
import type { MediaMemoryCatalog } from './application/ports'
import { unavailableMediaMemoryCatalog } from './infrastructure/media-memory-catalog'
import { createAlbumMemorySourceCatalog } from './infrastructure/album-memory-source-catalog'
export { createMediaMemoryCatalog } from './infrastructure/media-memory-catalog'
export { createAlbumMemorySourceCatalog }
import { PrismaMemoryRepository } from './infrastructure/prisma-memory-repository'
export { createSourceMemoryPublisher } from './infrastructure/source-memory-publisher'
export type { SourceMemoryInput } from './infrastructure/source-memory-publisher'
export { PrismaMemoryRepository } from './infrastructure/prisma-memory-repository'
import { createMemoryRoutes } from './transport/routes'
import { CommentService } from './application/comment-service'
import { PrismaCommentRepository } from './infrastructure/prisma-comment-repository'
import { createCommentRoutes } from './transport/comment-routes'
export { commentPrivacyMiddleware } from './transport/comment-routes'
export { CommentService } from './application/comment-service'
export type { CommentRepository, CommentPosition } from './application/comment-ports'

export function createMemoriesModule({
  db,
  familyAccess,
  idempotencyExecutor,
  idempotencySecret,
  requireAuth,
  mediaCatalog = unavailableMediaMemoryCatalog,
  telegramBotUsername,
  notificationPilot,
}: {
  db: DbClient
  familyAccess: FamilyAccess
  idempotencyExecutor: IdempotencyExecutor<PrismaTransactionClient>
  idempotencySecret: string
  requireAuth: MiddlewareHandler<AuthHttpEnv>
  mediaCatalog?: MediaMemoryCatalog
  telegramBotUsername: string
  notificationPilot?: MaxNotificationPilot
}) {
  const repository = new PrismaMemoryRepository(db, idempotencyExecutor, notificationPilot)
  const service = new MemoryService(familyAccess, repository, mediaCatalog, idempotencySecret)
  const telegramVideoDelivery = new TelegramVideoDeliveryService(db, familyAccess, telegramBotUsername)
  const commentService = new CommentService(familyAccess, new PrismaCommentRepository(db, idempotencyExecutor), idempotencySecret)
  const routes = createCommentRoutes({ requireAuth, service: commentService })
  routes.route('/', createMemoryRoutes({ requireAuth, service, telegramVideoDelivery }))
  return { routes }
}

export type { MediaMemoryCatalog, MemoryRepository } from './application/ports'
export type { AlbumMemoryPickerItem, AlbumMemorySourceCatalog, AlbumMemorySourceProjection, AlbumMemorySourceRef, AlbumSourceFilter, AlbumSourceCursor } from './application/album-source-ports'
export { MemoryService } from './application/memory-service'
export { MemoryFailure } from './domain/errors'
