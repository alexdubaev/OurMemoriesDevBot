import type { FamilyRole } from '../domain/family-policy'

export type FamilyScope = {
  principal: { userId: string; sessionId: string }
  familyId: string
}

export type FamilyAccess = {
  requireMember(scope: FamilyScope): Promise<{ role: FamilyRole; isOwner: boolean }>
  requireFull(scope: FamilyScope): Promise<void>
  requireOwner(scope: FamilyScope): Promise<void>
}

export type PersistenceErrorClassifier = {
  isUniqueConstraint(error: unknown): boolean
}
