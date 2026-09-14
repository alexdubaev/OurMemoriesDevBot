import { describe, expect, test } from 'bun:test'

import type { BackendRuntime } from '../../../runtime'
import { TerminalTaskError } from '../../../outbox'
import { createMaxTaskProcessor } from './process-task'

const inboxId = '019c0000-0000-7000-8000-000000000001'

describe('MAX task processor payload boundary', () => {
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
})
