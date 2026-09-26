import { createHash, createHmac, timingSafeEqual } from 'node:crypto'

import type { FamilyHomeResponse } from '@web-app-demo/contracts'

import { FamilyFailure } from '../domain/errors'

type Item = FamilyHomeResponse['items'][number]

export function familyHomeSnapshot(items: Item[]): string {
  return createHash('sha256').update(JSON.stringify(items)).digest('base64url')
}

export function encodeFamilyHomeCursor(
  offset: number, userId: string, snapshot: string, secret: string, now: Date,
): string {
  const payload = Buffer.from(JSON.stringify({ v: 1, offset, userId, snapshot, expiresAt: now.getTime() + 15 * 60_000 }))
    .toString('base64url')
  const signature = sign(payload, secret)
  return `${payload}.${signature}`
}

export function decodeFamilyHomeCursor(
  cursor: string, userId: string, snapshot: string, secret: string, now: Date,
): number {
  const [payload, signature, extra] = cursor.split('.')
  if (!payload || !signature || extra !== undefined ||
    !/^[A-Za-z0-9_-]+$/.test(payload) || !/^[A-Za-z0-9_-]+$/.test(signature)) invalidCursor()
  const expected = Buffer.from(sign(payload, secret), 'base64url')
  const provided = Buffer.from(signature, 'base64url')
  if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) invalidCursor()
  let decoded: unknown
  try {
    decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))
  } catch {
    invalidCursor()
  }
  if (!decoded || typeof decoded !== 'object') invalidCursor()
  const value = decoded as Record<string, unknown>
  if (value.v !== 1 || value.userId !== userId || !Number.isSafeInteger(value.offset) ||
    Number(value.offset) < 1 || !Number.isSafeInteger(value.expiresAt)) invalidCursor()
  if (value.snapshot !== snapshot || Number(value.expiresAt) < now.getTime()) {
    throw new FamilyFailure('version_conflict', 'Список семей изменился; начните просмотр заново')
  }
  return Number(value.offset)
}

function sign(payload: string, secret: string) {
  return createHmac('sha256', secret).update('family-home-cursor:v1:').update(payload).digest('base64url')
}

function invalidCursor(): never {
  throw new FamilyFailure('invalid_input', 'Некорректный курсор списка семей')
}
