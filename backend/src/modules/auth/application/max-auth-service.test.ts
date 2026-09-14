import { describe, expect, test } from 'bun:test'

import { AuthFailure } from '../domain/errors'
import type { AuthUserRecord } from '../domain/user'
import type { VerifiedMaxInitData } from './ports'
import { MaxAuthService } from './max-auth-service'

const now = new Date('2026-09-09T12:00:00.000Z')
const user: AuthUserRecord = {
  id: '019c0000-0000-7000-8000-000000000001',
  email: null,
  passwordHash: null,
  displayName: 'Max User',
  role: 'user',
  createdAt: now,
}

function createHarness(
  state: 'issued' | 'same_session' | 'replayed',
  verifyInitData: () => VerifiedMaxInitData = () => ({
    identity: {
      provider: 'max',
      subject: '31415926',
      displayName: 'Max User',
    },
    replayFingerprintHash: 'b'.repeat(64),
  }),
) {
  const exchanges: unknown[] = []
  const service = new MaxAuthService({
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
      exchangeMaxIdentity: async (input) => {
        exchanges.push(input)
        if (state === 'replayed') return { state }
        return {
          state,
          session: { id: state === 'issued' ? 'session-new' : 'session-existing' },
          user,
        }
      },
    },
    verifyInitData,
  })

  return { exchanges, service }
}

describe('MaxAuthService', () => {
  test('creates an application session from a verified MAX identity', async () => {
    const { exchanges, service } = createHarness('issued')

    await expect(service.exchange('signed-init-data', undefined, {})).resolves.toEqual({
      accessToken: `access:${user.id}:session-new`,
      refreshTokenToSet: 'new-refresh-token',
      user: {
        id: user.id,
        email: null,
        displayName: 'Max User',
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
        'max_init_data_replayed',
        'MAX authorization data was already used; reopen the Mini App',
      ),
    )
  })

  test('maps verifier and configuration failures to one safe MAX authentication error', async () => {
    const { service } = createHarness('issued', () => { throw new Error('MAX_BOT_TOKEN=do-not-leak') })

    await expect(service.exchange('signed-init-data', undefined, {})).rejects.toEqual(
      new AuthFailure('max_init_data_invalid', 'MAX authorization data is invalid or expired'),
    )
  })
})
