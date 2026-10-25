import { describe, expect, test } from 'bun:test'

import { createMaxHostBridge, readMaxInviteLaunch } from '../src/platform/max/host-bridge'

const signedToken = 's'.repeat(43)
const unsafeToken = 'u'.repeat(43)
const documentedToken = 'd'.repeat(43)
const legacyToken = 'l'.repeat(43)

function bridge({
  initData = 'user=%7B%7D',
  unsafeStartParam,
  search = '',
}: {
  initData?: string
  unsafeStartParam?: unknown
  search?: string
} = {}) {
  return createMaxHostBridge({
    WebApp: {
      initData,
      initDataUnsafe: unsafeStartParam === undefined ? {} : { start_param: unsafeStartParam },
      version: '1.0',
      ready() {},
    },
    location: { search },
  })
}

describe('MAX invite launch parameter precedence', () => {
  test('uses signed initData start_param ahead of conflicting unsigned and query hints', () => {
    expect(bridge({
      initData: `user=%7B%7D&start_param=invite_${signedToken}`,
      unsafeStartParam: `invite_${unsafeToken}`,
      search: `?WebAppStartParam=invite_${documentedToken}&startapp=invite_${legacyToken}`,
    }).inviteToken()).toBe(signedToken)
  })

  test('does not fall through a present empty, duplicate, or non-invite signed value', () => {
    for (const startParam of ['', `invite_${signedToken}&start_param=invite_${unsafeToken}`, 'browser_123']) {
      expect(bridge({
        initData: `user=%7B%7D&start_param=${startParam}`,
        unsafeStartParam: `invite_${unsafeToken}`,
        search: `?WebAppStartParam=invite_${documentedToken}&startapp=invite_${legacyToken}`,
      }).inviteToken()).toBeNull()
    }
  })

  test('uses initDataUnsafe.start_param before the documented query and legacy carriers', () => {
    expect(bridge({
      unsafeStartParam: `invite_${unsafeToken}`,
      search: `?WebAppStartParam=invite_${documentedToken}&startapp=invite_${legacyToken}`,
    }).inviteToken()).toBe(unsafeToken)
  })

  test('does not fall through a present empty unsafe start_param', () => {
    expect(bridge({
      unsafeStartParam: '',
      search: `?WebAppStartParam=invite_${documentedToken}&startapp=invite_${legacyToken}`,
    }).inviteToken()).toBeNull()
  })

  test('marks a lower invite hint invalid when an empty or ambiguous higher carrier masks it', () => {
    const maskedLaunches = [
      bridge({
        initData: 'user=%7B%7D&start_param=',
        search: `?WebAppStartParam=invite_${documentedToken}`,
      }),
      bridge({
        unsafeStartParam: '',
        search: `?WebAppStartParam=invite_${documentedToken}`,
      }),
      bridge({ search: `?WebAppStartParam=&startapp=invite_${legacyToken}` }),
      bridge({
        initData: 'user=%7B%7D&start_param=browser_123&start_param=other_flow',
        search: `?WebAppStartParam=invite_${documentedToken}`,
      }),
    ]

    for (const maxBridge of maskedLaunches) {
      expect(maxBridge.inviteLaunch?.()).toEqual({ kind: 'invalid' })
      expect(maxBridge.inviteToken()).toBeNull()
    }
  })

  test('uses WebAppStartParam ahead of legacy startapp when higher-priority values are absent', () => {
    expect(bridge({ search: `?WebAppStartParam=invite_${documentedToken}&startapp=invite_${legacyToken}` }).inviteToken())
      .toBe(documentedToken)
  })

  test('does not fall through a present empty or duplicate WebAppStartParam', () => {
    expect(bridge({ search: `?WebAppStartParam=&startapp=invite_${legacyToken}` }).inviteToken()).toBeNull()
    expect(bridge({ search: `?WebAppStartParam=invite_${documentedToken}&WebAppStartParam=invite_${legacyToken}&startapp=invite_${legacyToken}` }).inviteToken())
      .toBeNull()
  })

  test('retains the legacy startapp invitation carrier when supported fields are absent', () => {
    expect(bridge({ search: `?startapp=invite_${legacyToken}` }).inviteToken()).toBe(legacyToken)
  })

  test('bridge launch parsing uses its captured MAX WebApp and the live location', () => {
    const host = {
      WebApp: { initData: `user=%7B%7D&start_param=invite_${signedToken}`, version: '1.0', ready() {} },
      location: { search: '' },
    }
    const maxBridge = createMaxHostBridge(host)
    host.WebApp = { initData: `user=%7B%7D&start_param=invite_${unsafeToken}`, version: '1.0', ready() {} }
    expect(maxBridge.inviteLaunch?.()).toEqual({ kind: 'valid', token: signedToken })

    host.location.search = `?WebAppStartParam=invite_${documentedToken}`
    expect(maxBridge.inviteLaunch?.()).toEqual({ kind: 'valid', token: signedToken })

    const noSignedStart = createMaxHostBridge({
      WebApp: { initData: 'user=%7B%7D', version: '1.0', ready() {} },
      location: host.location,
    })
    expect(noSignedStart.inviteLaunch?.()).toEqual({ kind: 'valid', token: documentedToken })
  })

  test('distinguishes malformed explicit invite intent from an ordinary or other-flow launch', () => {
    const malformed = {
      WebApp: { initData: 'user=%7B%7D', version: '1.0', ready() {} },
      location: { search: '?WebAppStartParam=invite_short' },
    }
    const otherFlow = {
      WebApp: { initData: 'user=%7B%7D&start_param=browser_123', version: '1.0', ready() {} },
      location: { search: `?startapp=invite_${legacyToken}` },
    }
    expect(readMaxInviteLaunch(malformed)).toEqual({ kind: 'invalid' })
    expect(createMaxHostBridge(malformed).inviteLaunch?.()).toEqual({ kind: 'invalid' })
    expect(readMaxInviteLaunch(otherFlow)).toEqual({ kind: 'none' })
  })
})
