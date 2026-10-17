import { describe, expect, test } from 'bun:test'

import type { FamilyHomeResponse, FamilyMemberDto } from '@web-app-demo/contracts'
import { canStartMaxVideoUpload } from '../src/features/family/model'

const fullSummary = {
  familyId: '019c0000-0000-7000-8000-000000000001', name: 'Семья', displaySubtitle: null,
  childAvatarMediaId: null, childAvatarCrop: null, isOwner: false, role: 'full', setupStatus: 'ready',
  capabilities: { canCreateInvite: true, canManageMembers: false, canEditChild: false, canPublishNote: true,
    canPublishPhoto: true, canPublishVoice: true, canPublishVideo: true, canUploadChildAvatar: false },
  unreadCount: null, unreadState: 'not_enabled', membershipEpoch: 1,
} satisfies FamilyHomeResponse['items'][number]
const fullMember = { userId: '019c0000-0000-7000-8000-000000000002', role: 'full', version: 1 } as FamilyMemberDto

describe('MAX direct video capability projection', () => {
  test('permits full non-owner only while server capability, member role, and child readiness agree', () => {
    expect(canStartMaxVideoUpload(fullSummary, fullMember, true)).toBe(true)
    expect(canStartMaxVideoUpload({ ...fullSummary, capabilities: { ...fullSummary.capabilities, canPublishVideo: false } }, fullMember, true)).toBe(false)
    expect(canStartMaxVideoUpload(fullSummary, { ...fullMember, role: 'viewer' }, true)).toBe(false)
    expect(canStartMaxVideoUpload({ ...fullSummary, role: 'viewer' }, fullMember, true)).toBe(false)
    expect(canStartMaxVideoUpload(fullSummary, fullMember, false)).toBe(false)
  })
})
