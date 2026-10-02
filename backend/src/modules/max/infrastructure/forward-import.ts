import type { MaxResolvedMessage } from '../application/ports'
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
  tx: Pick<PrismaTransactionClient, '$queryRaw' | 'maxChannelBinding'>,
  familyId: string,
  channelId: bigint,
) {
  await tx.$queryRaw`SELECT "chat_id" FROM "max_channel_bindings" WHERE "chat_id" = ${channelId} FOR UPDATE`
  const binding = await tx.maxChannelBinding.findUnique({ where: { chatId: channelId }, select: { familyId: true, state: true } })
  if (!binding || binding.familyId !== familyId || !acceptedBindingStates.includes(binding.state)) {
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
