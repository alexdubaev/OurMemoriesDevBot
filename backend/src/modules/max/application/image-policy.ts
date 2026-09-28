import type { MaxInboundAttachment, MaxInboundEvent } from './ports'

export function classifyMaxImageMessage(event: Extract<MaxInboundEvent, { kind: 'message_created' }>):
  | { kind: 'quick-images'; attachments: Extract<MaxInboundAttachment, { kind: 'image' }>[]; body: string }
  | { kind: 'mixed-media'; attachments: Array<Extract<MaxInboundAttachment, { kind: 'image' | 'video' }>>; body: string }
  | { kind: 'image-file'; attachment: Extract<MaxInboundAttachment, { kind: 'file' }>; body: string }
  | { kind: 'unsupported' }
  | { kind: 'denied'; reason: 'invalid_caption' } {
  const attachments = event.attachments ?? (event.hasAttachments ? [{ kind: 'file' as const, providerAttachmentId: 'unsupported:legacy', filename: null, declaredSize: null }] : [])
  const body = event.text === null || event.text.trim().length === 0 ? '' : event.text
  if ([...body].length > 8_000) return { kind: 'denied', reason: 'invalid_caption' }
  if (attachments.length >= 1 && attachments.length <= 10 && attachments.every((item) => item.kind === 'image')) {
    return { kind: 'quick-images', attachments: attachments as Extract<MaxInboundAttachment, { kind: 'image' }>[], body }
  }
  if (attachments.length >= 2 && attachments.length <= 10 && attachments.every((item) => item.kind === 'image' || item.kind === 'video')) {
    return { kind: 'mixed-media', attachments: attachments as Array<Extract<MaxInboundAttachment, { kind: 'image' | 'video' }>>, body }
  }
  if (attachments.length === 1 && attachments[0]!.kind === 'file' && !attachments[0]!.providerAttachmentId.startsWith('unsupported:')) {
    return { kind: 'image-file', attachment: attachments[0]!, body }
  }
  return { kind: 'unsupported' }
}
