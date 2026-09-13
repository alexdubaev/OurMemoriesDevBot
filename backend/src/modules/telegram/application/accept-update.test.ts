import { expect, test } from 'bun:test'

import { createAcceptTelegramUpdate } from './accept-update'
import type { TelegramAcceptRepository } from './ports'
import type { TelegramInboundEvent } from '../domain/inbound-event'

const pointer = 'watch_abcdefghijklmnopqrstuvwxyzABCDEF'

test('delivers a newly accepted valid video pointer immediately without queueing an inbox task', async () => {
  let queueInboxTask: boolean | undefined
  const delivered: string[] = []
  const accept = createAcceptTelegramUpdate({
    botId: 1n,
    repository: repository(async (input) => { queueInboxTask = input.queueInboxTask; return { inboxId: 'inbox-1', duplicate: false } }),
    api: { sendMessage: async () => undefined },
    encrypt: encrypted,
    onVideoNavigation: async (inboxId) => { delivered.push(inboxId) },
  })

  await accept(start(pointer))

  expect(queueInboxTask).toBe(false)
  expect(delivered).toEqual(['inbox-1'])
})

test('delivers a newly accepted invite start immediately while retaining its outbox fallback', async () => {
  let queueInboxTask: boolean | undefined
  const delivered: string[] = []
  const accept = createAcceptTelegramUpdate({
    botId: 1n,
    repository: repository(async (input) => { queueInboxTask = input.queueInboxTask; return { inboxId: 'inbox-invite', duplicate: false } }),
    api: { sendMessage: async () => undefined },
    encrypt: encrypted,
    onInviteStart: async (inboxId) => { delivered.push(inboxId) },
  })

  await accept(start(`invite_${'a'.repeat(43)}`))

  expect(queueInboxTask).toBe(true)
  expect(delivered).toEqual(['inbox-invite'])
})

test('preserves a durable invite outbox fallback when immediate delivery fails', async () => {
  let queueInboxTask: boolean | undefined
  const accept = createAcceptTelegramUpdate({
    botId: 1n,
    repository: repository(async (input) => { queueInboxTask = input.queueInboxTask; return { inboxId: 'inbox-invite', duplicate: false } }),
    api: { sendMessage: async () => undefined },
    encrypt: encrypted,
    onInviteStart: async () => { throw new Error('synthetic Telegram failure') },
  })

  await expect(accept(start(`invite_${'b'.repeat(43)}`))).resolves.toEqual({ inboxId: 'inbox-invite', duplicate: false })

  expect(queueInboxTask).toBe(true)
})

test('keeps invalid and duplicate start commands out of the immediate delivery path', async () => {
  const queued: boolean[] = []
  const delivered: string[] = []
  const accept = createAcceptTelegramUpdate({
    botId: 1n,
    repository: repository(async (input) => {
      queued.push(input.queueInboxTask ?? true)
      return { inboxId: 'inbox-2', duplicate: input.event.kind === 'command' && input.event.argument === pointer }
    }),
    api: { sendMessage: async () => undefined },
    encrypt: encrypted,
    onVideoNavigation: async (inboxId) => { delivered.push(inboxId) },
  })

  await accept(start('watch_invalid'))
  await accept(start(pointer))

  expect(queued).toEqual([true, false])
  expect(delivered).toEqual([])
})

function repository(accept: TelegramAcceptRepository['accept']): TelegramAcceptRepository {
  return { findAdmission: async () => null, accept }
}

function encrypted() {
  return { ciphertext: new Uint8Array(), iv: new Uint8Array(), authTag: new Uint8Array() }
}

function start(argument: string): Extract<TelegramInboundEvent, { kind: 'command' }> {
  return { kind: 'command', updateId: '1', chatId: '1', messageId: '1', senderId: '1', occurredAt: new Date().toISOString(), command: 'start', argument }
}
