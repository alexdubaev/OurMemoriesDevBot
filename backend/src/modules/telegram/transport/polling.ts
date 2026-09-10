import type { TelegramApiPort } from '../application/ports'
import { normalizeTelegramUpdate } from './update-mapping'

export function startTelegramPolling(options: {
  api: Pick<TelegramApiPort, 'getUpdates'>
  acceptUpdate: (event: ReturnType<typeof normalizeTelegramUpdate>) => Promise<unknown>
}) {
  const controller = new AbortController()
  let offset = 0
  const stopped = (async () => {
    while (!controller.signal.aborted) {
      try {
        const updates = await options.api.getUpdates(offset, controller.signal)
        for (const update of updates) {
          const event = normalizeTelegramUpdate(update)
          await options.acceptUpdate(event)
          if (typeof update === 'object' && update && 'update_id' in update && typeof update.update_id === 'number') {
            offset = Math.max(offset, update.update_id + 1)
          }
        }
      } catch (error) {
        if (controller.signal.aborted) break
        console.error('Telegram polling iteration failed.', error)
        await new Promise((resolve) => setTimeout(resolve, 1_000))
      }
    }
  })()
  return { stop: () => controller.abort(), stopped }
}
