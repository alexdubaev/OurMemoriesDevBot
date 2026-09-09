import { createHmac, timingSafeEqual } from 'node:crypto'

import type { MemoryKind } from '@web-app-demo/contracts'

export type MemoryCursorFilters = { childId: string | null; kind: MemoryKind | null }
export type MemoryCursorPosition = { occurredAt: string; id: string }
export type MemoryCursorClaims = {
  version: 1
  familyId: string
  filters: MemoryCursorFilters
  snapshot: MemoryCursorPosition
  before: MemoryCursorPosition
  expiresAt: string
}

type CursorInput = Omit<MemoryCursorClaims, 'version'>

export function encodeMemoryCursor(input: CursorInput, secret: string): string {
  const claims: MemoryCursorClaims = { version: 1, ...input }
  const payload = Buffer.from(JSON.stringify(claims)).toString('base64url')
  return `${payload}.${sign(payload, secret)}`
}

export function decodeMemoryCursor(cursor: string, secret: string, now = new Date()): MemoryCursorClaims {
  const [payload, signature, ...rest] = cursor.split('.')
  if (!payload || !signature || rest.length > 0 || !signatureMatches(payload, signature, secret)) {
    throw new MemoryCursorError('Курсор ленты недействителен')
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))
  } catch {
    throw new MemoryCursorError('Курсор ленты недействителен')
  }
  if (!isClaims(parsed)) throw new MemoryCursorError('Курсор ленты недействителен')
  if (new Date(parsed.expiresAt) <= now) throw new MemoryCursorError('Срок действия курсора истёк')
  return parsed
}

export function validateMemoryCursorContext(
  claims: MemoryCursorClaims,
  expected: { familyId: string; filters: MemoryCursorFilters },
) {
  if (claims.familyId !== expected.familyId ||
      claims.filters.childId !== expected.filters.childId ||
      claims.filters.kind !== expected.filters.kind) {
    throw new MemoryCursorError('Курсор не соответствует этому запросу')
  }
}

export class MemoryCursorError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'MemoryCursorError'
  }
}

function sign(payload: string, secret: string) {
  return createHmac('sha256', secret).update(`memory-feed-v1.${payload}`).digest('base64url')
}

function signatureMatches(payload: string, signature: string, secret: string) {
  const expected = Buffer.from(sign(payload, secret))
  const received = Buffer.from(signature)
  return expected.length === received.length && timingSafeEqual(expected, received)
}

function isClaims(value: unknown): value is MemoryCursorClaims {
  if (!value || typeof value !== 'object') return false
  const claims = value as Partial<MemoryCursorClaims>
  return claims.version === 1 &&
    typeof claims.familyId === 'string' &&
    isFilters(claims.filters) &&
    isPosition(claims.snapshot) &&
    isPosition(claims.before) &&
    typeof claims.expiresAt === 'string' && !Number.isNaN(new Date(claims.expiresAt).getTime())
}

function isFilters(value: unknown): value is MemoryCursorFilters {
  if (!value || typeof value !== 'object') return false
  const filters = value as Partial<MemoryCursorFilters>
  return (filters.childId === null || typeof filters.childId === 'string') &&
    (filters.kind === null || filters.kind === 'note' || filters.kind === 'photo' ||
      filters.kind === 'video' || filters.kind === 'voice')
}

function isPosition(value: unknown): value is MemoryCursorPosition {
  if (!value || typeof value !== 'object') return false
  const position = value as Partial<MemoryCursorPosition>
  return typeof position.id === 'string' && typeof position.occurredAt === 'string' &&
    !Number.isNaN(new Date(position.occurredAt).getTime())
}
