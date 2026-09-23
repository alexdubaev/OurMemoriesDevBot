import { describe, expect, test } from 'bun:test'

import type { AuthenticatedPrincipal, AuthUserRecord } from '../domain/user'
import { BrowserLinkService, hashVerifier } from './browser-link-service'
import type {
  BrowserLinkRepository,
  ProjectUser,
  VerifiedMaxInitData,
} from './ports'

const now = new Date('2026-09-24T12:00:00.000Z')
const user: AuthUserRecord = {
  id: '019c0000-0000-7000-8000-000000000001',
  email: null,
  passwordHash: null,
  displayName: 'MAX User',
  role: 'user',
  createdAt: now,
}
const principal: AuthenticatedPrincipal = {
  id: user.id,
  email: user.email,
  displayName: user.displayName,
  role: user.role,
  createdAt: user.createdAt.toISOString(),
  sessionId: 'max-session-1',
  externalIdentity: {
    id: '019c0000-0000-7000-8000-000000000002',
    provider: 'max',
    subject: '31415926',
  },
}
const projectUser: ProjectUser = (record) => ({
  id: record.id,
  email: record.email,
  displayName: record.displayName,
  role: record.role,
  createdAt: record.createdAt.toISOString(),
})

test('redeem creates a session with request provenance and rejects a reused challenge', async () => {
  const redeemCalls: Array<Parameters<BrowserLinkRepository['redeemBrowserLoginChallenge']>[0]> = []
  let available = true
  const { service, signedPayloads } = createHarness({
    repository: {
      redeemBrowserLoginChallenge: async (input) => {
        redeemCalls.push(input)
        if (!available) return null
        available = false
        return { user, session: { id: 'browser-session-1' } }
      },
    },
  })

  await expect(
    service.redeem('challenge-1', 'verifier-1', {
      userAgent: 'Mozilla/5.0 synthetic',
      ipAddress: '203.0.113.10',
    }),
  ).resolves.toMatchObject({
    accessToken: 'access-token',
    refreshTokenToSet: 'refresh-token-1',
    user: { id: user.id },
  })
  expect(redeemCalls[0]).toMatchObject({
    id: 'challenge-1',
    verifierHash: hashVerifier('verifier-1'),
    metadata: {
      userAgent: 'Mozilla/5.0 synthetic',
      ipAddress: '203.0.113.10',
    },
  })
  expect(signedPayloads).toEqual([{ sub: user.id, sessionId: 'browser-session-1' }])

  await expect(
    service.redeem('challenge-1', 'verifier-1', {}),
  ).rejects.toMatchObject({ kind: 'browser_link_invalid' })
  expect(redeemCalls).toHaveLength(2)
})

test('redeem hashes the presented verifier, so a wrong verifier cannot consume a challenge', async () => {
  const redeemCalls: Array<Parameters<BrowserLinkRepository['redeemBrowserLoginChallenge']>[0]> = []
  const { service } = createHarness({
    repository: {
      redeemBrowserLoginChallenge: async (input) => {
        redeemCalls.push(input)
        return input.verifierHash === hashVerifier('expected-verifier')
          ? { user, session: { id: 'browser-session-1' } }
          : null
      },
    },
  })

  await expect(service.redeem('challenge-1', 'wrong-verifier', {})).rejects.toMatchObject({
    kind: 'browser_link_invalid',
  })
  expect(redeemCalls[0]?.verifierHash).toBe(hashVerifier('wrong-verifier'))
})

test('approve requires a signed MAX subject and browser start parameter for the same challenge', async () => {
  const approvals: Array<Parameters<BrowserLinkRepository['approveBrowserLoginChallenge']>[0]> = []
  let verified: VerifiedMaxInitData = {
    identity: {
      provider: 'max',
      subject: '31415926',
      displayName: 'MAX User',
    },
    replayFingerprintHash: 'a'.repeat(64),
    authDateSeconds: Math.floor(now.getTime() / 1000),
    startParam: 'browser_challenge-1',
  }
  const { service } = createHarness({
    verifyInitData: () => verified,
    repository: {
      approveBrowserLoginChallenge: async (input) => {
        approvals.push(input)
        return 'approved'
      },
    },
  })

  await expect(
    service.approve('challenge-1', principal, 'signed-max-data', true),
  ).resolves.toEqual({ approved: true })
  expect(approvals).toEqual([{
    id: 'challenge-1',
    userId: user.id,
    externalIdentityId: principal.externalIdentity!.id,
    now,
  }])

  verified = { ...verified, startParam: 'browser-other-challenge' }
  await expect(
    service.approve('challenge-1', principal, 'signed-max-data', true),
  ).rejects.toMatchObject({ kind: 'browser_link_invalid' })

  verified = {
    ...verified,
    startParam: 'browser_challenge-1',
    identity: { ...verified.identity, subject: '27182818' },
  }
  await expect(
    service.approve('challenge-1', principal, 'signed-max-data', true),
  ).rejects.toMatchObject({ kind: 'browser_link_invalid' })
  expect(approvals).toHaveLength(1)
})

test('approve maps an expired or missing challenge to the safe browser-link error', async () => {
  let outcome: 'expired' | 'missing' = 'expired'
  const { service } = createHarness({
    repository: {
      approveBrowserLoginChallenge: async () => outcome,
    },
  })

  await expect(
    service.approve('challenge-1', principal, 'signed-max-data', true),
  ).rejects.toMatchObject({ kind: 'browser_link_invalid' })

  outcome = 'missing'
  await expect(
    service.approve('challenge-1', principal, 'signed-max-data', true),
  ).rejects.toMatchObject({ kind: 'browser_link_invalid' })
})

test('approve rejects an invalid MAX signature and non explicit or non MAX approvals', async () => {
  const { service } = createHarness({
    verifyInitData: () => {
      throw new Error('invalid signature')
    },
  })

  await expect(
    service.approve('challenge-1', principal, 'invalid-max-data', true),
  ).rejects.toMatchObject({ kind: 'browser_link_invalid' })
  await expect(
    service.approve('challenge-1', principal, 'signed-max-data', false),
  ).rejects.toMatchObject({ kind: 'browser_link_invalid' })
  await expect(
    service.approve('challenge-1', { ...principal, externalIdentity: null }, 'signed-max-data', true),
  ).rejects.toMatchObject({ kind: 'browser_link_invalid' })
})

test('getStatus passes the verifier hash and clock time to the repository, including expiry state', async () => {
  const statusCalls: Array<Parameters<BrowserLinkRepository['getBrowserLoginChallenge']>[0]> = []
  const { service } = createHarness({
    repository: {
      getBrowserLoginChallenge: async (input) => {
        statusCalls.push(input)
        return { state: 'expired', expiresAt: new Date('2026-09-24T12:05:00.000Z') }
      },
    },
  })

  await expect(service.getStatus('challenge-1', 'verifier-1')).resolves.toEqual({
    state: 'expired',
    expiresAt: new Date('2026-09-24T12:05:00.000Z'),
  })
  expect(statusCalls).toEqual([{
    id: 'challenge-1',
    verifierHash: hashVerifier('verifier-1'),
    now,
  }])
  expect(service.getStatus('challenge-1', undefined)).toBeNull()
})

function createHarness(overrides: {
  repository?: Partial<BrowserLinkRepository>
  verifyInitData?: (rawInitData: string) => VerifiedMaxInitData
} = {}) {
  const signedPayloads: Array<{ sub: string; sessionId: string }> = []
  const repository: BrowserLinkRepository = {
    createBrowserLoginChallenge: async () => undefined,
    getBrowserLoginChallenge: async () => null,
    approveBrowserLoginChallenge: async () => 'approved',
    redeemBrowserLoginChallenge: async () => ({ user, session: { id: 'browser-session-1' } }),
    ...overrides.repository,
  }
  const service = new BrowserLinkService({
    accessTokens: {
      sign: async (payload) => {
        signedPayloads.push(payload)
        return 'access-token'
      },
      verify: async () => ({ sub: user.id, sessionId: 'browser-session-1' }),
    },
    clock: { now: () => now },
    projectUser,
    refreshTokenTtlDays: 30,
    refreshTokens: {
      create: () => 'refresh-token-1',
      hash: (token) => `hash:${token}`,
      familyHash: (token) => `family:${token}`,
      rotate: (token) => `rotated:${token}`,
    },
    repository,
    verifyInitData: overrides.verifyInitData ?? (() => ({
      identity: {
        provider: 'max',
        subject: '31415926',
        displayName: 'MAX User',
      },
      replayFingerprintHash: 'a'.repeat(64),
      authDateSeconds: Math.floor(now.getTime() / 1000),
      startParam: 'browser_challenge-1',
    })),
  })
  return { service, signedPayloads }
}
