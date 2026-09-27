import { useCallback, useEffect, useLayoutEffect, useRef } from 'react'
import { isSeenContentVisible, SeenDwell, type SeenViewport } from './seen-visibility'

type SeenLayer = 'feed' | 'detail' | 'fullscreen'
type Registration = { memoryId: string; layer: SeenLayer }

function visibleViewport(layer: SeenLayer, element: HTMLElement): SeenViewport {
  const visual = window.visualViewport
  const viewport: SeenViewport = {
    top: visual?.offsetTop ?? 0,
    bottom: Math.min(window.innerHeight, (visual?.offsetTop ?? 0) + (visual?.height ?? window.innerHeight)),
    left: visual?.offsetLeft ?? 0,
    right: Math.min(window.innerWidth, (visual?.offsetLeft ?? 0) + (visual?.width ?? window.innerWidth)),
  }
  if (document.fullscreenElement && element.contains(document.fullscreenElement)) return viewport
  if (layer === 'feed') {
    const nav = document.querySelector<HTMLElement>('[data-testid="bottom-navigation"]')
    if (nav) viewport.bottom = Math.min(viewport.bottom, nav.getBoundingClientRect().top)
    const hostSurface = element.closest<HTMLElement>('[data-memoly-feed]')
    const topInset = Number.parseFloat(getComputedStyle(hostSurface ?? document.documentElement).getPropertyValue('--host-inset-top'))
    if (Number.isFinite(topInset)) viewport.top = Math.max(viewport.top, topInset)
  } else if (layer === 'detail') {
    const surface = element.closest<HTMLElement>('.memoly-detail-surface')
    if (surface) {
      const rect = surface.getBoundingClientRect()
      viewport.top = Math.max(viewport.top, rect.top)
      viewport.bottom = Math.min(viewport.bottom, rect.bottom)
      viewport.left = Math.max(viewport.left, rect.left)
      viewport.right = Math.min(viewport.right, rect.right)
    }
  }
  return viewport
}

function blockedByOverlay(layer: SeenLayer, element: HTMLElement) {
  const photoViewer = document.querySelector('.pswp--open')
  if (layer === 'fullscreen') return !(photoViewer?.contains(element) || document.fullscreenElement?.contains(element))
  if (document.fullscreenElement) return !element.contains(document.fullscreenElement)
  if (photoViewer) return true
  const overlays = document.querySelectorAll<HTMLElement>('[aria-modal="true"], [role="dialog"][data-state="open"], [data-vaul-drawer][data-state="open"]')
  for (const overlay of overlays) {
    if (layer === 'detail' && overlay.contains(element)) continue
    return true
  }
  return false
}

function contentReady(element: HTMLElement) {
  return element.dataset.seenReady === 'true' || element.querySelector('[data-seen-ready="true"]') !== null
}

export function useMemorySeenObserver(enabled: boolean, feedBlocked: boolean, onCandidate: (memoryId: string) => void) {
  const registrations = useRef(new Map<HTMLElement, Registration>())
  const refCallbacks = useRef(new Map<string, (element: HTMLElement | null) => void>())
  const observer = useRef<IntersectionObserver | null>(null)
  const intersecting = useRef(new Set<HTMLElement>())
  const evaluateRef = useRef<() => void>(() => undefined)
  const onCandidateRef = useRef(onCandidate)
  const enabledRef = useRef(enabled)
  const feedBlockedRef = useRef(feedBlocked)

  useLayoutEffect(() => {
    onCandidateRef.current = onCandidate
    enabledRef.current = enabled
    feedBlockedRef.current = feedBlocked
    evaluateRef.current()
  }, [onCandidate, enabled, feedBlocked])

  const register = useCallback((memoryId: string, layer: SeenLayer) => {
    const key = `${layer}:${memoryId}`
    const existing = refCallbacks.current.get(key)
    if (existing) return existing
    const callback = (node: HTMLElement | null) => {
      for (const [prior, registration] of registrations.current) {
        if (registration.memoryId !== memoryId || registration.layer !== layer) continue
        registrations.current.delete(prior)
        intersecting.current.delete(prior)
        observer.current?.unobserve(prior)
      }
      if (node) {
        registrations.current.set(node, { memoryId, layer })
        observer.current?.observe(node)
      }
      evaluateRef.current()
    }
    refCallbacks.current.set(key, callback)
    return callback
  }, [])

  useEffect(() => {
    const intersectingElements = intersecting.current
    const dwell = new SeenDwell()
    let priorIds = new Set<string>()
    let timer: number | null = null
    let frame: number | null = null
    let disposed = false
    let pageActive = true
    const evaluate = () => {
      if (disposed) return
      const eligibility = new Map<string, boolean>()
      const active = enabledRef.current && pageActive && document.visibilityState === 'visible'
      for (const [element, registration] of registrations.current) {
        if (!element.isConnected) continue
        const prior = eligibility.get(registration.memoryId) ?? false
        if (!intersectingElements.has(element)) {
          eligibility.set(registration.memoryId, prior)
          continue
        }
        const rect = element.contains(document.fullscreenElement) && document.fullscreenElement instanceof HTMLElement
          ? document.fullscreenElement.getBoundingClientRect()
          : element.getBoundingClientRect()
        const eligible = active && !(registration.layer === 'feed' && feedBlockedRef.current) && contentReady(element) && !blockedByOverlay(registration.layer, element)
          && isSeenContentVisible(rect, visibleViewport(registration.layer, element))
        eligibility.set(registration.memoryId, prior || eligible)
      }
      let hasEligible = false
      for (const id of priorIds) if (!eligibility.has(id)) dwell.update(id, false, performance.now())
      for (const [id, eligible] of eligibility) {
        if (dwell.update(id, eligible, performance.now())) onCandidateRef.current(id)
        if (eligible && !dwell.isComplete(id)) hasEligible = true
      }
      priorIds = new Set(eligibility.keys())
      if (timer !== null) window.clearTimeout(timer)
      timer = hasEligible ? window.setTimeout(evaluate, 100) : null
    }
    const schedule = () => {
      if (frame !== null) return
      frame = window.requestAnimationFrame(() => { frame = null; evaluate() })
    }
    const onVisibility = () => { evaluate(); schedule() }
    const onPageHide = () => { pageActive = false; evaluate() }
    const onPageShow = () => { pageActive = true; evaluate() }
    evaluateRef.current = schedule
    observer.current = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        const element = entry.target as HTMLElement
        if (entry.isIntersecting) intersectingElements.add(element)
        else intersectingElements.delete(element)
      }
      schedule()
    }, { threshold: [0, 0.25, 0.5, 0.75, 1] })
    for (const element of registrations.current.keys()) observer.current.observe(element)
    const mutations = new MutationObserver(schedule)
    mutations.observe(document.body, { attributes: true, attributeFilter: ['data-seen-ready', 'data-state', 'aria-modal', 'class'], childList: true, subtree: true })
    document.addEventListener('scroll', schedule, true)
    document.addEventListener('visibilitychange', onVisibility)
    document.addEventListener('fullscreenchange', schedule)
    window.addEventListener('resize', schedule)
    window.addEventListener('pagehide', onPageHide)
    window.addEventListener('pageshow', onPageShow)
    window.visualViewport?.addEventListener('resize', schedule)
    window.visualViewport?.addEventListener('scroll', schedule)
    schedule()
    return () => {
      disposed = true
      evaluateRef.current = () => undefined
      if (timer !== null) window.clearTimeout(timer)
      if (frame !== null) window.cancelAnimationFrame(frame)
      observer.current?.disconnect()
      observer.current = null
      intersectingElements.clear()
      mutations.disconnect()
      document.removeEventListener('scroll', schedule, true)
      document.removeEventListener('visibilitychange', onVisibility)
      document.removeEventListener('fullscreenchange', schedule)
      window.removeEventListener('resize', schedule)
      window.removeEventListener('pagehide', onPageHide)
      window.removeEventListener('pageshow', onPageShow)
      window.visualViewport?.removeEventListener('resize', schedule)
      window.visualViewport?.removeEventListener('scroll', schedule)
      dwell.clear()
    }
  }, [])

  return register
}
