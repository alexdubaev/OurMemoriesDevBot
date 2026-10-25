import { describe, expect, test } from 'bun:test'

import { createMaxHostBridge } from '../src/platform/max/host-bridge'

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
})
