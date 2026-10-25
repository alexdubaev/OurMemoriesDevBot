import type { AlbumDto } from '@web-app-demo/contracts'

/** Private per-family key; `removePrivateFamilyQueries` drops it with the rest of the family. */
export const childAlbumsQueryKey = (familyId: string, accountId: string, membershipEpoch: number, childId: string) =>
  ['session', 'child-albums', familyId, accountId, membershipEpoch, childId] as const

/** Template albums every child page offers; created ones open, missing ones invite a Full member to create. */
export const childAlbumTemplates = [
  { kind: 'year' as const, title: 'Первые 12 месяцев' },
  { kind: 'workshop' as const, title: 'Мастерская' },
]

const kindOrder: Record<AlbumDto['kind'], number> = { year: 0, workshop: 1, events: 2, free: 3 }

/** «Первые 12 месяцев», «Мастерская», then other albums of the child, oldest first. */
export function orderChildAlbums(albums: readonly AlbumDto[]) {
  return [...albums].sort((left, right) => kindOrder[left.kind] - kindOrder[right.kind] || left.createdAt.localeCompare(right.createdAt))
}

/** Templates still missing for this child; only a Full member is invited to create them. */
export function missingChildAlbumTemplates(albums: readonly AlbumDto[], role: 'full' | 'viewer') {
  return role === 'full' ? childAlbumTemplates.filter((template) => !albums.some((album) => album.kind === template.kind)) : []
}
