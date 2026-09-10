import type { TelegramAcceptRepository, TelegramApiPort } from './ports'
import type { TelegramInboundEvent } from '../domain/inbound-event'

export function createAcceptTelegramUpdate(options: {
  botId: bigint
  repository: TelegramAcceptRepository
  api: Pick<TelegramApiPort, 'sendMessage'>
  encrypt: (value: unknown) => { ciphertext: Uint8Array; iv: Uint8Array; authTag: Uint8Array }
  now?: () => Date
}) {
  const now = options.now ?? (() => new Date())
  return async (event: TelegramInboundEvent) => {
    if (event.kind === 'ignored' || event.kind === 'ignored_group') return { inboxId: null, duplicate: false }
    let acceptedEvent = event
    let admission = null
    if (event.kind === 'note' || event.kind === 'media') {
      admission = await options.repository.findAdmission(event.senderId)
      if (!admission || admission.role !== 'full') {
        acceptedEvent = {
          kind: 'denied_content',
          updateId: event.updateId,
          chatId: event.chatId,
          messageId: event.messageId,
          senderId: event.senderId,
          occurredAt: event.occurredAt,
        }
      }
    }
    const result = await options.repository.accept({
      botId: options.botId,
      event: acceptedEvent,
      encrypted: options.encrypt(acceptedEvent),
      admission,
      now: now(),
    })
    if (!result.duplicate && (event.kind === 'note' || event.kind === 'media') && acceptedEvent.kind !== 'denied_content') {
      await options.api.sendMessage(event.chatId, 'Получено. Сохраняем…').catch(() => undefined)
    }
    return result
  }
}
