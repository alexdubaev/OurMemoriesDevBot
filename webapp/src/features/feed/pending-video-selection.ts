import type { MemoryDto } from '@web-app-demo/contracts'

export function hasPendingPrivateVideo(memory: MemoryDto) {
  return memory.attachments.some((attachment) => attachment.source === 'private_storage' && attachment.kind === 'video' && (
    attachment.renditionStatus === 'pending' ||
    attachment.renditionStatus === 'ready' && Boolean(attachment.playbackPath) && !attachment.previewPath && !attachment.displayPath
  ))
}

export function selectPendingPrivateVideoIds(items: MemoryDto[], opened: MemoryDto[], nearbyIds: string[], limit: number, excludedIds: ReadonlySet<string> = new Set()) {
  const pendingInList = new Set(items.filter(hasPendingPrivateVideo).map((memory) => memory.id))
  return [...new Set([...opened.filter(hasPendingPrivateVideo).map((memory) => memory.id), ...nearbyIds.filter((id) => pendingInList.has(id))])].filter((id) => !excludedIds.has(id)).slice(0, limit)
}
