export const SEEN_MIN_DURATION_MS = 1_000
export const SEEN_MIN_VISIBLE_FRACTION = 0.5

export function mediaCardSeenReady(state:
  | { kind: 'voice'; objectUrl: string | null }
  | { kind: 'video'; viewerState: 'loading' | 'ready' | 'error'; previewReady: boolean },
) {
  return state.kind === 'voice' ? Boolean(state.objectUrl) : state.viewerState === 'ready' && state.previewReady
}

export type SeenRect = { top: number; bottom: number; left: number; right: number; width: number; height: number }
export type SeenViewport = { top: number; bottom: number; left: number; right: number }

export function isSeenContentVisible(content: SeenRect, viewport: SeenViewport) {
  const availableHeight = viewport.bottom - viewport.top
  const availableWidth = viewport.right - viewport.left
  if (content.height <= 0 || content.width <= 0 || availableHeight <= 0 || availableWidth <= 0) return false
  const visibleHeight = Math.max(0, Math.min(content.bottom, viewport.bottom) - Math.max(content.top, viewport.top))
  const visibleWidth = Math.max(0, Math.min(content.right, viewport.right) - Math.max(content.left, viewport.left))
  return visibleHeight >= SEEN_MIN_VISIBLE_FRACTION * Math.min(content.height, availableHeight)
    && visibleWidth >= SEEN_MIN_VISIBLE_FRACTION * Math.min(content.width, availableWidth)
}

export class SeenDwell {
  private eligibleSince = new Map<string, number>()
  private completed = new Set<string>()

  update(id: string, eligible: boolean, now: number) {
    if (this.completed.has(id)) return false
    if (!eligible) {
      this.eligibleSince.delete(id)
      return false
    }
    const since = this.eligibleSince.get(id)
    if (since === undefined) {
      this.eligibleSince.set(id, now)
      return false
    }
    if (now - since < SEEN_MIN_DURATION_MS) return false
    this.eligibleSince.delete(id)
    this.completed.add(id)
    return true
  }

  isComplete(id: string) {
    return this.completed.has(id)
  }

  forget(id: string) {
    this.eligibleSince.delete(id)
  }

  resetCandidate(id: string) {
    if (!this.completed.has(id)) this.eligibleSince.delete(id)
  }

  clear() {
    this.eligibleSince.clear()
    this.completed.clear()
  }
}
