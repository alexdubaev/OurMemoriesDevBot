import { createHmac, timingSafeEqual } from 'node:crypto'

import { FamilyFailure } from '../domain/errors'

export type FamilyHomePosition = { rank: 0 | 1; name: string; familyId: string }

export function encodeFamilyHomeCursor(
  position: FamilyHomePosition, userId: string, snapshot: string, secret: string, now: Date,
): string {
  const payload = Buffer.from(JSON.stringify({ v: 2, position, userId, snapshot, expiresAt: now.getTime() + 15 * 60_000 }))
    .toString('base64url')
  const signature = sign(payload, secret)
  return `${payload}.${signature}`
}

export function decodeFamilyHomeCursor(
  cursor: string, userId: string, snapshot: string, secret: string, now: Date,
): FamilyHomePosition {
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
  if (value.v !== 2 || value.userId !== userId || !Number.isSafeInteger(value.expiresAt) ||
    !value.position || typeof value.position !== 'object') invalidCursor()
  const position = value.position as Record<string, unknown>
  if ((position.rank !== 0 && position.rank !== 1) ||
    typeof position.name !== 'string' || position.name.length > 160 ||
    typeof position.familyId !== 'string' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(position.familyId)) invalidCursor()
  if (value.snapshot !== snapshot || Number(value.expiresAt) < now.getTime()) {
    throw new FamilyFailure('version_conflict', 'Список семей изменился; начните просмотр заново')
  }
  return position as FamilyHomePosition
}

function sign(payload: string, secret: string) {
  return createHmac('sha256', secret).update('family-home-cursor:v1:').update(payload).digest('base64url')
}

function invalidCursor(): never {
  throw new FamilyFailure('invalid_input', 'Некорректный курсор списка семей')
}
