/**
 * Prevents page zoom in WebKit surfaces that ignore or partially honor the
 * viewport maximum-scale while leaving ordinary touch input and native media
 * gestures available.
 */
export function installAppZoomPrevention(document: Document): () => void {
  const isInsideNativeMedia = (target: EventTarget | null) => {
    const element = target as Element | null
    if (typeof element?.closest === 'function' && element.closest('.pswp')) return true

    const fullscreenElement = document.fullscreenElement
    return Boolean(fullscreenElement && element && (fullscreenElement === element || fullscreenElement.contains(element)))
  }

  const preventGestureZoom = (event: Event) => {
    if (!isInsideNativeMedia(event.target) && event.cancelable) event.preventDefault()
  }

  const preventMultitouchZoom = (event: TouchEvent) => {
    if (event.touches.length > 1 && !isInsideNativeMedia(event.target)) preventGestureZoom(event)
  }

  const preventTrackpadZoom = (event: WheelEvent) => {
    if ((event.ctrlKey || event.metaKey) && !isInsideNativeMedia(event.target)) preventGestureZoom(event)
  }

  const options: AddEventListenerOptions = { capture: true, passive: false }
  document.addEventListener('gesturestart', preventGestureZoom, options)
  document.addEventListener('gesturechange', preventGestureZoom, options)
  document.addEventListener('touchmove', preventMultitouchZoom, options)
  document.addEventListener('wheel', preventTrackpadZoom, options)

  return () => {
    document.removeEventListener('gesturestart', preventGestureZoom, true)
    document.removeEventListener('gesturechange', preventGestureZoom, true)
    document.removeEventListener('touchmove', preventMultitouchZoom, true)
    document.removeEventListener('wheel', preventTrackpadZoom, true)
  }
}
