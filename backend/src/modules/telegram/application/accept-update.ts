import type { TelegramAcceptRepository, TelegramApiPort } from './ports'
import type { TelegramInboundEvent } from '../domain/inbound-event'

export function createAcceptTelegramUpdate(options: {
  botId: bigint
  repository: TelegramAcceptRepository
  api: Pick<TelegramApiPort, 'sendMessage'>
  encrypt: (value: unknown) => { ciphertext: Uint8Array; iv: Uint8Array; authTag: Uint8Array }
  /** Runs only after a new valid watch_ command has been durably accepted. */
  onVideoNavigation?: (inboxId: string) => Promise<unknown>
  /** Runs after a new invite start is durably accepted; the queued inbox task remains its fallback. */
  onInviteStart?: (inboxId: string) => Promise<unknown>
  now?: () => Date
}) {
  const now = options.now ?? (() => new Date())
  return async (event: TelegramInboundEvent) => {
    if (event.kind === 'ignored' || event.kind === 'ignored_group') return { inboxId: null, duplicate: false }
    let acceptedEvent = event
    let admission = null
    if (event.kind === 'note' || event.kind === 'media' || event.kind === 'caption_reply') {
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
    const immediateVideoNavigation = isVideoNavigationStart(event) && options.onVideoNavigation !== undefined
    const immediateInviteStart = isInviteStart(event) && options.onInviteStart !== undefined
    const result = await options.repository.accept({
      botId: options.botId,
      event: acceptedEvent,
      encrypted: options.encrypt(acceptedEvent),
      admission,
      now: now(),
      queueInboxTask: !immediateVideoNavigation,
    })
    if (immediateVideoNavigation && !result.duplicate && result.inboxId) {
      await options.onVideoNavigation!(result.inboxId)
    }
    if (immediateInviteStart && !result.duplicate && result.inboxId) {
      await options.onInviteStart!(result.inboxId).catch(() => undefined)
    }
    if (!result.duplicate && (event.kind === 'note' || event.kind === 'media') && acceptedEvent.kind !== 'denied_content') {
      await options.api.sendMessage(event.chatId, 'Получено. Сохраняем…').catch(() => undefined)
    }
    return result
  }
}

function isVideoNavigationStart(event: TelegramInboundEvent) {
  return event.kind === 'command' && event.command === 'start' && /^watch_[A-Za-z0-9_-]{32}$/.test(event.argument)
}

function isInviteStart(event: TelegramInboundEvent) {
  return event.kind === 'command' && event.command === 'start' && /^invite_[A-Za-z0-9_-]{32,57}$/.test(event.argument)
}
