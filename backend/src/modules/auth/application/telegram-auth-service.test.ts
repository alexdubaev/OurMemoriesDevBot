import { describe, expect, test } from 'bun:test'

import { AuthFailure } from '../domain/errors'
import type { AuthUserRecord } from '../domain/user'
import { TelegramAuthService } from './telegram-auth-service'

const now = new Date('2026-09-09T12:00:00.000Z')
const user: AuthUserRecord = {
  id: '019c0000-0000-7000-8000-000000000001',
  email: null,
  passwordHash: null,
  displayName: 'Александр',
  role: 'user',
  createdAt: now,
}

function createHarness(state: 'issued' | 'same_session' | 'replayed') {
  const exchanges: unknown[] = []
  const service = new TelegramAuthService({
    accessTokens: {
      sign: async ({ sub, sessionId }) => `access:${sub}:${sessionId}`,
      verify: async () => ({ sub: user.id, sessionId: 'session-existing' }),
    },
    clock: { now: () => now },
    projectUser: async (record) => ({
      id: record.id,
      email: record.email,
      displayName: record.displayName,
      role: record.role,
      createdAt: record.createdAt.toISOString(),
    }),
    refreshReuseGraceSeconds: 10,
    refreshTokenTtlDays: 30,
    sessionAbsoluteTtlDays: 90,
    refreshTokens: {
      create: () => 'new-refresh-token',
      hash: (token) => `hash:${token}`,
      familyHash: (token) => `family:${token}`,
      rotate: (token) => token,
    },
    repository: {
      findActiveRefreshSession: async () => ({
        id: 'session-existing',
        userId: user.id,
        user,
        refreshTokenHash: 'hash:current-refresh-token',
        credentialState: 'current',
      }),
      exchangeTelegramIdentity: async (input) => {
        exchanges.push(input)
        if (state === 'replayed') return { state }
        return {
          state,
          session: { id: state === 'issued' ? 'session-new' : 'session-existing' },
          user,
        }
      },
    },
    verifyInitData: () => ({
      identity: {
        provider: 'telegram',
        subject: '99281912',
        displayName: 'Александр',
      },
      replayFingerprintHash: 'a'.repeat(64),
    }),
  })

  return { exchanges, service }
}

describe('TelegramAuthService', () => {
  test('creates an application session from a verified Telegram identity', async () => {
    const { exchanges, service } = createHarness('issued')

    await expect(service.exchange('signed-init-data', undefined, {})).resolves.toEqual({
      accessToken: `access:${user.id}:session-new`,
      refreshTokenToSet: 'new-refresh-token',
      user: {
        id: user.id,
        email: null,
        displayName: 'Александр',
        role: 'user',
        createdAt: now.toISOString(),
      },
    })
    expect(exchanges).toHaveLength(1)
  })

  test('allows a replay only when the caller presents the same active session', async () => {
    const same = createHarness('same_session')
    await expect(
      same.service.exchange('signed-init-data', 'current-refresh-token', {}),
    ).resolves.toMatchObject({
      accessToken: `access:${user.id}:session-existing`,
      refreshTokenToSet: undefined,
    })

    const foreign = createHarness('replayed')
    await expect(
      foreign.service.exchange('signed-init-data', undefined, {}),
    ).rejects.toEqual(
      new AuthFailure(
        'telegram_init_data_replayed',
        'Telegram authorization data was already used; reopen the Mini App',
      ),
    )
  })
})
