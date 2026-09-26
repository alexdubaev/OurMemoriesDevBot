import type { DbClient } from '../../../db'
import { TerminalTaskError } from '../../../outbox'
import type { MaxApiPort } from '../application/ports'
import { choicePayload, readCandidates } from '../../../bot-family-target'

export type MaxResponseDelivery = (payload: unknown, signal?: AbortSignal) => Promise<'done' | 'skipped'>

export function createMaxResponseDelivery(options: {
  prisma: DbClient
  api: MaxApiPort
  now?: () => Date
}): MaxResponseDelivery {
  return async (payload, signal) => {
    const responseId = responsePayload(payload)
    const response = await options.prisma.maxOutgoingResponse.findUnique({ where: { id: responseId }, include: { inbox: { include: { source: true } } } })
    if (!response || response.deliveredAt) return 'skipped'
    if (response.kind === 'family_choice') {
      const source = response.inbox.source
      if (!source || source.familyId || !source.choiceExpiresAt || source.choiceExpiresAt <= new Date()) return 'skipped'
      const candidates = readCandidates(source.choiceCandidates)
      for (let offset = 0; offset < candidates.length; offset += 200) {
        await options.api.sendMessage({ userId: response.destinationUserId.toString(), text: response.text,
          buttons: candidates.slice(offset, offset + 200).map((candidate, pageIndex) => ({
            text: candidate.name, payload: choicePayload(source.id, offset + pageIndex),
          })) }, signal)
      }
    } else {
      await options.api.sendMessage({ userId: response.destinationUserId.toString(), text: response.text }, signal)
    }

    await options.prisma.maxOutgoingResponse.updateMany({
      where: { id: response.id, deliveredAt: null },
      data: { deliveredAt: (options.now ?? (() => new Date()))() },
    })
    return 'done'
  }
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
