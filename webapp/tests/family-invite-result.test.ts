import { describe, expect, test } from 'bun:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { ComponentProps } from 'react'
import type { FamilyInviteDto, FamilyMemberDto, FamilyResponse } from '@web-app-demo/contracts'

import { createInviteResult } from '../src/features/family/invite-result'
import { createBrowserDevHostBridge } from '../src/platform/telegram/host-bridge'
import { FamilyPresentation } from '../src/features/memoly-ui/FamilyPresentation'

describe('family invite result hotfix', () => {
  test('returns a MAX share URL from a browser-created family invite', async () => {
    const token = 'A'.repeat(32)
    const bridge = createBrowserDevHostBridge(
      { maxBotUsername: 'OurMemoriesMaxBot' },
      { location: { origin: 'https://app.memoly.ru' } },
    )
    const result = await createInviteResult({
      create: async () => ({ rawToken: token, expiresAt: '2026-09-25T00:00:00.000Z' }),
      toUrl: bridge.inviteLink,
      refresh: async () => undefined,
    })

    expect(result.url).toBe(`https://max.ru/OurMemoriesMaxBot?start=invite_${token}`)
  })

  test('keeps the successful URL result when the following refresh rejects', async () => {
    let refreshCalls = 0
    const result = await createInviteResult({
      create: async () => ({ rawToken: 'opaque-token', expiresAt: '2026-09-25T00:00:00.000Z' }),
      toUrl: (rawToken) => `https://t.me/OurMemoriesDevBot?startapp=invite_${rawToken}`,
      refresh: async () => { refreshCalls += 1; throw new Error('refresh failed') },
    })

    expect(result).toEqual({ url: 'https://t.me/OurMemoriesDevBot?startapp=invite_opaque-token', expiresAt: '2026-09-25T00:00:00.000Z' })
    expect(refreshCalls).toBe(1)
  })

  test('does not refresh or expose a success result when create fails', async () => {
    let refreshCalls = 0
    await expect(createInviteResult({
      create: async () => { throw new Error('create failed') },
      toUrl: () => 'https://example.invalid/should-not-exist',
      refresh: async () => { refreshCalls += 1 },
    })).rejects.toThrow('create failed')
    expect(refreshCalls).toBe(0)
  })

  test('renders the active invitation entry without a raw token or URL', () => {
    const rawToken = 'invite_raw_token_must_not_be_rendered'
    const markup = renderToStaticMarkup(createElement(FamilyPresentation, familyProps({
      invites: [{ ...invite, rawToken } as FamilyInviteDto & { rawToken: string }],
      canInvite: true,
    })))

    expect(markup).toContain('Активные приглашения')
    expect(markup).toContain('1 ссылка ожидает вступления')
    expect(markup).not.toContain(rawToken)
    expect(markup).not.toContain('Скопировать ссылку')
    expect(markup).not.toContain('Поделиться')
  })
})

const familyResponse: FamilyResponse = {
  family: { id: '11111111-1111-4111-8111-111111111111', name: 'Наша семья', ownerUserId: '22222222-2222-4222-8222-222222222222', timezone: 'Europe/Moscow' },
  child: { id: '33333333-3333-4333-8333-333333333333', name: 'Варя', birthDate: '2024-02-10', sex: 'girl', avatarMediaId: null, avatarCrop: null, version: 1, isComplete: true },
}

const member: FamilyMemberDto = {
  userId: familyResponse.family.ownerUserId, displayName: 'Александр', familyDisplayName: null, role: 'full', isOwner: true, joinedAt: '2026-09-01T00:00:00.000Z', version: 1,
}

const invite: FamilyInviteDto = { id: '44444444-4444-4444-8444-444444444444', role: 'viewer', inviteeDisplayName: 'Бабушка Оля', expiresAt: '2026-09-25T00:00:00.000Z', createdAt: '2026-09-17T00:00:00.000Z' }

function familyProps(overrides: Partial<ComponentProps<typeof FamilyPresentation>> = {}) {
  return {
    familyResponse, members: [member], invites: [], childAvatarUrl: null, usage: null, usageFailed: false, inviteReady: null, copyState: 'idle' as const, busy: false, canInvite: true, canEditChild: true, canLeaveFamily: false,
    memberActions: { [member.userId]: { canEditAlias: false, canManageRole: false, canRemove: false } }, hostBridge: { onBack: () => () => undefined }, onRefresh: () => undefined, onRefreshUsage: () => undefined, onEditChild: () => undefined, onOpenChild: () => undefined, onCloseChild: () => undefined, childProfileOpen: false, onCreateInvite: async () => undefined, onCopyInvite: async () => undefined, onShareInvite: async () => undefined, onCloseInvite: () => undefined, onRevokeInvite: async () => undefined, onUpdateMember: async () => undefined, onRemoveMember: async () => undefined, onLeaveFamily: async () => undefined,
    ...overrides,
  }
}
