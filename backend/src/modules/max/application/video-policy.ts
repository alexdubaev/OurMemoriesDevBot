import type { MaxInboundAttachment, MaxInboundEvent } from './ports'

export function classifyMaxVideoMessage(event: Extract<MaxInboundEvent, { kind: 'message_created' }>) {
  const attachments = event.attachments ?? (event.hasAttachments
    ? [{ kind: 'file' as const, providerAttachmentId: 'unsupported:legacy', filename: null, declaredSize: null }]
    : [])
  const body = event.text === null || event.text.trim().length === 0 ? '' : event.text
  if ([...body].length > 8_000) return { kind: 'denied' as const, reason: 'invalid_caption' as const }
  if (attachments.length === 1 && attachments[0]?.kind === 'video') {
    return { kind: 'video' as const, body, attachment: attachments[0] }
  }
  return { kind: 'unsupported' as const }
}

export function normalizeVideoDurationMs(inboundSeconds: number | null | undefined, resolverMs: number | null | undefined) {
  if (!isPositiveSafeInteger(inboundSeconds) || !isPositiveSafeInteger(resolverMs)) return null
  if (inboundSeconds > Number.MAX_SAFE_INTEGER / 1_000 || resolverMs !== inboundSeconds * 1_000) return null
  return resolverMs <= 2_147_483_647 ? resolverMs : null
}

export function isVideoAttachment(value: MaxInboundAttachment): value is Extract<MaxInboundAttachment, { kind: 'video' }> {
  return value.kind === 'video'
}

function isPositiveSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
}
