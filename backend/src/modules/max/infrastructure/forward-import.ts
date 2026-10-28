import type { MaxInboundEvent, MaxResolvedMessage } from '../application/ports'
import type { PrismaTransactionClient } from '../../../idempotency'
import { MaxProviderError } from './max-api'

const acceptedBindingStates = ['connected', 'replaced', 'disconnected', 'permission_problem']
const maxFutureSkewMs = 5 * 60 * 1_000

export function validateMaxForwardedMessage(message: MaxResolvedMessage, expectedMessageId: string, now = new Date()) {
  if (message.messageId !== expectedMessageId || message.recipientType !== 'channel' || !isSignedInt64(message.recipientId) ||
      message.timestamp === undefined || !Number.isSafeInteger(message.timestamp) || message.timestamp < 0 ||
      message.timestamp > 8_640_000_000_000_000 || message.timestamp > now.getTime() + maxFutureSkewMs ||
      (message.text !== undefined && message.text !== null && typeof message.text !== 'string')) {
    throw new MaxProviderError(undefined, false, 400, 'forward_identity_mismatch')
  }
  return { channelId: BigInt(message.recipientId), occurredAt: new Date(message.timestamp) }
}

/** A forwarded copy posted in our connected channel is its own authenticated
 * envelope. Never resolve or infer access to the unrelated original channel. */
export function materializeMaxChannelForward(message: MaxResolvedMessage,
  event: Extract<MaxInboundEvent, { kind: 'message_created' }>): MaxResolvedMessage {
  if (!event.isChannel || !event.forwardedFrom || message.messageId !== event.messageId ||
      message.recipientType !== 'channel' || message.recipientId !== event.recipientId ||
      message.senderId !== event.senderId || message.forwardedFrom?.messageId !== event.forwardedFrom.messageId ||
      message.attachments.length !== 0) {
    throw new MaxProviderError(undefined, false, 400, 'channel_forward_identity_mismatch')
  }
  const attachments = message.forwardedAttachments ?? []
  const ingress = event.forwardedFrom.attachments
  if (ingress && (ingress.length !== attachments.length || ingress.some((item, index) =>
    item.kind !== attachments[index]?.kind || item.providerAttachmentId !== attachments[index]?.providerAttachmentId))) {
    throw new MaxProviderError(undefined, false, 400, 'channel_forward_attachment_mismatch')
  }
  const timestamp = message.forwardedFrom.timestamp
  const validTimestamp = timestamp !== undefined && Number.isSafeInteger(timestamp) && timestamp >= 0 &&
    timestamp <= 8_640_000_000_000_000 && timestamp <= Date.now() + maxFutureSkewMs
  return { ...message, text: message.forwardedText ?? null, attachments,
    ...(validTimestamp ? { timestamp } : {}) }
}

export function reportMaxForwardDiagnostic(
  stage: 'provider_lookup' | 'channel_binding' | 'source_claim' | 'publication_binding',
  error: unknown,
  ids?: { sourceId: string; inboxId: string; outerMessageId: string; originalMessageId: string },
) {
  const category = error instanceof MaxProviderError ? error.code ?? 'provider_failure'
    : error instanceof Error && error.name === 'FamilyFailure' ? 'authorization_failure' : 'internal_failure'
  console.warn('MAX forward import failed', { stage, category, ...ids })
}

export async function assertMaxForwardBinding(
  tx: Pick<PrismaTransactionClient, '$queryRaw' | 'maxChannelBinding' | 'family'>,
  familyId: string,
  channelId: bigint,
  live = false,
) {
  await tx.$queryRaw`SELECT "chat_id" FROM "max_channel_bindings" WHERE "chat_id" = ${channelId} FOR UPDATE`
  const binding = await tx.maxChannelBinding.findUnique({ where: { chatId: channelId }, select: { familyId: true, state: true } })
  const selected = !live || await tx.family.findFirst({ where: { id: familyId, status: 'active', maxBackupChatId: channelId }, select: { id: true } })
  if (!binding || binding.familyId !== familyId || !(live ? binding.state === 'connected' : acceptedBindingStates.includes(binding.state)) || !selected) {
    const error = new Error('MAX forward channel binding is unavailable')
    error.name = 'FamilyFailure'
    Object.assign(error, { kind: 'forbidden' })
    throw error
  }
}

function isSignedInt64(value: string) {
  if (!/^-?(?:0|[1-9][0-9]*)$/.test(value)) return false
  try {
    const parsed = BigInt(value)
    return parsed !== 0n && parsed >= -9_223_372_036_854_775_808n && parsed <= 9_223_372_036_854_775_807n
  } catch { return false }
}
