(() => {
  const storageKey = 'memoly:pwa-diagnostics:v1'
  const maxEvents = 24
  const maxBytes = 8192
  const writeInterval = 2000
  const eventKinds = new Set(['app-entry', 'module-ready', 'mounted', 'startup-failed', 'startup-timeout', 'startup-asset-failed', 'startup-runtime-failed', 'startup-unhandled-rejection', 'host-sdk-unavailable', 'error', 'unhandled-rejection', 'react-boundary', 'scroll', 'resource-sample', 'media-load', 'media-error', 'media-play', 'media-pause', 'carousel-selection', 'hidden', 'visible', 'pagehide'])
  const phases = new Set(['startup', 'mounted'])
  const failureKinds = new Set(['startup-failed', 'startup-timeout', 'startup-asset-failed', 'startup-runtime-failed', 'startup-unhandled-rejection', 'host-sdk-unavailable', 'error', 'unhandled-rejection', 'react-boundary', 'media-error'])
  const countsShape = { images: 0, videos: 0, audio: 0, blobs: 0 }
  const now = () => Date.now()
  const cleanCounts = (value) => {
    const counts = { ...countsShape }
    if (!value || typeof value !== 'object' || Array.isArray(value)) return counts
    for (const key of Object.keys(counts)) {
      const number = value[key]
      if (Number.isFinite(number)) counts[key] = Math.max(0, Math.min(9999, Math.floor(number)))
    }
    return counts
  }
  const cleanEvent = (value) => {
    if (!value || typeof value !== 'object' || Array.isArray(value) || !eventKinds.has(value.kind)) return null
    const at = Number.isFinite(value.at) && value.at > 0 ? Math.min(Math.floor(value.at), now() + 86400000) : 0
    if (!at) return null
    return { kind: value.kind, at, phase: phases.has(value.phase) ? value.phase : 'startup' }
  }
  const cleanFailure = (value) => {
    if (!value || typeof value !== 'object' || Array.isArray(value) || !failureKinds.has(value.kind)) return null
    const event = cleanEvent(value)
    return event ? { kind: event.kind, at: event.at, phase: event.phase } : null
  }
  const cleanSampleTime = (value) => Number.isFinite(value) && value > 0 ? Math.min(Math.floor(value), now() + 86400000) : 0
  const cleanRun = (value) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null
    const events = Array.isArray(value.events) ? value.events.map(cleanEvent).filter(Boolean).slice(-maxEvents) : []
    const startedAt = Number.isFinite(value.startedAt) && value.startedAt > 0 ? Math.floor(value.startedAt) : 0
    if (!startedAt) return null
    const phase = phases.has(value.phase) ? value.phase : 'startup'
    const state = ['active', 'hidden', 'pagehide'].includes(value.state) ? value.state : 'active'
    const build = typeof value.build === 'string' && /^index-[A-Za-z0-9_-]{6,64}\.js$/.test(value.build) ? value.build : null
    const navigation = value.navigation === 'feed' ? 'feed' : 'other'
    const navigationType = ['navigate', 'reload', 'back_forward'].includes(value.navigationType) ? value.navigationType : 'unknown'
    const visibility = value.visibility === 'hidden' ? 'hidden' : 'visible'
    return { startedAt, phase, state, build, navigation, navigationType, visibility, counts: cleanCounts(value.counts), countsSampledAt: cleanSampleTime(value.countsSampledAt), lastFailure: cleanFailure(value.lastFailure), events }
  }
  let stored = null
  try {
    const raw = window.localStorage.getItem(storageKey)
    const parsed = typeof raw === 'string' && raw.length <= maxBytes ? JSON.parse(raw || 'null') : null
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      stored = { current: cleanRun(parsed.current), previous: cleanRun(parsed.previous) }
    }
  } catch { /* diagnostics are optional */ }
  const previous = stored?.current ?? stored?.previous ?? null
  let phase = 'startup'
  let writeTimer = 0
  let lastAttempt = 0
  let lastScroll = 0
  let lastMediaLoadAt = 0
  let lastEventKind = ''
  let mediaSampleTimer = 0
  const navigation = window.location?.pathname === '/' ? 'feed' : 'other'
  let navigationType = 'unknown'
  try {
    const type = window.performance?.getEntriesByType?.('navigation')?.[0]?.type
    if (['navigate', 'reload', 'back_forward'].includes(type)) navigationType = type
  } catch { /* navigation timing is optional */ }
  const current = { startedAt: now(), phase, state: 'active', build: null, navigation, navigationType, visibility: document.visibilityState === 'hidden' ? 'hidden' : 'visible', counts: { ...countsShape }, countsSampledAt: 0, lastFailure: null, events: [] }
  const snapshot = () => ({ current, previous })
  const persist = () => {
    if (writeTimer) return
    const wait = Math.max(0, writeInterval - (now() - lastAttempt))
    const write = () => {
      writeTimer = 0
      try {
        const serialized = JSON.stringify(snapshot())
        if (serialized.length <= maxBytes) {
          lastAttempt = now()
          window.localStorage.setItem(storageKey, serialized)
        }
      } catch { /* storage and quota failures must not affect startup */ }
    }
    if (wait) writeTimer = window.setTimeout(write, wait)
    else write()
  }
  const record = (kind, nextPhase, counts) => {
    if (!eventKinds.has(kind)) return
    if (phases.has(nextPhase)) phase = nextPhase
    current.phase = phase
    if (kind === 'hidden') current.state = 'hidden'
    if (kind === 'visible') current.state = 'active'
    if (kind === 'pagehide') current.state = 'pagehide'
    current.visibility = document.visibilityState === 'hidden' || kind === 'hidden' ? 'hidden' : 'visible'
    if (counts) { current.counts = cleanCounts(counts); current.countsSampledAt = now() }
    const at = now()
    if (failureKinds.has(kind)) current.lastFailure = { kind, at, phase }
    if (kind !== 'media-load' || lastEventKind !== 'media-load' || at - lastMediaLoadAt >= writeInterval) {
      current.events.push({ kind, at, phase })
      if (current.events.length > maxEvents) current.events.splice(0, current.events.length - maxEvents)
    } else if (current.events.length && current.events[current.events.length - 1].kind === 'media-load') {
      current.events[current.events.length - 1].at = at
    }
    lastEventKind = kind
    if (kind === 'media-load') lastMediaLoadAt = at
    persist()
  }
  const sampleCounts = (reason = 'resource-sample', emitEvent = true) => {
    try {
      const images = Array.from(document.querySelectorAll('img'))
      const videos = Array.from(document.querySelectorAll('video'))
      const audio = Array.from(document.querySelectorAll('audio'))
      const counts = {
        images: images.filter((item) => item.complete && item.naturalWidth > 0).length,
        videos: videos.filter((item) => item.readyState >= 2).length,
        audio: audio.filter((item) => item.readyState >= 2).length,
        blobs: [...images, ...videos, ...audio].filter((item) => [item.currentSrc, item.src].some((url) => typeof url === 'string' && url.startsWith('blob:'))).length,
      }
      if (emitEvent) record(reason, undefined, counts)
      else { current.counts = cleanCounts(counts); current.countsSampledAt = now(); persist() }
    } catch { /* a partial DOM must not affect app startup */ }
  }
  const scheduleMediaSample = () => {
    if (mediaSampleTimer) return
    mediaSampleTimer = window.setTimeout(() => {
      mediaSampleTimer = 0
      sampleCounts('resource-sample', false)
    }, writeInterval)
  }
  window.__MEMOLY_DIAGNOSTICS__ = { record, report: () => { sampleCounts('resource-sample', false); return JSON.stringify(snapshot()) } }
  record('app-entry')
  window.addEventListener('error', () => record('error'), true)
  window.addEventListener('unhandledrejection', () => record('unhandled-rejection'))
  document.addEventListener('visibilitychange', () => record(document.visibilityState === 'hidden' ? 'hidden' : 'visible'))
  window.addEventListener('pageshow', () => record('visible'))
  window.addEventListener('pagehide', () => record('pagehide'))
  document.addEventListener('load', (event) => { if (event.target instanceof HTMLImageElement || event.target instanceof HTMLMediaElement) { record('media-load'); scheduleMediaSample() } }, true)
  document.addEventListener('loadedmetadata', (event) => { if (event.target instanceof HTMLMediaElement) { record('media-load'); scheduleMediaSample() } }, true)
  document.addEventListener('loadeddata', (event) => { if (event.target instanceof HTMLMediaElement) { record('media-load'); scheduleMediaSample() } }, true)
  document.addEventListener('error', (event) => { if (event.target instanceof HTMLImageElement || event.target instanceof HTMLMediaElement) record('media-error') }, true)
  document.addEventListener('play', () => record('media-play'), true)
  document.addEventListener('pause', () => record('media-pause'), true)
  document.addEventListener('scroll', () => {
    if (now() - lastScroll < 15000) return
    lastScroll = now()
    sampleCounts('scroll')
  }, { passive: true, capture: true })
  document.addEventListener('DOMContentLoaded', () => {
    try {
      for (const script of document.querySelectorAll('script[src]')) {
        const basename = String(script.src || '').split('/').pop() || ''
        if (/^index-[A-Za-z0-9_-]{6,64}\.js$/.test(basename)) { current.build = basename; break }
      }
    } catch { /* build fingerprint is optional */ }
    sampleCounts('resource-sample')
  }, { once: true })
})()
