import type { ChildDto } from '@web-app-demo/contracts'

/** Adds or removes one child; the result follows the family's child order. */
export function toggleChildId(selected: readonly string[], childId: string, childOptions: readonly Pick<ChildDto, 'id'>[]): string[] {
  const next = new Set(selected)
  if (next.has(childId)) next.delete(childId)
  else next.add(childId)
  return childOptions.map((child) => child.id).filter((id) => next.has(id))
}

/**
 * What the publication request carries: the chosen children (possibly none) in a family with two
 * or more children, otherwise nothing so the server's one-child default rule applies as before.
 */
export function composerChildIds(childOptions: readonly Pick<ChildDto, 'id'>[] | undefined, selected: readonly string[]): string[] | undefined {
  if (!childOptions || childOptions.length < 2) return undefined
  const known = new Set(childOptions.map((child) => child.id))
  return selected.filter((id) => known.has(id))
}

export function sameChildIds(left: readonly string[] | undefined, right: readonly string[] | undefined) {
  return (left ?? null) === (right ?? null) || Boolean(left && right && left.length === right.length && left.every((id, index) => id === right[index]))
}
