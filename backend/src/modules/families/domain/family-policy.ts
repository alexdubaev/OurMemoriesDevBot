export type FamilyRole = 'full' | 'viewer'

export function mayEditContent(role: FamilyRole): boolean {
  return role === 'full'
}

export function mayLike(role: FamilyRole): boolean {
  return role === 'full' || role === 'viewer'
}
