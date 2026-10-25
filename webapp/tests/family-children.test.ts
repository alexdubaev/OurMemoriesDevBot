import { describe, expect, test } from 'bun:test'

import type { ChildDto } from '@web-app-demo/contracts'
import { createChild, deleteChild, loadFamily, updateChild } from '../src/features/family/api'
import { canAddChild, childActionErrorMessage, familyChildren, hasManyChildren } from '../src/features/family/model'
import { ApiRequestError } from '../src/platform/api'
import type { AuthenticatedTransport } from '../src/platform/api'
import type { HttpRequestOptions } from '../src/platform/api/http-client'

const familyId = '019c0000-0000-7000-8000-000000000001'
const firstId = '019c0000-0000-7000-8000-0000000000a1'
const secondId = '019c0000-0000-7000-8000-0000000000a2'
const avatarId = '019c0000-0000-7000-8000-0000000000b1'
const crop = { x: 0, y: 0, width: 1, height: 1 }

function child(id: string, name: string, birthDate = '2024-05-01'): ChildDto {
  return { id, name, birthDate, sex: 'girl', avatarMediaId: avatarId, avatarCrop: crop, version: 1, isComplete: true }
}

type Call = { path: string; options?: HttpRequestOptions }
function recordingTransport(response: unknown) {
  const calls: Call[] = []
  const transport: AuthenticatedTransport = {
    request: async (path, schema, options) => { calls.push({ path, options }); return schema.parse(response) },
    raw: async (path, options) => { calls.push({ path, options }); return new Response(null, { status: 204 }) },
  }
  return { calls, transport }
}

describe('family children list', () => {
  test('uses the server list when present and falls back to the single legacy child', () => {
    const first = child(firstId, 'Лиля')
    const second = child(secondId, 'Миша', '2022-01-01')
    expect(familyChildren({ child: first, children: [second, first] }).map((item) => item.name)).toEqual(['Миша', 'Лиля'])
    expect(familyChildren({ child: first })).toEqual([first])
    expect(familyChildren({ child: null })).toEqual([])
    expect(familyChildren({ child: first, children: [] })).toEqual([])
  })

  test('treats two or more children as a multi-child family', () => {
    expect(hasManyChildren([])).toBe(false)
    expect(hasManyChildren([child(firstId, 'Лиля')])).toBe(false)
    expect(hasManyChildren([child(firstId, 'Лиля'), child(secondId, 'Миша')])).toBe(true)
  })

  test('offers adding a child to the owner only, up to twelve children', () => {
    const one = [child(firstId, 'Лиля')]
    expect(canAddChild(true, one)).toBe(true)
    expect(canAddChild(false, one)).toBe(false)
    const twelve = Array.from({ length: 12 }, (_, index) => child(`019c0000-0000-7000-8000-00000000c0${String(index).padStart(2, '0')}`, `Ребёнок ${index}`))
    expect(canAddChild(true, twelve)).toBe(false)
  })
})

describe('children requests', () => {
  test('family request opts into the children list', async () => {
    const { calls, transport } = recordingTransport({ family: { id: familyId, name: 'Семья', timezone: 'Europe/Moscow', ownerUserId: firstId }, child: null })
    await loadFamily(transport, familyId)
    expect(new Headers(calls[0]!.options?.headers).get('X-Memoly-Children')).toBe('1')
  })

  test('creating a child sends one idempotency key and the completed profile', async () => {
    const { calls, transport } = recordingTransport({ child: child(secondId, 'Миша') })
    const input = { name: 'Миша', birthDate: '2022-01-01', sex: 'boy' as const, avatarMediaId: avatarId, avatarCrop: crop }
    const created = await createChild(transport, familyId, input, 'key-1')
    expect(created.child.id).toBe(secondId)
    expect(calls[0]!.path).toBe(`/api/v1/families/${familyId}/children`)
    expect(calls[0]!.options?.method).toBe('POST')
    expect(new Headers(calls[0]!.options?.headers).get('Idempotency-Key')).toBe('key-1')
    expect(calls[0]!.options?.body).toEqual(input)
  })

  test('editing a child patches that child with its version', async () => {
    const { calls, transport } = recordingTransport({ child: child(secondId, 'Миша') })
    await updateChild(transport, familyId, secondId, { name: 'Михаил', expectedVersion: 3 })
    expect(calls[0]!.path).toBe(`/api/v1/families/${familyId}/children/${secondId}`)
    expect(calls[0]!.options?.method).toBe('PATCH')
    expect(calls[0]!.options?.body).toEqual({ name: 'Михаил', expectedVersion: 3 })
  })

  test('deleting a child sends its version in If-Match', async () => {
    const { calls, transport } = recordingTransport({})
    await deleteChild(transport, familyId, secondId, 4)
    expect(calls[0]!.path).toBe(`/api/v1/families/${familyId}/children/${secondId}`)
    expect(calls[0]!.options?.method).toBe('DELETE')
    expect(new Headers(calls[0]!.options?.headers).get('If-Match')).toBe('4')
  })
})

describe('child action errors', () => {
  test('shows the server reason for refusals and a generic text for everything else', () => {
    expect(childActionErrorMessage(new ApiRequestError(409, 'CONFLICT', 'В семье уже 12 детей'))).toBe('В семье уже 12 детей')
    expect(childActionErrorMessage(new ApiRequestError(500, 'INTERNAL_ERROR', 'Request failed with status 500'))).toBe('Не удалось сохранить данные. Попробуйте ещё раз.')
    expect(childActionErrorMessage(new TypeError('Failed to fetch'))).toBe('Не удалось сохранить данные. Попробуйте ещё раз.')
  })
})
