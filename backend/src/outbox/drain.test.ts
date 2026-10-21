import { expect, spyOn, test } from 'bun:test'

import { drainTaskOutbox } from './drain'
import { TerminalTaskError } from './errors'
import { createFakeOutboxRuntime, taskRow, type FakeTaskRow } from './fake-outbox-prisma'
import type { TaskHandlerRegistry } from './handlers'

const now = new Date('2026-08-09T12:00:00.000Z')

function registry(run: TaskHandlerRegistry['string']['run'], entry: Partial<{ maxAttempts: number }> = {}) {
  return { 'test:work': { run, ...entry } } satisfies TaskHandlerRegistry
}

async function drain(rows: FakeTaskRow[], handlers: TaskHandlerRegistry, options = {}) {
  return drainTaskOutbox(createFakeOutboxRuntime(rows), {
    clock: () => now,
    handlers,
    now,
    random: () => 0,
    ...options,
  })
}

test('handler outcomes are reflected in drain metrics', async () => {
  const rows = [taskRow({ id: 'skip', type: 'test:work' }), taskRow({ id: 'done', type: 'test:work' })]
  let calls = 0

  const metrics = await drain(rows, registry(async () => ++calls === 1 ? 'skipped' : undefined))

  expect(metrics).toMatchObject({ done: 1, skipped: 1 })
})

test('a terminal handler error is not retried', async () => {
  const rows = [taskRow({ id: 'bad', type: 'test:work' })]
  const error = spyOn(console, 'error').mockImplementation(() => {})

  try {
    const metrics = await drain(rows, registry(async () => {
      throw new TerminalTaskError('payload will never validate')
    }))

    expect(metrics).toMatchObject({ terminalFailed: 1 })
    expect(rows[0]).toMatchObject({ attempts: 1, status: 'failed' })
  } finally {
    error.mockRestore()
  }
})

test('the handler is told when this is its final attempt', async () => {
  const rows = [taskRow({ id: 'last', type: 'test:work', attempts: 1 })]
  const finalAttempts: boolean[] = []

  await drain(rows, registry(async ({ finalAttempt }) => { finalAttempts.push(finalAttempt) }, { maxAttempts: 2 }))

  expect(finalAttempts).toEqual([true])
})

test('the pass budget stops between tasks after finishing the active handler', async () => {
  const rows = [1, 2, 3].map((n) => taskRow({ id: `row-${n}`, type: 'test:work' }))
  let ran = 0
  let elapsed = 0
  const wallClock = spyOn(Date, 'now').mockImplementation(() => elapsed)
  try {
    const metrics = await drain(rows, registry(async () => { ran += 1; elapsed += 10 }), { maxRuntimeMs: 15 })
    expect(ran).toBeGreaterThan(0)
    expect(ran).toBeLessThan(rows.length)
    expect(metrics.backlog).toBeGreaterThan(0)
    expect(rows.filter((row) => row.status === 'done')).toHaveLength(ran)
  } finally {
    wallClock.mockRestore()
  }
})

test('an uncooperative handler cannot hold up later outbox work', async () => {
  const rows = [
    taskRow({ id: 'stuck', type: 'test:work', payload: { hang: true } }),
    taskRow({ id: 'next', type: 'test:work', payload: { hang: false } }),
  ]
  let release: (() => void) | undefined
  const error = spyOn(console, 'error').mockImplementation(() => {})

  try {
    const metrics = await drainTaskOutbox(createFakeOutboxRuntime(rows), {
      clock: () => now,
      handlers: {
        'test:work': {
          deadlineMs: 20,
          run: async ({ payload }) => (payload as { hang: boolean }).hang
            ? new Promise<undefined>((resolve) => { release = () => resolve(undefined) })
            : undefined,
        },
      },
      now,
      random: () => 0,
    })

    expect(metrics).toMatchObject({ claimed: 2, done: 1, transientFailed: 1 })
    expect(rows.find((row) => row.id === 'stuck')?.status).toBe('pending')
    expect(rows.find((row) => row.id === 'next')?.status).toBe('done')
  } finally {
    release?.()
    error.mockRestore()
  }
}, 5_000)

test('the oldest pending age is available for backlog alerting', async () => {
  const rows = [taskRow({ id: 'old', type: 'test:work', scheduledFor: new Date(now.getTime() - 300_000) })]

  const metrics = await drain(rows, registry(async () => undefined), { limit: 1, maxRuntimeMs: 0 })

  expect(metrics).toMatchObject({ backlog: 1, claimed: 0, oldestPendingAgeSeconds: 300 })
})
