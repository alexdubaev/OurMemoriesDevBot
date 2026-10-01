import { createHash } from 'node:crypto'

import type { DbClient } from '../../../db'

export type InviteStartResolution = 'active' | 'invalid'

export type DetailedInviteStartResolution =
  | { status: 'valid'; familyName: string; role: 'full' | 'viewer' }
  | { status: 'already_member' }
  | { status: 'expired' | 'revoked' | 'used' | 'invalid' }

export function createInviteStartResolver(
  db: DbClient,
  now: () => Date = () => new Date(),
): (rawToken: string) => Promise<InviteStartResolution> {
  return async (rawToken) => {
    const invite = await db.familyInvite.findFirst({
      where: {
        tokenHash: hashToken(rawToken),
        acceptedAt: null,
        revokedAt: null,
        expiresAt: { gt: now() },
        family: { status: 'active' },
      },
      select: { id: true },
    })
    return invite ? 'active' : 'invalid'
  }
}

/** Read-only classification for personal MAX bot entry. Actor identity is never created here. */
export function createDetailedInviteStartResolver(
  db: DbClient,
  now: () => Date = () => new Date(),
): (rawToken: string, maxSubject: string) => Promise<DetailedInviteStartResolution> {
  return async (rawToken, maxSubject) => {
    const invite = await db.familyInvite.findUnique({
      where: { tokenHash: hashToken(rawToken) },
      select: {
        familyId: true, expiresAt: true, revokedAt: true, acceptedAt: true, role: true,
        family: { select: { name: true, status: true } },
      },
    })
    if (!invite || invite.family.status !== 'active') return { status: 'invalid' }
    if (invite.revokedAt) return { status: 'revoked' }
    if (invite.acceptedAt) {
      const identity = await db.externalIdentity.findUnique({
        where: { provider_subject: { provider: 'max', subject: maxSubject } },
        select: { userId: true },
      })
      if (identity) {
        const member = await db.familyMember.findUnique({
          where: { familyId_userId: { familyId: invite.familyId, userId: identity.userId } },
          select: { revokedAt: true },
        })
        if (member && member.revokedAt === null) return { status: 'already_member' }
      }
      return { status: 'used' }
    }
    if (invite.expiresAt <= now()) return { status: 'expired' }
    return { status: 'valid', familyName: invite.family.name, role: invite.role }
  }
}

function hashToken(rawToken: string) {
  return createHash('sha256').update(rawToken).digest('hex')
}
