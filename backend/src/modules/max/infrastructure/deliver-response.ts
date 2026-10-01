import type { DbClient } from '../../../db'
import { TerminalTaskError } from '../../../outbox'
import type { MaxApiPort } from '../application/ports'
import { choicePayload, readCandidates } from '../../../bot-family-target'
import type { MaxInboundEvent } from '../application/ports'
import { inviteStartText } from './process-task'
import type { DetailedInviteStartResolution } from '../../families'

type PayloadCrypto = {
  decrypt<T>(payload: { ciphertext: Uint8Array; iv: Uint8Array; authTag: Uint8Array }): T
}

export type MaxResponseDelivery = (payload: unknown, signal?: AbortSignal) => Promise<'done' | 'skipped'>

export function createMaxResponseDelivery(options: {
  prisma: DbClient
  api: MaxApiPort
  crypto?: PayloadCrypto
  maxBotUsername?: string
  resolveDetailedInviteStart?: (rawToken: string, maxSubject: string) => Promise<DetailedInviteStartResolution>
  now?: () => Date
}): MaxResponseDelivery {
  return async (payload, signal) => {
    const responseId = responsePayload(payload)
    const response = await options.prisma.maxOutgoingResponse.findUnique({ where: { id: responseId }, include: { inbox: { include: { source: true } }, channelDecision: true } })
    if (!response || response.deliveredAt) return 'skipped'
    if (response.kind === 'family_choice') {
      if (response.channelDecisionId && response.channelDecision) {
        const decision = response.channelDecision
        if (decision.status !== 'pending' || decision.expiresAt <= (options.now ?? (() => new Date()))()) return 'skipped'
        const buttons = readChannelButtons(response.buttons)
        for (let offset = 0; offset < buttons.length; offset += 30) {
          if (offset > 0) await waitForChannelBatch(signal)
          await options.api.sendMessage({ userId: response.destinationUserId.toString(), text: response.text, buttons: buttons.slice(offset, offset + 30) }, signal)
        }
      } else {
      const source = response.inbox.source
      if (!source || source.familyId || !source.choiceExpiresAt || source.choiceExpiresAt <= new Date()) return 'skipped'
      const candidates = readCandidates(source.choiceCandidates)
      for (let offset = 0; offset < candidates.length; offset += 30) {
        await options.api.sendMessage({ userId: response.destinationUserId.toString(), text: response.text,
          buttons: candidates.slice(offset, offset + 30).map((candidate, pageIndex) => ({
            text: candidate.name, payload: choicePayload(source.id, offset + pageIndex),
          })) }, signal)
      }
      }
    } else {
      const inviteContext = response.kind === 'welcome'
        ? readInviteContext(response.inbox, response.destinationUserId.toString(), options) : null
      if (inviteContext && options.resolveDetailedInviteStart && options.maxBotUsername) {
        const state = await options.resolveDetailedInviteStart(inviteContext.token, inviteContext.actorId)
        const button = state.status === 'valid'
          ? { type: 'open_app' as const, text: 'Открыть приглашение', webApp: options.maxBotUsername, payload: `invite_${inviteContext.token}` }
          : state.status === 'already_member'
            ? { type: 'open_app' as const, text: 'Открыть memoLy', webApp: options.maxBotUsername }
            : undefined
        await options.api.sendMessage({
          userId: response.destinationUserId.toString(),
          text: inviteStartText(state),
          ...(button ? { buttons: [button] } : {}),
        }, signal)
      } else {
        await options.api.sendMessage({ userId: response.destinationUserId.toString(), text: response.text }, signal)
      }
    }

    await options.prisma.$transaction(async (tx) => {
      const delivered = await tx.maxOutgoingResponse.updateMany({
        where: { id: response.id, deliveredAt: null },
        data: { deliveredAt: (options.now ?? (() => new Date()))() },
      })
      if (delivered.count === 1 && response.kind === 'welcome') {
        await tx.maxInbox.updateMany({ where: { id: response.inboxId }, data: {
          encryptedPayload: Buffer.alloc(0), encryptionIv: Buffer.alloc(0), encryptionAuthTag: Buffer.alloc(0),
        } })
      }
    })
    return 'done'
  }
}

function waitForChannelBatch(signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.reject(signal.reason ?? new Error('MAX channel response delivery aborted'))
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, 550)
    const onAbort = () => {
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
      reject(signal?.reason ?? new Error('MAX channel response delivery aborted'))
    }
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

function readChannelButtons(value: unknown): Array<{ type: 'callback'; text: string; payload: string }> {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) return []
    const button = item as { text?: unknown; payload?: unknown }
    return typeof button.text === 'string' && typeof button.payload === 'string' && button.payload.startsWith('max_channel:')
      ? [{ type: 'callback' as const, text: button.text.slice(0, 64), payload: button.payload.slice(0, 512) }] : []
  })
}

function readInviteContext(
  inbox: { encryptedPayload: Uint8Array; encryptionIv: Uint8Array; encryptionAuthTag: Uint8Array },
  destinationUserId: string,
  options: { crypto?: PayloadCrypto },
) {
  if (!options.crypto || inbox.encryptedPayload.byteLength === 0) return null
  const event = options.crypto.decrypt<MaxInboundEvent>({
    ciphertext: inbox.encryptedPayload, iv: inbox.encryptionIv, authTag: inbox.encryptionAuthTag,
  })
  if (event.kind !== 'bot_started' || !event.payload?.startsWith('invite_') || event.payload.length > 128 ||
      !/^[A-Za-z0-9_-]{32,121}$/.test(event.payload.slice('invite_'.length)) ||
      event.userId !== destinationUserId) return null
  return { token: event.payload.slice('invite_'.length), actorId: event.userId }
}

function responsePayload(payload: unknown): string {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload) ||
      Object.keys(payload).length !== 1 || typeof (payload as { responseId?: unknown }).responseId !== 'string' ||
      !isUuid((payload as { responseId: string }).responseId)) {
    throw new TerminalTaskError('MAX response task payload is invalid')
  }
  return (payload as { responseId: string }).responseId
}

function isUuid(input: string) {
  return input !== '00000000-0000-0000-0000-000000000000' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(input)
}
