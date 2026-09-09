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
