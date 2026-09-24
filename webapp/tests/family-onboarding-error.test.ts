import { expect, test } from 'bun:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { FamilyMemberDto, FamilyResponse } from '@web-app-demo/contracts'

import { FamilyOnboarding } from '../src/features/family/FamilyOnboarding'
import { onboardingSaveErrorMessage } from '../src/features/family/model'
import { FamilyPresentation } from '../src/features/memoly-ui/FamilyPresentation'
import { InviteFlow } from '../src/features/family/InvitationScreens'
import type { AuthenticatedTransport } from '../src/platform/api'

test('onboarding save failures use onboarding-specific copy instead of feed refresh copy', () => {
  expect(onboardingSaveErrorMessage).toBe('Не удалось сохранить данные. Попробуйте ещё раз.')
  expect(onboardingSaveErrorMessage).not.toContain('лент')
})

test('onboarding renders the memoLy logo rather than the former visible brand text', () => {
  const markup = renderToStaticMarkup(createElement(FamilyOnboarding, {
    familyId: '11111111-1111-4111-8111-111111111111',
    familyTimezone: 'Europe/Moscow',
    onCompleted: async () => undefined,
    transport,
  }))

  expect(markup).toContain('src="/assets/brand/memoly-logo-correct.webp"')
  expect(markup).toContain('alt="memoLy"')
  expect(markup).not.toContain('Наши воспоминания')
})

test('viewer family presentation keeps leave access while hiding owner actions', () => {
  const markup = renderToStaticMarkup(createElement(FamilyPresentation, {
    busy: false,
    canEditChild: false,
    childProfileOpen: false,
    canInvite: false,
    canLeaveFamily: true,
    childAvatarUrl: null,
    copyState: 'idle',
    familyResponse: viewerFamily,
    invites: [],
    memberActions: { [viewer.userId]: { canEditAlias: false, canManageRole: false, canRemove: false } },
    members: [viewer],
    onCloseInvite: () => undefined,
    onCopyInvite: async () => undefined,
    onCreateInvite: async () => undefined,
    onEditChild: () => undefined,
    onOpenChild: () => undefined,
    onCloseChild: () => undefined,
    onLeaveFamily: async () => undefined,
    onRefresh: () => undefined,
    onRefreshUsage: () => undefined,
    onRemoveMember: async () => undefined,
    onRevokeInvite: async () => undefined,
    onShareInvite: async () => undefined,
    onUpdateMember: async () => undefined,
    inviteReady: null,
    usage: null,
    usageFailed: false,
  }))

  expect(markup).not.toContain('Пригласить близкого')
  expect(markup).not.toContain('Удалить участника')
  expect(markup).toContain('Выйти из семьи')
})

test('invite flow defaults to least privilege and exposes actionable create errors', () => {
  const markup = renderToStaticMarkup(createElement(InviteFlow, {
    busy: false,
    hasError: true,
    onBack: () => undefined,
    onCreate: async () => undefined,
    onRefresh: () => undefined,
  }))

  expect(markup).toMatch(/id="simpleRoleView"[^>]*checked=""/)
  expect(markup).not.toMatch(/id="simpleRoleFull"[^>]*checked=""/)
  expect(markup).toContain('data-slot="inline-error"')
  expect(markup).toContain('Повторить')
})

const viewerFamily: FamilyResponse = {
  family: {
    id: '55555555-5555-4555-8555-555555555555',
    name: 'Наша семья',
    ownerUserId: '66666666-6666-4666-8666-666666666666',
    timezone: 'Europe/Moscow',
  },
  child: {
    id: '77777777-7777-4777-8777-777777777777',
    name: 'Варя',
    birthDate: null,
    sex: 'girl',
    avatarMediaId: null,
    avatarCrop: null,
    version: 1,
    isComplete: true,
  },
}

const viewer: FamilyMemberDto = {
  userId: '88888888-8888-4888-8888-888888888888',
  displayName: 'Бабушка Оля',
  familyDisplayName: null,
  role: 'viewer',
  isOwner: false,
  joinedAt: '2026-09-17T00:00:00.000Z',
  version: 1,
}

const transport: AuthenticatedTransport = {
  request: async () => { throw new Error('unexpected request') },
  raw: async () => { throw new Error('unexpected request') },
}
