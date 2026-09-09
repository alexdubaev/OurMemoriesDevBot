import type { MediaMemoryCatalog } from '../application/ports'
import { MemoryFailure } from '../domain/errors'

/** No storage stand-in: media publication is unavailable until Block 03 wires its lifecycle. */
export const unavailableMediaMemoryCatalog: MediaMemoryCatalog = {
  async assertReadyForPublication() {
    throw new MemoryFailure(
      'media_unavailable',
      'Публикация медиа будет доступна после подготовки защищённого хранения',
    )
  },
}

export function createMediaMemoryCatalog(isReady: MediaMemoryCatalog['assertReadyForPublication']): MediaMemoryCatalog {
  return {
    async assertReadyForPublication(scope, mediaIds) {
      try { await isReady(scope, mediaIds) } catch (error) {
        if (typeof error === 'object' && error && 'kind' in error) {
          throw new MemoryFailure('media_unavailable', 'Медиа недоступно для публикации')
        }
        throw error
      }
    },
  }
}
