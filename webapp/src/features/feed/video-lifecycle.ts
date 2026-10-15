import { useEffect } from 'react'
import type { RefObject } from 'react'

export function releaseVideoSource(video: HTMLVideoElement) {
  video.pause()
  try { video.currentTime = 0 } catch { /* Metadata may not have arrived before cancellation. */ }
  if (!video.hasAttribute('src') && video.querySelector('source') === null) return
  video.removeAttribute('src')
  video.querySelectorAll('source').forEach((source) => source.remove())
  video.load()
}

export function useVideoViewportLifecycle(stage: RefObject<HTMLElement | null>, video: RefObject<HTMLVideoElement | null>, fullscreen: boolean, enabled: boolean, stop: () => void) {
  useEffect(() => {
    if (fullscreen || !enabled) return
    const element = stage.current
    if (!element || typeof IntersectionObserver === 'undefined') return
    const observer = new IntersectionObserver(([entry]) => {
      if (!entry?.isIntersecting) stop()
    }, { threshold: 0 })
    observer.observe(element)
    return () => observer.disconnect()
  }, [enabled, fullscreen, stage, stop])
  useEffect(() => {
    if (!enabled) return
    const stopWhenHidden = () => { if (document.hidden) stop() }
    document.addEventListener('visibilitychange', stopWhenHidden)
    document.addEventListener('memoly:feed-inactive', stop)
    window.addEventListener('pagehide', stop)
    return () => {
      document.removeEventListener('visibilitychange', stopWhenHidden)
      document.removeEventListener('memoly:feed-inactive', stop)
      window.removeEventListener('pagehide', stop)
    }
  }, [enabled, stop])
  useEffect(() => {
    const element = video.current
    return () => { if (element) releaseVideoSource(element) }
  }, [video])
}
