import type { MiddlewareHandler } from 'hono'
import type { DbClient } from '../../db'
import type { IdempotencyExecutor, PrismaTransactionClient } from '../../idempotency'
import type { AuthHttpEnv } from '../auth'
import type { AlbumMemorySourceCatalog } from '../memories'
import { AlbumService } from './application/album-service'
import { PrismaAlbumRepository } from './infrastructure/prisma-album-repository'
import { createAlbumRoutes } from './transport/routes'
import { createAlbumMemorySourceCatalog } from '../memories'
import type { AlbumMemoryPickerItem } from './application/album-types'

export function createAlbumsModule({ db, idempotencyExecutor, idempotencySecret, requireAuth, sourceCatalog = createAlbumMemorySourceCatalog() }:
  { db: DbClient; idempotencyExecutor: IdempotencyExecutor<PrismaTransactionClient>; idempotencySecret: string; requireAuth: MiddlewareHandler<AuthHttpEnv>; sourceCatalog?: AlbumMemorySourceCatalog }) {
  const repository = new PrismaAlbumRepository(db, idempotencyExecutor, sourceCatalog)
  const service = new AlbumService(repository, idempotencySecret)
  return { routes: createAlbumRoutes({ requireAuth, service }), service, repository }
}

export { AlbumService } from './application/album-service'
export { PrismaAlbumRepository } from './infrastructure/prisma-album-repository'
export type { AlbumMemoryPickerItem }
export type { AlbumMemorySourceCatalog } from '../memories'
