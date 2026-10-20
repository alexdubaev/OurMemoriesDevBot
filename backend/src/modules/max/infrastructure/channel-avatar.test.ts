import { describe, expect, test } from 'bun:test'
import type { DbClient } from '../../../db'
import type { FamilyAccess, FamilyScope } from '../../families'
import { createMaxChannelAvatarReader } from './channel-avatar'

const familyId = '018f01d8-0c2a-7c25-bf83-ae68985c7e90'
const owner: FamilyScope = { familyId, principal: { userId: '018f01d8-0c2a-7c25-bf83-ae68985c7e91', sessionId: 'owner-session' } }
const viewer: FamilyScope = { familyId, principal: { userId: '018f01d8-0c2a-7c25-bf83-ae68985c7e92', sessionId: 'viewer-session' } }

describe('MAX channel avatar reader', () => {
  test('coalesces same-binding loads without inheriting one caller abort and rechecks access for each result', async () => {
    let membershipChecks = 0
    let providerCalls = 0
    let downloadCalls = 0
    let releaseDownload!: (value: { bytes: Uint8Array; contentType: string; contentLength: number }) => void
    const downloadPending = new Promise<{ bytes: Uint8Array; contentType: string; contentLength: number }>((resolve) => { releaseDownload = resolve })
    const reader = createMaxChannelAvatarReader({
      db: fakeDb(() => ({ chatId: -123n, familyId, version: 4 })),
      familyAccess: fakeAccess(() => { membershipChecks += 1 }),
      getAvatarUrl: async () => { providerCalls += 1; return 'https://i.oneme.ru/avatar.png' },
      download: async (_url, _maxBytes, signal) => { downloadCalls += 1; expect(signal).toBeUndefined(); return downloadPending },
    })
    const aborted = new AbortController()
    const ownerRead = reader(owner, -123n, aborted.signal)
    const viewerRead = reader(viewer, -123n)
    aborted.abort()
    releaseDownload({ bytes: Uint8Array.of(1, 2, 3), contentType: 'image/png', contentLength: 3 })
    await expect(ownerRead).resolves.toMatchObject({ contentType: 'image/png' })
    await expect(viewerRead).resolves.toMatchObject({ contentLength: 3 })
    expect(providerCalls).toBe(1)
    expect(downloadCalls).toBe(1)
    expect(membershipChecks).toBe(4)
  })

  test('cached response still rechecks current membership and exact binding version', async () => {
    let version = 4
    let providerCalls = 0
    const reader = createMaxChannelAvatarReader({
      db: fakeDb(() => ({ chatId: -123n, familyId, version })),
      familyAccess: fakeAccess(),
      getAvatarUrl: async () => { providerCalls += 1; return 'https://i.oneme.ru/avatar.png' },
      download: async () => ({ bytes: Uint8Array.of(1), contentType: 'image/png', contentLength: 1 }),
    })
    await reader(owner, -123n)
    await reader(owner, -123n)
    version += 1
    await reader(owner, -123n)
    expect(providerCalls).toBe(2)
  })

  test('foreign bindings and missing icons never invoke the downloader', async () => {
    let providerCalls = 0
    let downloadCalls = 0
    const foreignReader = createMaxChannelAvatarReader({
      db: fakeDb(() => null), familyAccess: fakeAccess(),
      getAvatarUrl: async () => { providerCalls += 1; return 'https://i.oneme.ru/avatar.png' },
      download: async () => { downloadCalls += 1; throw new Error('unexpected') },
    })
    await expect(foreignReader(owner, -123n)).resolves.toBeNull()
    const missingReader = createMaxChannelAvatarReader({
      db: fakeDb(() => ({ chatId: -123n, familyId, version: 1 })), familyAccess: fakeAccess(),
      getAvatarUrl: async () => null,
      download: async () => { downloadCalls += 1; throw new Error('unexpected') },
    })
    await expect(missingReader(owner, -123n)).resolves.toBeNull()
    expect(providerCalls).toBe(0)
    expect(downloadCalls).toBe(0)
  })
})

function fakeDb(binding: () => { chatId: bigint; familyId: string; version: number } | null) {
  return { maxChannelBinding: { findFirst: async () => binding() } } as unknown as DbClient
}

function fakeAccess(onCheck: () => void = () => undefined): FamilyAccess {
  return {
    requireMember: async () => { onCheck(); return { role: 'viewer', isOwner: false } },
    requireFull: async () => undefined,
    requireOwner: async () => undefined,
  }
}
