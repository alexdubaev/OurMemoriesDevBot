import { describe, expect, test } from 'bun:test'

import {
  acceptInviteRequestSchema,
  createFamilyRequestSchema,
  createInviteRequestSchema,
  familyMeResponseSchema,
  familyRoleSchema,
  updateMemberRoleRequestSchema,
} from './index'

describe('family contracts', () => {
  test('keeps full and viewer as the only family roles', () => {
    expect(familyRoleSchema.parse('full')).toBe('full')
    expect(familyRoleSchema.parse('viewer')).toBe('viewer')
    expect(() => familyRoleSchema.parse('owner')).toThrow()
    expect(() => familyRoleSchema.parse('admin')).toThrow()
  })

  test('normalizes family creation and rejects invalid child or timezone input', () => {
    expect(
      createFamilyRequestSchema.parse({
        name: ' Наша семья ',
        timezone: 'Europe/Moscow',
        child: { displayName: ' Миша ', birthDate: '2024-02-29' },
      }),
    ).toEqual({
      name: 'Наша семья',
      timezone: 'Europe/Moscow',
      child: { displayName: 'Миша', birthDate: '2024-02-29' },
    })
    expect(() =>
      createFamilyRequestSchema.parse({
        name: 'Family',
        timezone: 'not-a-timezone',
        child: { displayName: '' },
      }),
    ).toThrow()
    expect(() =>
      createFamilyRequestSchema.parse({
        name: 'Family',
        timezone: 'Europe/Moscow',
        child: { displayName: 'Миша', birthDate: '2024-02-30' },
      }),
    ).toThrow()
  })

  test('defaults invitations to viewer and never accepts a role during consumption', () => {
    expect(createInviteRequestSchema.parse({})).toEqual({ role: 'viewer' })
    expect(createInviteRequestSchema.parse({ role: 'full' })).toEqual({ role: 'full' })
    expect(acceptInviteRequestSchema.parse({ token: 't'.repeat(32) })).toEqual({
      token: 't'.repeat(32),
    })
    expect(() =>
      acceptInviteRequestSchema.parse({ token: 't'.repeat(32), role: 'full' }),
    ).toThrow()
    expect(updateMemberRoleRequestSchema.parse({ role: 'viewer' })).toEqual({ role: 'viewer' })
  })

  test('keeps family authorization in the current-session response rather than the JWT', () => {
    const response = {
      user: {
        id: '019c0000-0000-7000-8000-000000000001',
        email: null,
        displayName: 'Telegram User',
        role: 'admin',
        createdAt: '2026-09-09T00:00:00.000Z',
      },
      activeFamily: {
        id: '019c0000-0000-7000-8000-000000000002',
        name: 'Наша семья',
        role: 'viewer',
        isOwner: false,
      },
      limits: { activeFamiliesMaximum: 1 },
    } as const
    expect(familyMeResponseSchema.parse(response)).toEqual(response)
  })
})
