import type { ChildDto, MemoryAttachment, MemoryChildTag, MemoryDto } from '@web-app-demo/contracts'

/** The one shared choice of a publication that has no photo or video. */
export const WHOLE_PUBLICATION_SLOT = 'whole'
/** Choice per slot: an attachment id (or the shared slot) → children in the family's order. */
export type TagSelection = Record<string, string[]>

/** Photos and videos take their own tags; voice and text belong to the publication as a whole. */
export function taggableAttachments(memory: Pick<MemoryDto, 'attachments'>): MemoryAttachment[] {
  return memory.attachments.filter((attachment) => attachment.kind === 'photo' || attachment.kind === 'video')
}

/** Full members of a family with two or more children, on any publication that carries tags. */
export function canEditChildTags(role: 'full' | 'viewer', childOptions: readonly Pick<ChildDto, 'id'>[], memory: Pick<MemoryDto, 'childTags' | 'childTagsVersion'>) {
  return role === 'full' && childOptions.length >= 2 && memory.childTags !== undefined && memory.childTagsVersion !== undefined
}

const inOrder = (childOptions: readonly Pick<ChildDto, 'id'>[], chosen: ReadonlySet<string>) => childOptions.map((child) => child.id).filter((id) => chosen.has(id))

/** A child tagged on the whole publication counts as tagged on every photo and video. */
export function initialTagSelection(memory: Pick<MemoryDto, 'attachments' | 'childTags'>, childOptions: readonly Pick<ChildDto, 'id'>[]): TagSelection {
  const tags = memory.childTags ?? []
  const whole = tags.filter((tag) => tag.attachmentId === null).map((tag) => tag.childId)
  const slots = taggableAttachments(memory)
  if (slots.length === 0) return { [WHOLE_PUBLICATION_SLOT]: inOrder(childOptions, new Set(whole)) }
  return Object.fromEntries(slots.map((attachment) => [
    attachment.id,
    inOrder(childOptions, new Set([...whole, ...tags.filter((tag) => tag.attachmentId === attachment.id).map((tag) => tag.childId)])),
  ]))
}

/**
 * The request body for the selection. A child ticked on every photo and video is one tag on the
 * whole publication, otherwise one tag per ticked attachment.
 */
export function tagsFromSelection(memory: Pick<MemoryDto, 'attachments'>, selection: TagSelection, childOptions: readonly Pick<ChildDto, 'id'>[]): MemoryChildTag[] {
  const slots = taggableAttachments(memory)
  if (slots.length === 0) return inOrder(childOptions, new Set(selection[WHOLE_PUBLICATION_SLOT] ?? [])).map((childId) => ({ childId, attachmentId: null }))
  return childOptions.flatMap((child): MemoryChildTag[] => {
    const ticked = slots.filter((attachment) => selection[attachment.id]?.includes(child.id))
    if (ticked.length === 0) return []
    if (ticked.length === slots.length) return [{ childId: child.id, attachmentId: null }]
    return ticked.map((attachment) => ({ childId: child.id, attachmentId: attachment.id }))
  })
}

export function sameTagSelection(left: TagSelection, right: TagSelection) {
  const slots = new Set([...Object.keys(left), ...Object.keys(right)])
  return [...slots].every((slot) => {
    const a = left[slot] ?? []
    const b = right[slot] ?? []
    return a.length === b.length && a.every((id) => b.includes(id))
  })
}
