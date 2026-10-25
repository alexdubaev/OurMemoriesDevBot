import { describe, expect, test } from 'bun:test'

import { controlCursorQuerySchema, controlFamilyRowSchema, controlSampleSchema, controlMeSchema, controlPageSchema } from './control'
import { z } from 'zod'

describe('control contracts', () => {
  test('bounds list inputs and decimal byte fields', () => {
    expect(controlCursorQuerySchema.safeParse({ limit: 101 }).success).toBe(false)
    expect(controlCursorQuerySchema.safeParse({ q: 'x'.repeat(101) }).success).toBe(false)
    expect(controlCursorQuerySchema.safeParse({ userId: '00000000-0000-4000-8000-000000000001' }).success).toBe(false)
    const family = controlFamilyRowSchema.safeParse({
      id: '00000000-0000-4000-8000-000000000001', name: null, childName: null, ownerName: null,
      status: 'active', createdAt: new Date().toISOString(), activeMembers: 0,
      storageUsedBytes: '9007199254740993', storageReservedBytes: '0', quotaBytes: null,
      publishedMemories: 0, mediaAttachments: 0, maxState: null, lastObservedAt: null,
      maxLastCheckedAt: null, maxVerificationAgeSeconds: null,
    })
    expect(family.success).toBe(true)
    expect(controlFamilyRowSchema.safeParse({ ...(family.success ? family.data : {}), storageUsedBytes: 9007199254740993 }).success).toBe(false)
    expect(controlFamilyRowSchema.safeParse({ ...(family.success ? family.data : {}), maxState: 'mystery' }).success).toBe(false)
    expect(controlPageSchema(controlMeSchema).safeParse({ items: [{ allowed: true, serverNow: new Date().toISOString(), features: ['read'], extra: true }], nextCursor: null }).success).toBe(false)
  })

  test('distinguishes zero from unavailable sample values', () => {
    const schema = controlSampleSchema(z.number().int().nonnegative())
    const base = { status: 'ok', sourceId: 'product_db', observedAt: new Date().toISOString(), lastAttemptAt: null,
      staleAfterSeconds: 30, coverageFrom: null, coverageRatio: null, errorCode: null }
    expect(schema.safeParse({ ...base, value: 0 }).success).toBe(true)
    expect(schema.safeParse({ ...base, status: 'not_configured', value: null }).success).toBe(true)
    expect(schema.safeParse({ ...base, status: 'ok', value: null }).success).toBe(true)
  })
})
