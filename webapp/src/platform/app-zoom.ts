/**
 * Prevents page zoom in WebKit surfaces that ignore or partially honor the
 * viewport maximum-scale while leaving ordinary touch input and native media
 * gestures available.
 */
export function installAppZoomPrevention(document: Document): () => void {
  const touchCapable = (document.defaultView?.navigator.maxTouchPoints ?? 0) > 0
  let touchSequenceActive = false

  const isInsideNativeMedia = (target: EventTarget | null) => {
    const element = target as Element | null
    if (typeof element?.closest === 'function' && element.closest('.pswp')) return true

    const fullscreenElement = document.fullscreenElement
    return Boolean(fullscreenElement && element && (fullscreenElement === element || fullscreenElement.contains(element)))
  }

  const preventGestureZoom = (event: Event) => {
    if (isInsideNativeMedia(event.target)) return
    if (event.cancelable) event.preventDefault()
    if (event.type === 'gesturestart' && touchSequenceActive) armMultiTouchGuards()
  }

  const preventMultitouchZoom = (event: TouchEvent) => {
    if (event.touches.length > 1 && !isInsideNativeMedia(event.target)) preventGestureZoom(event)
  }

  const preventTrackpadZoom = (event: WheelEvent) => {
    if ((event.ctrlKey || event.metaKey) && !isInsideNativeMedia(event.target)) preventGestureZoom(event)
  }

  const capturePassive: AddEventListenerOptions = { capture: true, passive: true }
  const captureBlocking: AddEventListenerOptions = { capture: true, passive: false }
  let gestureStartArmed = false
  let multiTouchGuardsArmed = false

  const armGestureStart = () => {
    if (gestureStartArmed) return
    gestureStartArmed = true
    document.addEventListener('gesturestart', preventGestureZoom, captureBlocking)
  }

  const disarmGestureStart = () => {
    if (!gestureStartArmed) return
    gestureStartArmed = false
    document.removeEventListener('gesturestart', preventGestureZoom, true)
  }

  function armMultiTouchGuards() {
    if (multiTouchGuardsArmed) return
    multiTouchGuardsArmed = true
    if (touchCapable) document.addEventListener('gesturechange', preventGestureZoom, captureBlocking)
    document.addEventListener('touchmove', preventMultitouchZoom, captureBlocking)
  }

  const disarmMultiTouchGuards = () => {
    if (!multiTouchGuardsArmed) return
    multiTouchGuardsArmed = false
    if (touchCapable) document.removeEventListener('gesturechange', preventGestureZoom, true)
    document.removeEventListener('touchmove', preventMultitouchZoom, true)
  }

  const resetTouchSequence = () => {
    touchSequenceActive = false
    disarmMultiTouchGuards()
    if (touchCapable) disarmGestureStart()
  }

  const observeTouchStart = (event: Event) => {
    touchSequenceActive = true
    // On iOS the first touchstart precedes gesturestart, so arm only this boundary here.
    // gesturechange and touchmove share WebKit's moved-event region, even for one finger.
    if (touchCapable) armGestureStart()
    const touchEvent = event as TouchEvent
    if (touchEvent.touches.length > 1 && !isInsideNativeMedia(event.target)) armMultiTouchGuards()
  }

  const observeTouchEnd = (event: Event) => {
    const touches = (event as TouchEvent).touches
    if (touches.length <= 1) disarmMultiTouchGuards()
    if (touches.length === 0) resetTouchSequence()
  }

  document.addEventListener('touchstart', observeTouchStart, capturePassive)
  document.addEventListener('touchend', observeTouchEnd, capturePassive)
  document.addEventListener('touchcancel', resetTouchSequence, capturePassive)
  if (!touchCapable) {
    // Desktop Safari uses native gesture events for trackpad pinches. Touch listeners
    // stay passive, and touchmove is armed only if a touch sequence becomes a pinch.
    document.addEventListener('gesturestart', preventGestureZoom, captureBlocking)
    document.addEventListener('gesturechange', preventGestureZoom, captureBlocking)
  }
  document.addEventListener('wheel', preventTrackpadZoom, captureBlocking)

  return () => {
    resetTouchSequence()
    if (!touchCapable) {
      document.removeEventListener('gesturestart', preventGestureZoom, true)
      document.removeEventListener('gesturechange', preventGestureZoom, true)
    }
    document.removeEventListener('touchstart', observeTouchStart, true)
    document.removeEventListener('touchend', observeTouchEnd, true)
    document.removeEventListener('touchcancel', resetTouchSequence, true)
    document.removeEventListener('wheel', preventTrackpadZoom, true)
  }
}
