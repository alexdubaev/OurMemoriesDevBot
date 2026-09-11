import { describe, expect, test } from 'bun:test'

import {
  acceptInviteRequestSchema,
  createFamilyRequestSchema,
  createInviteRequestSchema,
  familyMeResponseSchema,
  familyRoleSchema,
  idempotencyKeyHeadersSchema,
  removeMemberRequestSchema,
  updateFamilyRequestSchema,
  updateMemberRoleRequestSchema,
} from './index'

describe('family contracts', () => {
  test('keeps full and viewer as the only family roles', () => {
    expect(familyRoleSchema.parse('full')).toBe('full')
    expect(familyRoleSchema.parse('viewer')).toBe('viewer')
    expect(() => familyRoleSchema.parse('owner')).toThrow()
    expect(() => familyRoleSchema.parse('admin')).toThrow()
  })

  test('creates an idempotent family bootstrap without allowing an incomplete child profile', () => {
    expect(
      createFamilyRequestSchema.parse({
        name: ' Наша семья ',
        timezone: 'Europe/Moscow',
      }),
    ).toEqual({
      name: 'Наша семья',
      timezone: 'Europe/Moscow',
    })
    expect(() =>
      createFamilyRequestSchema.parse({
        name: 'Family',
        timezone: 'not-a-timezone',
      }),
    ).toThrow()
    expect(() =>
      createFamilyRequestSchema.parse({
        name: 'Family',
        timezone: 'Europe/Moscow',
        child: { displayName: 'Миша' },
      }),
    ).toThrow()
  })

  test('requires every child profile field and a bounded avatar crop during onboarding', async () => {
    const { completeChildProfileRequestSchema } = await import('./index')
    expect(completeChildProfileRequestSchema.parse({
      name: ' Миша ',
      birthDate: '2024-02-29',
      sex: 'boy',
      avatarMediaId: '019c0000-0000-7000-8000-000000000001',
      avatarCrop: { x: 0, y: 0, width: 1, height: 1 },
    })).toMatchObject({ name: 'Миша', sex: 'boy' })
    expect(() => completeChildProfileRequestSchema.parse({
      name: 'Миша', birthDate: '2024-02-29', sex: 'boy',
      avatarMediaId: '019c0000-0000-7000-8000-000000000001',
    })).toThrow()
    expect(() => completeChildProfileRequestSchema.parse({
      name: 'Миша', birthDate: '2024-02-29', sex: 'girl',
      avatarMediaId: '019c0000-0000-7000-8000-000000000001',
      avatarCrop: { x: 0.5, y: 0, width: 0.6, height: 1 },
    })).toThrow()
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
    expect(updateMemberRoleRequestSchema.parse({ role: 'viewer', expectedVersion: 3 })).toEqual({
      role: 'viewer',
      expectedVersion: 3,
    })
    expect(() => updateMemberRoleRequestSchema.parse({ role: 'viewer' })).toThrow()
  })

  test('keeps a family-local invitation alias separate from the access role', () => {
    expect(createInviteRequestSchema.parse({
      role: 'viewer',
      inviteeDisplayName: '  Бабушка Оля  ',
    })).toEqual({
      role: 'viewer',
      inviteeDisplayName: 'Бабушка Оля',
    })
    expect(createInviteRequestSchema.parse({ inviteeDisplayName: '   ' })).toEqual({
      role: 'viewer',
      inviteeDisplayName: null,
    })
    expect(() => createInviteRequestSchema.parse({
      role: 'full',
      inviteeDisplayName: 'x'.repeat(65),
    })).toThrow()
  })

  test('requires version authority for membership updates and removals', () => {
    expect(updateMemberRoleRequestSchema.parse({
      familyDisplayName: ' Тётя Лена ',
      expectedVersion: 2,
    })).toEqual({ familyDisplayName: 'Тётя Лена', expectedVersion: 2 })
    expect(updateMemberRoleRequestSchema.parse({ familyDisplayName: null, expectedVersion: 2 })).toEqual({
      familyDisplayName: null,
      expectedVersion: 2,
    })
    expect(() => updateMemberRoleRequestSchema.parse({})).toThrow()
    expect(removeMemberRequestSchema.parse({ expectedVersion: 4 })).toEqual({ expectedVersion: 4 })
    expect(() => removeMemberRequestSchema.parse({})).toThrow()
  })

  test('allows only current MVP family and child fields in family updates', () => {
    expect(updateFamilyRequestSchema.parse({
      name: ' Новое имя ',
      timezone: 'Asia/Yekaterinburg',
      child: { displayName: ' Маша ', birthDate: null, expectedVersion: 5 },
    })).toEqual({
      name: 'Новое имя',
      timezone: 'Asia/Yekaterinburg',
      child: { displayName: 'Маша', birthDate: null, expectedVersion: 5 },
    })
    expect(() => updateFamilyRequestSchema.parse({})).toThrow()
    expect(() => updateFamilyRequestSchema.parse({ theme: 'dark' })).toThrow()
    expect(() => updateFamilyRequestSchema.parse({ child: {} })).toThrow()
    expect(() => updateFamilyRequestSchema.parse({ child: { expectedVersion: 5 } })).toThrow()
    expect(() => updateFamilyRequestSchema.parse({ child: { displayName: 'Маша' } })).toThrow()
    expect(() => updateFamilyRequestSchema.parse({ timezone: 'not-a-timezone' })).toThrow()
  })

  test('requires a UUID Idempotency-Key for Block 01 creation requests', () => {
    expect(idempotencyKeyHeadersSchema.parse({
      'idempotency-key': '01993b24-7e7d-7000-8000-000000000003',
    })).toEqual({
      'idempotency-key': '01993b24-7e7d-7000-8000-000000000003',
    })
    expect(() => idempotencyKeyHeadersSchema.parse({})).toThrow()
    expect(() => idempotencyKeyHeadersSchema.parse({ 'idempotency-key': 'retry-1' })).toThrow()
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
