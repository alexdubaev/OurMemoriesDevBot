import type { ChildDto } from '@web-app-demo/contracts'

import { ApiRequestError } from '@/platform/api'

/** `null` = «Все»; a child id = that child's page; `'untagged'` = «Без отметки». */
export type ChildFilter = string | null
export const UNTAGGED_CHILD_FILTER = 'untagged'
export type ChildFilterChip = { value: ChildFilter; label: string }

/**
 * A saved or requested filter that still makes sense for this family. Anything else — a
 * removed child, another family's child, «Без отметки» for a viewer, a one-child family —
 * falls back to «Все» instead of failing.
 */
export function normalizeChildFilter(value: unknown, children: readonly Pick<ChildDto, 'id'>[], options: { allowUntagged?: boolean } = {}): ChildFilter {
  if (children.length < 2 || typeof value !== 'string') return null
  if (value === UNTAGGED_CHILD_FILTER) return options.allowUntagged === false ? null : value
  return children.some((child) => child.id === value) ? value : null
}

/** Chips in reading order: «Все», the children in server order, then «Без отметки» when shown. */
export function childFilterChips(children: readonly Pick<ChildDto, 'id' | 'name'>[], showUntagged: boolean): ChildFilterChip[] {
  if (children.length < 2) return []
  return [
    { value: null, label: 'Все' },
    ...children.map((child) => ({ value: child.id, label: child.name })),
    ...(showUntagged ? [{ value: UNTAGGED_CHILD_FILTER, label: 'Без отметки' }] : []),
  ]
}

/** Adding from a child's page starts with that child selected; from «Все» or «Без отметки» with none. */
export function composerInitialChildIds(filter: ChildFilter, children: readonly Pick<ChildDto, 'id'>[]): string[] {
  return filter && filter !== UNTAGGED_CHILD_FILTER && children.some((child) => child.id === filter) ? [filter] : []
}

/**
 * The child whose list answered 404: removed on another device or never in this family. That
 * closes the child's page, not the family — the caller reloads the family and shows «Все».
 * `null` for anything else (no child filter, «Без отметки», other errors), which keeps the
 * usual access-lost handling.
 */
export function missingChildFilterId(error: unknown, filter: ChildFilter): string | null {
  if (!(error instanceof ApiRequestError) || error.status !== 404) return null
  return filter && filter !== UNTAGGED_CHILD_FILTER ? filter : null
}
