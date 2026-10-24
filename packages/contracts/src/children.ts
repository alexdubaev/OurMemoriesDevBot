/** Maximum number of live children in one family. */
export const MAX_FAMILY_CHILDREN = 12

/**
 * Client opt-in header. Only with `X-Memoly-Children: 1` does the server add `children`
 * to the family response and `childTags`/`childTagsVersion` to memory DTOs, so a stale
 * client keeps receiving the strict payloads it was built against.
 */
export const MEMOLY_CHILDREN_HEADER = 'X-Memoly-Children'
