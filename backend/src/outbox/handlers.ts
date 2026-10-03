import { TerminalTaskError } from './errors'
import type { TaskHandlerEntry } from './types'

export type TaskHandlerRegistry = Record<string, TaskHandlerEntry>

/**
 * Every kind of durable one-off work this backend knows how to do.
 *
 * Not a second job registry. `jobs.ts` answers "what recurring work exists"; this answers "what
 * kinds of queued work exist". A task type is never scheduled - one job, `outbox:drain`, runs
 * every type.
 *
 * **Do not statically import `../modules/*` or `../generated/*` here.** The API process imports
 * this registry to validate a task type at enqueue time, and a top-level module import would
 * drag that module's SDKs into every process that can enqueue. Handlers reach their module with
 * `await import()` inside `run`, which also keeps a module out of the runs that do not use it.
 */
export const taskHandlers = {
  'max:process': {
    maxAttempts: 5,
    deadlineMs: 15 * 60_000,
    retryDelayMs: providerRetryDelay,
    run: async ({ payload, signal }, runtime) => {
      const { createMaxTasks } = await import('../modules/max')
      return createMaxTasks(runtime).process(payload, signal)
    },
  },
  'max:deliver-response': {
    maxAttempts: 5,
    deadlineMs: 30_000,
    retryDelayMs: providerRetryDelay,
    run: async ({ payload, signal }, runtime) => {
      const { createMaxTasks } = await import('../modules/max')
      return createMaxTasks(runtime).deliverResponse(payload, signal)
    },
  },
  'max:backup-media': {
    maxAttempts: 5,
    deadlineMs: 15 * 60_000,
    retryDelayMs: providerRetryDelay,
    run: async ({ finalAttempt, payload, signal }, runtime) => {
      const { createMaxTasks } = await import('../modules/max')
      return createMaxTasks(runtime).backupMedia(payload, signal, finalAttempt)
    },
  },
  'max:video-poster': {
    maxAttempts: 5,
    deadlineMs: 90_000,
    retryDelayMs: providerRetryDelay,
    run: async ({ payload, signal }, runtime) => {
      const { createMaxTasks } = await import('../modules/max')
      return createMaxTasks(runtime).videoPoster(payload, signal)
    },
  },
  'telegram:process': {
    maxAttempts: 5,
    deadlineMs: 90_000,
    retryDelayMs: (error, attempt) => {
      const retryAfter = typeof error === 'object' && error !== null && 'retryAfterSeconds' in error
        ? (error as { retryAfterSeconds?: unknown }).retryAfterSeconds
        : undefined
      if (typeof retryAfter === 'number' && retryAfter > 0) return retryAfter * 1_000
      return [5_000, 30_000, 120_000, 600_000][Math.min(attempt - 1, 3)]!
    },
    run: async ({ payload, signal }, runtime) => {
      const { createTelegramTasks } = await import('../modules/telegram')
      await createTelegramTasks(runtime).process(payload, signal)
    },
  },
  'telegram:navigation-reply:cleanup': {
    // Cleanup is intentionally one-shot best effort: retaining one short service message is
    // harmless, while retrying it indefinitely would turn a secondary UX action into a queue
    // poisoner. The handler itself treats an already-deleted message as a normal completion.
    maxAttempts: 1,
    deadlineMs: 30_000,
    run: async ({ payload, now }, runtime) => {
      const navigationReplyId = (payload as { navigationReplyId?: unknown })?.navigationReplyId
      if (typeof navigationReplyId !== 'string' || !/^[0-9a-f-]{36}$/i.test(navigationReplyId)) {
        throw new TerminalTaskError('Task payload is missing a usable Telegram navigation reply id')
      }
      const { createTelegramTasks } = await import('../modules/telegram')
      return createTelegramTasks(runtime).cleanupNavigationReply({ navigationReplyId, now })
    },
  },
  'media:delete': {
    maxAttempts: 5,
    run: async ({ payload }, runtime) => {
      const mediaId = (payload as { mediaId?: unknown })?.mediaId
      if (typeof mediaId !== 'string' || !/^[0-9a-f-]{36}$/i.test(mediaId)) {
        throw new TerminalTaskError('Task payload is missing a usable media id')
      }
      const { createMediaTasks } = await import('../modules/media')
      await createMediaTasks(runtime).deleteAsset({ mediaId })
    },
  },
  'media:prepare': {
    maxAttempts: 5,
    deadlineMs: 10 * 60_000,
    run: async ({ payload, signal }, runtime) => {
      const mediaId = (payload as { mediaId?: unknown })?.mediaId
      if (typeof mediaId !== 'string' || !/^[0-9a-f-]{36}$/i.test(mediaId)) {
        throw new TerminalTaskError('Task payload is missing a usable media id')
      }
      const { createMediaTasks } = await import('../modules/media')
      await createMediaTasks(runtime).prepareAsset({ mediaId, signal })
    },
  },
  /**
   * The account-dependent half of a password reset: look the address up, mint a token, send it.
   *
   * Five attempts, because the first retry has to clear the 60-second per-account cooldown and
   * still leave room for a provider outage to pass.
   */
  'auth:password-reset': {
    maxAttempts: 5,
    run: async ({ finalAttempt, now, payload, signal }, runtime) => {
      // Validate before building anything: a payload that will never work should fail on its own
      // terms, not from somewhere deep inside a module it had no business constructing.
      const input = emailPayload(payload)
      const { createAuthTasks } = await import('../modules/auth')

      return createAuthTasks(runtime).deliverPasswordReset(input, { finalAttempt, now, signal })
    },
  },
  /** Tells someone their password changed. Nothing to compensate for if it never arrives. */
  'auth:password-changed': {
    maxAttempts: 3,
    run: async ({ payload, signal }, runtime) => {
      const input = emailPayload(payload)
      const { createAuthTasks } = await import('../modules/auth')
      await createAuthTasks(runtime).deliverPasswordChanged(input, signal)
    },
  },
  // This is only a wake-up for a durable, single-flight rebuild controller. Publishing advances
  // desiredRevision and enqueues a unique website:rebuild:<revision> task; short reconciler passes
  // persist/adopt provider deployment state, verify the public artifact revision, and start one
  // follow-up while desiredRevision is newer than publishedRevision. A recurring reconcile job is
  // the repair path, so correctness never depends on reopening this terminal outbox row. The
  // template does not ship that state machine. See docs/BACKGROUND_JOBS.md before implementing.
  //
  // 'website:rebuild': {
  //   maxAttempts: 3,
  //   run: async (_context, runtime) => {
  //     await triggerDeployment(runtime.env)
  //   },
  // },
} satisfies TaskHandlerRegistry

function providerRetryDelay(error: unknown, attempt: number) {
  const retryAfter = typeof error === 'object' && error !== null && 'retryAfterSeconds' in error
    ? (error as { retryAfterSeconds?: unknown }).retryAfterSeconds
    : undefined
  if (typeof retryAfter === 'number' && Number.isFinite(retryAfter) && retryAfter > 0) {
    return Math.min(retryAfter, 86_400) * 1_000
  }
  return [5_000, 30_000, 120_000, 600_000][Math.min(attempt - 1, 3)]!
}

/**
 * A payload is whatever JSON the enqueuing code wrote, so every handler validates its own. A
 * payload that will never be valid is terminal: retrying it four more times changes nothing.
 */
function emailPayload(payload: unknown): { email: string } {
  const email = (payload as { email?: unknown })?.email

  if (typeof email !== 'string' || email.length === 0) {
    throw new TerminalTaskError('Task payload is missing a usable email address')
  }

  return { email }
}

export function taskTypeNames(registry: TaskHandlerRegistry = taskHandlers): string[] {
  return Object.keys(registry)
}

export function isTaskType(value: string, registry: TaskHandlerRegistry = taskHandlers) {
  // `value in registry` would also accept 'constructor', 'toString' and the rest of
  // Object.prototype. Enqueueing one of those would write a row no handler can ever run.
  return Object.hasOwn(registry, value)
}

export function requireTaskHandler(
  value: string,
  registry: TaskHandlerRegistry = taskHandlers,
): TaskHandlerEntry {
  if (!isTaskType(value, registry)) {
    throw new Error(
      `Unknown task type "${value}". Available types: ${taskTypeNames(registry).join(', ') || 'none'}`,
    )
  }

  return registry[value] as TaskHandlerEntry
}
