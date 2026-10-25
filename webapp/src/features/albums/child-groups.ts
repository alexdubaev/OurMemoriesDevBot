import type { AlbumDto, ChildDto } from '@web-app-demo/contracts'

export type AlbumGroup = { key: string; title: string; childId: string | null; albums: AlbumDto[] }

/** Albums per child in the family's child order, then «Семейные» (free albums and any album without a known child). */
export function groupAlbumsByChild(albums: readonly AlbumDto[], children: readonly Pick<ChildDto, 'id' | 'name'>[]): AlbumGroup[] {
  const known = new Set(children.map((child) => child.id))
  const groups: AlbumGroup[] = children.map((child) => ({ key: child.id, title: child.name, childId: child.id, albums: albums.filter((album) => album.childId === child.id) }))
  groups.push({ key: 'family', title: 'Семейные', childId: null, albums: albums.filter((album) => !album.childId || !known.has(album.childId)) })
  return groups.filter((group) => group.albums.length > 0)
}

/** The child a new template album starts with: the one selected in the feed, otherwise the oldest. */
export function defaultAlbumChildId(children: readonly Pick<ChildDto, 'id'>[], preferred: string | null | undefined): string | null {
  if (preferred && children.some((child) => child.id === preferred)) return preferred
  return children[0]?.id ?? null
}

/** Children to choose from when creating an album; no choice is shown for a one-child family. */
export function albumChildChoices<T extends Pick<ChildDto, 'id'>>(children: readonly T[]): T[] {
  return children.length >= 2 ? [...children] : []
}
