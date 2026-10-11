export async function requestVideoStageFullscreen(stage: HTMLElement | null, video: HTMLVideoElement | null) {
  if (stage?.requestFullscreen && (typeof document === 'undefined' || document.fullscreenEnabled)) {
    try { await stage.requestFullscreen() } catch { /* Keep inline controls usable when the browser rejects fullscreen. */ }
    return
  }
  const webkitVideo = video as (HTMLVideoElement & { webkitEnterFullscreen?: () => void }) | null
  try { webkitVideo?.webkitEnterFullscreen?.() } catch { /* Native fullscreen can reject when the media is not ready. */ }
}

export function supportsVideoStageFullscreen() {
  const domFullscreenAvailable = typeof HTMLElement !== 'undefined'
    && 'requestFullscreen' in HTMLElement.prototype
    && (typeof document === 'undefined' || document.fullscreenEnabled)
  const webkitFullscreenAvailable = typeof HTMLVideoElement !== 'undefined'
    && 'webkitEnterFullscreen' in HTMLVideoElement.prototype
  return Boolean(domFullscreenAvailable || webkitFullscreenAvailable)
}
