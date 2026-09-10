import { describe, expect, test } from 'bun:test'

import { CaptionService } from './captions'

describe('CaptionService', () => {
  test('consumes only the requester\'s exact reply and keeps ordinary text outside the caption flow', async () => {
    const calls: string[] = []
    const service = new CaptionService({
      async consumeReply(input) {
        calls.push(`${input.chatId}:${input.replyToMessageId}:${input.text}`)
        return input.replyToMessageId === 'prompt-1' ? { kind: 'updated' as const } : { kind: 'not_found' as const }
      },
      async cancel() { return false },
    })

    await expect(service.consumeReply({ familyId: 'family-a', userId: 'user-a', chatId: 'chat-a', replyToMessageId: 'prompt-1', text: 'Новая подпись' }))
      .resolves.toEqual({ kind: 'updated' })
    await expect(service.consumeReply({ familyId: 'family-a', userId: 'user-a', chatId: 'chat-a', replyToMessageId: null, text: 'Обычная заметка' }))
      .resolves.toEqual({ kind: 'not_applicable' })
    expect(calls).toEqual(['chat-a:prompt-1:Новая подпись'])
  })
})
