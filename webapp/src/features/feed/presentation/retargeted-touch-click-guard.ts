/**
 * Protects a route that replaces the touch target between pointerup and the
 * browser's compatibility click. The guard exists only for this pointer and
 * one click, with a bounded fallback window if the browser omits that click.
 */
export function installRetargetedTouchClickGuard(
  document: Document,
  view: Window,
  pointerId: number,
  x: number,
  y: number,
): () => void {
  let released = false
  let releaseTimer: ReturnType<typeof setTimeout> | null = null
  let cleaned = false

  const cleanup = () => {
    if (cleaned) return
    cleaned = true
    if (releaseTimer !== null) clearTimeout(releaseTimer)
    document.removeEventListener('pointerup', onPointerUp, true)
    document.removeEventListener('pointercancel', onPointerCancel, true)
    document.removeEventListener('pointerdown', onNewPointer, true)
    document.removeEventListener('click', onClick, true)
    view.removeEventListener('blur', cleanup)
    view.removeEventListener('pagehide', cleanup)
  }

  const onPointerUp = (event: PointerEvent) => {
    if (event.pointerId !== pointerId) return
    released = true
    if (releaseTimer !== null) clearTimeout(releaseTimer)
    releaseTimer = setTimeout(cleanup, 900)
  }
  const onPointerCancel = (event: PointerEvent) => {
    if (event.pointerId === pointerId) cleanup()
  }
  const onNewPointer = () => cleanup()
  const onClick = (event: MouseEvent) => {
    if (!released || event.detail === 0) return
    if (Math.hypot(event.clientX - x, event.clientY - y) > 24) return
    event.preventDefault()
    event.stopImmediatePropagation()
    cleanup()
  }

  document.addEventListener('pointerup', onPointerUp, true)
  document.addEventListener('pointercancel', onPointerCancel, true)
  document.addEventListener('pointerdown', onNewPointer, true)
  document.addEventListener('click', onClick, true)
  view.addEventListener('blur', cleanup)
  view.addEventListener('pagehide', cleanup)
  return cleanup
}
