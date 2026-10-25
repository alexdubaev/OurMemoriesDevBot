import type { PrismaTransactionClient } from '../../../idempotency'
import type { FamilyScope } from '../../families'
import { MediaFailure, type AlbumPhotoSourceCatalog } from '../../media'
import { AlbumFailure } from '../domain/errors'
import type { AlbumMemoryPickerItem, AlbumMemorySourceCatalog, AlbumMemorySourceProjection, AlbumMemorySourceRef, AlbumSourceFilter, AlbumSourceCursor } from '../../memories'

export type AlbumSourceRef = Omit<AlbumMemorySourceRef, 'memoryId'> & { memoryId: string | null }
export type AlbumSourceProjection = Omit<AlbumMemorySourceProjection, 'memoryId'> & { memoryId: string | null }

export type AlbumSourceCatalog = {
  resolve(tx: PrismaTransactionClient, scope: FamilyScope, refs: AlbumSourceRef[], lock: 'share' | 'update'): Promise<AlbumSourceProjection[]>
  project(tx: PrismaTransactionClient, scope: FamilyScope, refs: Array<AlbumSourceRef & { id?: string; kind: AlbumMemorySourceProjection['kind'] }>, lock?: 'share' | 'update'): Promise<AlbumSourceProjection[]>
  list(tx: PrismaTransactionClient, scope: FamilyScope, filter: AlbumSourceFilter, limit: number, before?: AlbumSourceCursor): Promise<{ items: AlbumMemoryPickerItem[]; hasNext: boolean; last: AlbumSourceCursor | null }>
}

export function createComposedAlbumSourceCatalog(memoryCatalog: AlbumMemorySourceCatalog, photoCatalog: AlbumPhotoSourceCatalog): AlbumSourceCatalog {
  return {
    async resolve(tx, scope, refs, lock) {
      const direct = refs.filter(({ memoryId }) => memoryId === null)
      const legacy = refs.filter(({ memoryId }) => memoryId !== null)
      if (direct.some(({ sourceKind }) => sourceKind !== 'private_storage')) throw unavailable()
      let memorySources: AlbumSourceProjection[] = []
      if (legacy.length) memorySources = await memoryCatalog.resolve(tx, scope, legacy as AlbumMemorySourceRef[], lock)
      let photoSources: AlbumSourceProjection[] = []
      if (direct.length) {
        let photos
        try { photos = await photoCatalog.claim(tx, scope, direct.map(({ sourceId }) => sourceId)) }
        catch (error) {
          if (error instanceof MediaFailure && error.kind === 'not_found') throw unavailable()
          throw error
        }
        const byId = new Map(photos.map((photo) => [photo.mediaId, photo]))
        photoSources = direct.map((ref) => {
          const photo = byId.get(ref.sourceId)
          if (!photo?.available) throw unavailable()
          return { ...ref, id: ref.sourceId, kind: 'photo', available: true, attachment: photo.attachment, body: null, occurredAt: null }
        })
      }
      const resolvedByKey = new Map([...memorySources, ...photoSources].map((source) => [key(source), source]))
      return refs.map((ref) => {
        const found = resolvedByKey.get(key(ref))
        if (!found) throw unavailable()
        return found
      })
    },
    async project(tx, scope, refs, lock = 'share') {
      const direct = refs.filter(({ memoryId }) => memoryId === null)
      const legacy = refs.filter(({ memoryId }) => memoryId !== null)
      const projected: AlbumSourceProjection[] = legacy.length ? await memoryCatalog.project(tx, scope, legacy as Array<AlbumMemorySourceRef & { id?: string; kind: AlbumMemorySourceProjection['kind'] }>, lock) : []
      const photos = direct.length ? await photoCatalog.project(tx, scope, direct.map(({ sourceId }) => sourceId)) : []
      const byId = new Map(photos.map((photo) => [photo.mediaId, photo]))
      const directProjected = direct.map((ref) => {
        const photo = byId.get(ref.sourceId)
        const available = Boolean(photo?.available)
        return { ...ref, id: ref.id ?? ref.sourceId, kind: 'photo' as const, available,
          attachment: available ? photo!.attachment : null, body: null, occurredAt: null }
      })
      const resultByKey = new Map([...projected, ...directProjected].map((source) => [key(source), source]))
      return refs.map((ref) => resultByKey.get(key(ref)) ?? { ...ref, id: ref.id ?? ref.sourceId,
        available: false, attachment: null, body: null, occurredAt: null })
    },
    list: (tx, scope, filter, limit, before) => memoryCatalog.list(tx, scope, filter, limit, before),
  }
}

function key(ref: Pick<AlbumSourceRef, 'memoryId' | 'sourceKind' | 'sourceId'>) {
  return `${ref.memoryId ?? 'private'}:${ref.sourceKind}:${ref.sourceId}`
}
function unavailable() { return new AlbumFailure('not_found', 'Альбом или исходник не найден') }
