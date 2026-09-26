import { maxEventKey } from './event-key'
import type {
  MaxAcceptRepository,
  MaxAcceptResult,
  EncryptedMaxPayload,
  MaxInboundEvent,
  MaxImmediateResponse,
  MaxInboundAttachment,
} from './ports'

const acceptedText = 'Получено. Сохраняем…'
const unsupportedMediaText = 'Получено. Медиа пока не поддерживается — отправьте текстовую заметку.'
const maxTextCodePoints = 8_000

export function isPublishableMaxText(input: { text: string | null; attachments?: MaxInboundAttachment[]; hasAttachments?: boolean }) {
  if ((input.attachments?.length ?? (input.hasAttachments ? 1 : 0)) > 0 || input.text === null || input.text.trim().length === 0) return false
  return isMaxCaptionWithinLimit(input.text)
}

export function isMaxCaptionWithinLimit(text: string | null) {
  return text === null || [...text].length <= maxTextCodePoints
}

function attachmentsOf(event: Extract<MaxInboundEvent, { kind: 'message_created' }>) {
  return event.attachments ?? (event.hasAttachments ? [{ kind: 'file' as const, providerAttachmentId: 'unsupported:legacy', filename: null, declaredSize: null }] : [])
}

export function selectMaxImmediateResponse(event: MaxInboundEvent): MaxImmediateResponse | null {
  if (event.kind === 'bot_started' || event.kind === 'family_choice') return null
  const attachments = attachmentsOf(event)
  if (attachments.length > 0) {
    const images = attachments.filter((attachment) => attachment.kind === 'image')
    const files = attachments.filter((attachment) => attachment.kind === 'file' && !attachment.providerAttachmentId.startsWith('unsupported:'))
    const voices = attachments.filter((attachment) => attachment.kind === 'voice')
    const videos = attachments.filter((attachment) => attachment.kind === 'video')
    const supported = (images.length === attachments.length && images.length >= 1 && images.length <= 10) ||
      (files.length === 1 && attachments.length === 1) ||
      (voices.length === 1 && attachments.length === 1) ||
      (videos.length === 1 && attachments.length === 1)
    return supported
      ? { kind: 'accepted', text: acceptedText, destinationUserId: event.senderId }
      : { kind: 'unsupported_media', text: unsupportedMediaText, destinationUserId: event.senderId }
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
