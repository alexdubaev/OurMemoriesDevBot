import type { DbClient } from './db'
import type { PrismaTransactionClient } from './idempotency'

export type PublishCandidate = { familyId: string; childId: string; name: string }

type Membership = {
  familyId: string
  role: 'full' | 'viewer'
  family: { name: string; children: Array<{ id: string }> }
}

export const choiceWindowMs = 15 * 60_000

export function savedFamilyText(name: string) {
  return `Сохранено в семейную ленту «${name}».`
}

export function publishCandidates(memberships: Membership[]): PublishCandidate[] {
  return memberships.flatMap((membership) => {
    const child = membership.family.children[0]
    return membership.role === 'full' && child
      ? [{ familyId: membership.familyId, childId: child.id, name: membership.family.name }]
      : []
  })
}

export async function loadPublishCandidates(db: DbClient, provider: 'max' | 'telegram', subject: string) {
  const identity = await db.externalIdentity.findUnique({
    where: { provider_subject: { provider, subject } },
    select: { user: { select: { id: true, familyMemberships: {
      where: { revokedAt: null, role: 'full', family: { status: 'active' } },
      orderBy: { familyId: 'asc' },
      select: { familyId: true, role: true, family: { select: {
        name: true, children: { orderBy: { createdAt: 'asc' }, take: 1, select: { id: true } },
      } } },
    } } } },
  })
  return identity ? { userId: identity.user.id, candidates: publishCandidates(identity.user.familyMemberships) } : null
}

export function choicePayload(sourceId: string, index: number) {
  return `family:${sourceId}:${index}`
}

export function parseChoicePayload(value: string): { sourceId: string; index: number } | null {
  const match = /^family:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}):([0-9]{1,4})$/i.exec(value)
  if (!match) return null
  return { sourceId: match[1]!, index: Number(match[2]) }
}

export function readCandidates(value: unknown): PublishCandidate[] {
  if (!Array.isArray(value)) return []
  const valid = value.every((item) => item && typeof item === 'object' && !Array.isArray(item)
    && typeof item.familyId === 'string' && typeof item.childId === 'string' && typeof item.name === 'string')
  return valid ? value as PublishCandidate[] : []
}

export async function lockBotActor(tx: PrismaTransactionClient, userId: string) {
  await tx.$queryRaw`SELECT id FROM users WHERE id = ${userId}::uuid FOR UPDATE`
}

/** All bot target writes use actor -> family -> membership/source lock order. */
export async function lockBotTarget(tx: PrismaTransactionClient, userId: string, candidate: PublishCandidate) {
  await lockBotActor(tx, userId)
  const family = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM families WHERE id = ${candidate.familyId}::uuid AND status = 'active' FOR SHARE`
  if (!family[0]) return false
  const membership = await tx.$queryRaw<Array<{ family_id: string }>>`
    SELECT family_id FROM family_members WHERE family_id = ${candidate.familyId}::uuid AND user_id = ${userId}::uuid
      AND role = 'full' AND revoked_at IS NULL FOR SHARE`
  if (!membership[0]) return false
  const child = await tx.child.findFirst({ where: { id: candidate.childId, familyId: candidate.familyId }, select: { id: true } })
  return !!child
}
