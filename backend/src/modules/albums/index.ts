import type { MiddlewareHandler } from 'hono'
import type { MaxNotificationPilot } from '../../max-notifications-pilot'
import type { DbClient } from '../../db'
import type { IdempotencyExecutor, PrismaTransactionClient } from '../../idempotency'
import type { AuthHttpEnv } from '../auth'
import type { AlbumMemorySourceCatalog } from '../memories'
import { createPrismaAlbumPhotoSourceCatalog } from '../media'
import { AlbumService } from './application/album-service'
import { PrismaAlbumRepository } from './infrastructure/prisma-album-repository'
import { createAlbumRoutes } from './transport/routes'
import { createAlbumMemorySourceCatalog } from '../memories'
import type { AlbumMemoryPickerItem } from './application/album-types'
import { createComposedAlbumSourceCatalog, type AlbumSourceCatalog } from './infrastructure/composed-album-source-catalog'

export function createAlbumsModule({ db, idempotencyExecutor, idempotencySecret, requireAuth, sourceCatalog, notificationPilot }:
  { db: DbClient; idempotencyExecutor: IdempotencyExecutor<PrismaTransactionClient>; idempotencySecret: string; requireAuth: MiddlewareHandler<AuthHttpEnv>; sourceCatalog?: AlbumSourceCatalog; notificationPilot?: MaxNotificationPilot }) {
  const catalog = sourceCatalog ?? createComposedAlbumSourceCatalog(createAlbumMemorySourceCatalog(), createPrismaAlbumPhotoSourceCatalog())
  const repository = new PrismaAlbumRepository(db, idempotencyExecutor, catalog, notificationPilot)
  const service = new AlbumService(repository, idempotencySecret)
  return { routes: createAlbumRoutes({ requireAuth, service }), service, repository }
}

export { AlbumService } from './application/album-service'
export { PrismaAlbumRepository } from './infrastructure/prisma-album-repository'
export type { AlbumMemoryPickerItem }
export type { AlbumMemorySourceCatalog } from '../memories'
export { createComposedAlbumSourceCatalog } from './infrastructure/composed-album-source-catalog'
export type { AlbumSourceCatalog } from './infrastructure/composed-album-source-catalog'
