import { maxEventKey } from './event-key'
import type {
  MaxAcceptRepository,
  MaxAcceptResult,
  EncryptedMaxPayload,
  MaxInboundEvent,
  MaxImmediateResponse,
} from './ports'

const acceptedText = 'Получено. Сохраняем…'
const unsupportedMediaText = 'Получено. Медиа пока не поддерживается — отправьте текстовую заметку.'
const maxTextCodePoints = 8_000

export function isPublishableMaxText(input: { text: string | null; hasAttachments: boolean }) {
  if (input.hasAttachments || input.text === null || input.text.trim().length === 0) return false
  return [...input.text].length <= maxTextCodePoints
}

export function selectMaxImmediateResponse(event: MaxInboundEvent): MaxImmediateResponse | null {
  if (event.kind === 'bot_started') return null
  if (event.hasAttachments) {
    return { kind: 'unsupported_media', text: unsupportedMediaText, destinationUserId: event.senderId }
  }
  if (!isPublishableMaxText(event)) return null
  return { kind: 'accepted', text: acceptedText, destinationUserId: event.senderId }
}

export function createMaxAcceptUpdate(options: {
  botId: string
  repository: MaxAcceptRepository
  encrypt: (event: MaxInboundEvent) => EncryptedMaxPayload
  now?: () => Date
}): (event: MaxInboundEvent) => Promise<MaxAcceptResult> {
  const now = options.now ?? (() => new Date())
  return async (event) => {
    const eventKey = maxEventKey(options.botId, event)
    return options.repository.accept({
      botId: options.botId,
      event,
      eventKey,
      encrypted: options.encrypt(event),
      response: selectMaxImmediateResponse(event),
      now: now(),
    })
  }
}
