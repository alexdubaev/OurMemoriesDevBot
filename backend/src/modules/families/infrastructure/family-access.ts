import type { DbClient } from '../../../db'
import type { FamilyAccess, FamilyScope } from '../application/ports'
import { FamilyFailure } from '../domain/errors'

export function createPrismaFamilyAccess(db: DbClient): FamilyAccess {
  const requireMember = async (scope: FamilyScope) => {
    const membership = await db.familyMember.findFirst({
      where: {
        familyId: scope.familyId,
        userId: scope.principal.userId,
        revokedAt: null,
        family: { status: 'active' },
      },
      select: { role: true, family: { select: { ownerUserId: true } } },
    })
    if (!membership) throw new FamilyFailure('not_found', 'Семья не найдена')
    return {
      role: membership.role,
      isOwner: membership.family.ownerUserId === scope.principal.userId,
    }
  }

  return {
    requireMember,
    async requireFull(scope) {
      const access = await requireMember(scope)
      if (access.role !== 'full') {
        throw new FamilyFailure('forbidden', 'Для этого действия нужен полный доступ')
      }
    },
    async requireOwner(scope) {
      const access = await requireMember(scope)
      if (!access.isOwner) {
        throw new FamilyFailure('forbidden', 'Действие доступно только создателю семьи')
      }
    },
  }
}
