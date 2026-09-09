export type FamilyFailureKind =
  | 'not_found'
  | 'forbidden'
  | 'conflict'
  | 'already_in_family'
  | 'invite_used'
  | 'invite_expired'
  | 'invite_revoked'

export class FamilyFailure extends Error {
  constructor(public readonly kind: FamilyFailureKind, message: string) {
    super(message)
    this.name = 'FamilyFailure'
  }
}
