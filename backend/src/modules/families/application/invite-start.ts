import { createHash } from 'node:crypto'

import type { DbClient } from '../../../db'

export type InviteStartResolution = 'active' | 'invalid'

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

function hashToken(rawToken: string) {
  return createHash('sha256').update(rawToken).digest('hex')
}
