import { describe, expect, test } from 'bun:test'

import type { BackendRuntime } from '../../../runtime'
import { TerminalTaskError } from '../../../outbox'
import { createMaxTaskProcessor } from './process-task'

const inboxId = '019c0000-0000-7000-8000-000000000001'

describe('MAX task processor payload boundary', () => {
  test('routes bot_started payloads only after classifying a complete invite token', async () => {
    const cases = [
      { payload: null, expected: 'Добро пожаловать в memoLy. Откройте приложение, чтобы продолжить.', resolution: null, resolverCalls: 0 },
      { payload: 'campaign_abc', expected: 'Добро пожаловать в memoLy. Откройте приложение, чтобы продолжить.', resolution: null, resolverCalls: 0 },
      { payload: `invite_${'A'.repeat(32)}`, expected: 'Приглашение получено. Откройте приложение memoLy, чтобы присоединиться.', resolution: 'active' as const, resolverCalls: 1 },
      { payload: `invite_${'B'.repeat(32)}`, expected: 'Это приглашение недействительно или устарело. Откройте приложение memoLy, чтобы продолжить.', resolution: 'invalid' as const, resolverCalls: 1 },
      { payload: 'invite_short', expected: 'Это приглашение недействительно или устарело. Откройте приложение memoLy, чтобы продолжить.', resolution: null, resolverCalls: 0 },
    ]

    for (const fixture of cases) {
      let resolverCalls = 0
      let responseText: string | undefined
      const process = createMaxTaskProcessor({
        runtime: startedRuntime(() => {
          resolverCalls += 1
          return fixture.resolution ?? 'invalid'
        }, (text) => { responseText = text }),
        crypto: { decrypt: () => ({ kind: 'bot_started', chatId: '88', userId: '77', occurredAt: '2026-09-15T10:00:00.000Z', payload: fixture.payload }) } as never,
        resolveInviteStart: async (rawToken) => {
          resolverCalls += 1
          expect(rawToken).not.toContain('invite_')
          return fixture.resolution ?? 'invalid'
        },
      })

      await expect(process({ inboxId })).resolves.toBe('done')
      expect(responseText).toBe(fixture.expected)
      expect(resolverCalls).toBe(fixture.resolverCalls)
    }
  })

  test('rejects a payload unless it contains exactly one usable inbox UUID', async () => {
    const process = createMaxTaskProcessor({
      runtime: {} as BackendRuntime,
      crypto: {} as never,
    })

    for (const payload of [null, {}, { inboxId: 'not-a-uuid' }, { inboxId, sourceId: inboxId }, { inboxId: 12 }]) {
      await expect(process(payload)).rejects.toBeInstanceOf(TerminalTaskError)
    }
  })

  test('skips an inbox that already reached its terminal state', async () => {
    const process = createMaxTaskProcessor({
      runtime: {
        prisma: { maxInbox: { findUnique: async () => ({ status: 'processed' }) } },
      } as unknown as BackendRuntime,
      crypto: {} as never,
    })

    expect(await process({ inboxId })).toBe('skipped')
  })

  test('terminally denies malformed MAX channel callback UUIDs without querying a decision', async () => {
    let callbackLookups = 0
    let inboxFinished = 0
    let callbackAnswer = ''
    const prisma = {
      maxInbox: {
        findUnique: async () => ({
          id: inboxId, status: 'accepted', processedAt: null,
          encryptedPayload: new Uint8Array([1]), encryptionIv: new Uint8Array([2]), encryptionAuthTag: new Uint8Array([3]), source: null,
        }),
        updateMany: async () => { inboxFinished += 1; return { count: 1 } },
      },
      $transaction: async (callback: (tx: any) => Promise<unknown>) => callback({ maxInbox: {
        updateMany: async () => { inboxFinished += 1; return { count: 1 } },
      } }),
    }
    const process = createMaxTaskProcessor({
      runtime: { prisma } as unknown as BackendRuntime,
      crypto: { decrypt: () => ({ kind: 'family_choice', payload: `max_channel:${'-'.repeat(36)}:select:0`, userId: '77', callbackId: 'malformed' }) } as never,
      processChannelCallback: async () => { callbackLookups += 1; return false },
      api: { answerCallback: async (_id: string, text: string) => { callbackAnswer = text } } as never,
    })
    expect(await process({ inboxId })).toBe('done')
    expect(callbackLookups).toBe(1)
    expect(inboxFinished).toBe(1)
    expect(callbackAnswer).toBe('Этот выбор недоступен.')
  })

  test('denies an ambiguous two-family admission without invoking publication', async () => {
    let sourceTransitionCount = 0
    let responseKind: string | undefined
    const source = { id: inboxId, inboxId, senderSubject: '77', status: 'accepted', plannedMemoryId: inboxId }
    const runtime = {
      prisma: {
        maxInbox: { findUnique: async () => ({
          id: inboxId, status: 'accepted', processedAt: null,
          encryptedPayload: new Uint8Array(), encryptionIv: new Uint8Array(), encryptionAuthTag: new Uint8Array(), source,
        }) },
        externalIdentity: { findUnique: async () => ({ user: { id: '019c0000-0000-7000-8000-000000000002', familyMemberships: [
          { familyId: '019c0000-0000-7000-8000-000000000003', family: { children: [{ id: '019c0000-0000-7000-8000-000000000004' }] } },
          { familyId: '019c0000-0000-7000-8000-000000000005', family: { children: [{ id: '019c0000-0000-7000-8000-000000000006' }] } },
        ] } }) },
        $transaction: async (callback: (tx: any) => Promise<unknown>) => callback({
          maxSource: { updateMany: async () => { sourceTransitionCount += 1; return { count: 1 } } },
          maxInbox: { updateMany: async () => ({ count: 1 }) },
          maxOutgoingResponse: { upsert: async ({ create }: { create: { kind: string } }) => { responseKind = create.kind; return { id: inboxId } } },
          taskOutbox: { createMany: async () => ({ count: 1 }) },
        }),
      },
    } as unknown as BackendRuntime
    const process = createMaxTaskProcessor({
      runtime,
      crypto: { decrypt: () => ({ kind: 'message_created', senderId: '77', recipientId: '900', messageId: 'message', occurredAt: '2026-09-14T10:00:00.000Z', text: 'Ambiguous', hasAttachments: false }) } as never,
    })

    expect(await process({ inboxId })).toBe('done')
    expect(sourceTransitionCount).toBe(1)
    expect(responseKind).toBe('denied')
  })
})

function startedRuntime(
  _unusedResolver: () => Promise<'active' | 'invalid'> | 'active' | 'invalid',
  capture: (text: string) => void,
) {
  return {
    prisma: {
      maxInbox: { findUnique: async () => ({ id: inboxId, status: 'accepted', processedAt: null, encryptedPayload: new Uint8Array([1]), encryptionIv: new Uint8Array([2]), encryptionAuthTag: new Uint8Array([3]), source: null }) },
      $transaction: async (callback: (tx: any) => Promise<unknown>) => callback({
        maxInbox: { updateMany: async () => ({ count: 1 }) },
        maxOutgoingResponse: { upsert: async ({ create }: { create: { text: string } }) => { capture(create.text); return { id: inboxId } } },
        taskOutbox: { createMany: async () => ({ count: 1 }) },
      }),
    },
  } as unknown as BackendRuntime
}
