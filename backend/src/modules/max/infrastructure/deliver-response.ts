import type { DbClient } from '../../../db'
import { TerminalTaskError } from '../../../outbox'
import type { MaxApiPort } from '../application/ports'

export type MaxResponseDelivery = (payload: unknown, signal?: AbortSignal) => Promise<'done' | 'skipped'>

export function createMaxResponseDelivery(options: {
  prisma: DbClient
  api: MaxApiPort
  now?: () => Date
}): MaxResponseDelivery {
  return async (payload, signal) => {
    const responseId = responsePayload(payload)
    const response = await options.prisma.maxOutgoingResponse.findUnique({ where: { id: responseId } })
    if (!response || response.deliveredAt) return 'skipped'

    await options.api.sendMessage({
      userId: response.destinationUserId.toString(),
      text: response.text,
    }, signal)

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
