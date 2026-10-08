import { expect, test } from 'bun:test'

import type { AuthRepository, ProjectUser } from './ports'
import { AuthService } from './auth-service'

const user = {
  id: 'user-1',
  email: 'user@example.com',
  passwordHash: 'password-hash',
  displayName: null,
  role: 'user' as const,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
}

const projectUser: ProjectUser = async (record) => ({
  id: record.id,
  email: record.email,
  displayName: record.displayName,
  role: record.role,
  createdAt: record.createdAt.toISOString(),
})

const unusedPasswordResetDependencies = {
  passwordResetCooldownSeconds: 60,
  passwordResetNotifier: {
    configured: false,
    isPermanentFailure: () => false,
    sendPasswordChanged: async () => undefined,
    sendPasswordReset: async () => undefined,
  },
  passwordResetTokenTtlMinutes: 30,
  passwordResetTasks: {
    enqueuePasswordReset: async () => undefined,
  },
  passwordResetTokens: {
    create: () => 'r'.repeat(43),
    hash: (token: string) => `hash:${token}`,
  },
  projectUser,
}

const unusedPasswordResetRepository = {
  createPasswordResetToken: async () => false,
  invalidatePasswordResetToken: async () => undefined,
  hasActivePasswordResetToken: async () => false,
  completePasswordReset: async () => null,
}



// Credential reuse after grace and the rotation race are decided by SQL, so they are tested in
// `auth.integration.test.ts` against real Postgres with genuinely concurrent requests. Scripting
// either one through a fake repository only asserts that the fake was called the scripted number
// of times.



function deliveryService({
  invalidated,
  permanent = false,
  stored,
}: {
  invalidated: string[]
  /** Whether the notifier reports its failure as one no retry can fix. */
  permanent?: boolean
  stored: unknown[]
}) {
  const rawToken = 'r'.repeat(43)

  return new AuthService({
    ...unusedPasswordResetDependencies,
    accessTokens: {} as never,
    clock: { now: () => new Date('2026-01-01T00:00:00.000Z') },
    logoutCleanup: async () => undefined,
    passwords: { hash: async () => 'hash', verify: async () => true },
    passwordResetNotifier: {
      configured: true,
      isPermanentFailure: () => permanent,
      sendPasswordChanged: async () => undefined,
      sendPasswordReset: async () => {
        throw new Error('provider unavailable')
      },
    },
    passwordResetTokens: { create: () => rawToken, hash: (token) => `hash:${token}` },
    refreshTokens: {} as never,
    refreshReuseGraceSeconds: 10,
    refreshTokenTtlDays: 30,
    repository: {
      findUserByEmail: async () => user,
      createPasswordResetToken: async (
        input: Parameters<AuthRepository['createPasswordResetToken']>[0],
      ) => {
        stored.push(input)
        return true
      },
      invalidatePasswordResetToken: async ({ tokenHash }: { tokenHash: string }) => {
        invalidated.push(tokenHash)
      },
    } as unknown as AuthRepository,
    sessionAbsoluteTtlDays: 90,
  })
}

test('a transient delivery failure leaves the reset link alive for the next attempt', async () => {
  // The old behaviour killed the token on the first hiccup, so one flaky provider call cost the
  // user their link even though the outbox was about to try again.
  const invalidated: string[] = []
  const stored: unknown[] = []
  const now = new Date('2026-01-01T00:00:00.000Z')

  await expect(
    deliveryService({ invalidated, stored }).deliverPasswordReset(
      { email: user.email },
      { finalAttempt: false, now, signal: new AbortController().signal },
    ),
  ).rejects.toThrow('provider unavailable')

  expect(stored).toEqual([
    {
      userId: user.id,
      tokenHash: `hash:${'r'.repeat(43)}`,
      expiresAt: new Date('2026-01-01T00:30:00.000Z'),
      now,
      createdAfter: new Date('2025-12-31T23:59:00.000Z'),
    },
  ])
  expect(invalidated).toEqual([])
})

test('the last delivery attempt invalidates the token before reporting failure', async () => {
  const invalidated: string[] = []
  const stored: unknown[] = []

  await expect(
    deliveryService({ invalidated, stored }).deliverPasswordReset(
      { email: user.email },
      {
        finalAttempt: true,
        now: new Date('2026-01-01T00:00:00.000Z'),
        signal: new AbortController().signal,
      },
    ),
  ).rejects.toThrow('provider unavailable')

  // No more attempts are coming, so a token nobody can ever receive must not stay live.
  expect(invalidated).toEqual([`hash:${'r'.repeat(43)}`])
})

test('a permanent rejection invalidates the token on the first attempt, not the last', async () => {
  // The drain decides a task is terminal only after the handler returns, so `finalAttempt` is
  // still false here and always will be. Waiting for it would leave a live token behind for a
  // link the provider has already refused to deliver.
  const invalidated: string[] = []
  const stored: unknown[] = []

  await expect(
    deliveryService({ invalidated, permanent: true, stored }).deliverPasswordReset(
      { email: user.email },
      {
        finalAttempt: false,
        now: new Date('2026-01-01T00:00:00.000Z'),
        signal: new AbortController().signal,
      },
    ),
  ).rejects.toThrow('provider unavailable')

  expect(invalidated).toEqual([`hash:${'r'.repeat(43)}`])
})




test('an unknown address costs the same password work as a registered one', async () => {
  const verifiedAgainst: string[] = []
  const passwords = {
    hash: async () => 'decoy-password-hash',
    verify: async (_password: string, passwordHash: string) => {
      verifiedAgainst.push(passwordHash)
      return false
    },
  }
  const service = new AuthService({
    ...unusedPasswordResetDependencies,
    accessTokens: {
      sign: async () => 'access-token',
      verify: async () => ({ sub: user.id, email: user.email, sessionId: 'session-1' }),
    },
    clock: { now: () => new Date('2026-01-01T00:00:00.000Z') },
    logoutCleanup: async () => undefined,
    passwords,
    refreshReuseGraceSeconds: 10,
    refreshTokenTtlDays: 30,
    sessionAbsoluteTtlDays: 90,
    refreshTokens: {
      create: () => 'refresh-token',
      hash: (token) => `hash:${token}`,
      familyHash: (token) => `family:${token}`,
      rotate: (token) => `next:${token}`,
    },
    repository: {
      ...unusedPasswordResetRepository,
      findUserByEmail: async () => null,
    } as unknown as AuthRepository,
  })

  await expect(
    service.login({ email: 'nobody@example.com', password: 'password123' }, {}),
  ).rejects.toThrow('Invalid email or password')

  // Without this the response time answers the question the 401 body refuses to answer.
  expect(verifiedAgainst).toHaveLength(1)
  expect(verifiedAgainst[0]).not.toBe(user.passwordHash)
})
