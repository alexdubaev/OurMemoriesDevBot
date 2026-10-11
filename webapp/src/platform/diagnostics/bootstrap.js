(() => {
  const storageKey = 'memoly:pwa-diagnostics:v1'
  const maxEvents = 24
  const maxBytes = 8192
  const writeInterval = 2000
  const rootHeartbeatInterval = 5000
  const eventKinds = new Set(['app-entry', 'module-ready', 'mounted', 'root-replaced', 'screen-loss', 'auth-restoring', 'auth-ready', 'auth-signed-in', 'auth-signed-out', 'cache-wait', 'cache-ready', 'startup-failed', 'startup-timeout', 'startup-asset-failed', 'startup-runtime-failed', 'startup-unhandled-rejection', 'host-sdk-unavailable', 'error', 'unhandled-rejection', 'react-boundary', 'scroll', 'resource-sample', 'media-load', 'media-error', 'media-play', 'media-pause', 'carousel-selection', 'hidden', 'visible', 'pagehide'])
  const phases = new Set(['startup', 'mounted'])
  const failureKinds = new Set(['screen-loss', 'startup-failed', 'startup-timeout', 'startup-asset-failed', 'startup-runtime-failed', 'startup-unhandled-rejection', 'host-sdk-unavailable', 'error', 'unhandled-rejection', 'react-boundary', 'media-error'])
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
  const cleanRootState = (value) => ['present', 'empty', 'missing', 'startup-placeholder', 'unknown'].includes(value) ? value : 'unknown'
  const cleanIncident = (value) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null
    const kind = ['screen-loss', 'previous-run-unclosed'].includes(value.kind) ? value.kind : null
    const at = cleanSampleTime(value.at)
    const environment = cleanEnvironment(value.environment)
    const lastObservedAt = cleanSampleTime(value.lastObservedAt)
    const error = cleanError(value.error)
    const lastFailure = cleanFailure(value.lastFailure)
    const context = Array.isArray(value.context) ? value.context.map(cleanEvent).filter(Boolean).slice(-6) : []
    const auth = value.auth && typeof value.auth === 'object' ? { bootstrapping: value.auth.bootstrapping === true, authenticated: value.auth.authenticated === true, at: cleanSampleTime(value.auth.at) } : null
    const cache = value.cache && typeof value.cache === 'object' ? { hydrated: value.cache.hydrated === true, at: cleanSampleTime(value.cache.at) } : null
    const runId = typeof value.runId === 'string' && /^[a-f0-9-]{8,40}$/.test(value.runId) ? value.runId : null
    const sourceStartedAt = Number.isFinite(value.sourceStartedAt) && value.sourceStartedAt > 0 ? Math.floor(value.sourceStartedAt) : 0
    const rootIdentity = Number.isInteger(value.rootIdentity) ? Math.max(0, Math.min(9999, value.rootIdentity)) : 0
    const navigationType = ['navigate', 'reload', 'back_forward'].includes(value.navigationType) ? value.navigationType : 'unknown'
    const build = typeof value.build === 'string' && /^index-[A-Za-z0-9_-]{6,64}\.js$/.test(value.build) ? value.build : null
    const lastHealthyAt = cleanSampleTime(value.lastHealthyAt)
    return kind && at ? { kind, at, rootState: cleanRootState(value.rootState), rootIdentity, navigationType, build, runId, sourceStartedAt, lastHealthyAt, environment, lastObservedAt, auth, cache, error, lastFailure, context } : null
  }
  const cleanEnvironment = (value) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null
    const version = (item) => typeof item === 'string' && item.length <= 24 && /^\d+(?:\.\d+){0,3}$/.test(item) ? item : null
    return { os: ['ios', 'android', 'other'].includes(value.os) ? value.os : 'other', osVersion: version(value.osVersion), webkitVersion: version(value.webkitVersion), standalone: value.standalone === true }
  }
  const cleanError = (value) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null
    const allowedClasses = new Set(['Error', 'TypeError', 'RangeError', 'ReferenceError', 'SyntaxError', 'URIError', 'EvalError', 'DOMException', 'NetworkError'])
    const errorClass = allowedClasses.has(value.errorClass) ? value.errorClass : 'Error'
    const frames = Array.isArray(value.frames) ? value.frames.slice(0, 4).map((frame) => {
      if (!frame || typeof frame !== 'object' || !/^(?:index|vendor|react-vendor|chunk)-[A-Za-z0-9_-]{6,64}\.js$/.test(frame.asset)) return null
      return { asset: frame.asset, line: Number.isInteger(frame.line) ? Math.max(0, Math.min(999999, frame.line)) : 0, column: Number.isInteger(frame.column) ? Math.max(0, Math.min(999999, frame.column)) : 0 }
    }).filter(Boolean) : []
    return { errorClass, frames }
  }
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
    const lastObservedAt = cleanSampleTime(value.lastObservedAt)
    const rootState = cleanRootState(value.rootState)
    const rootIdentity = Number.isInteger(value.rootIdentity) && value.rootIdentity >= 0 ? Math.min(value.rootIdentity, 9999) : 0
    const environment = cleanEnvironment(value.environment)
    const auth = value.auth && typeof value.auth === 'object' ? { bootstrapping: value.auth.bootstrapping === true, authenticated: value.auth.authenticated === true, at: cleanSampleTime(value.auth.at) } : null
    const cache = value.cache && typeof value.cache === 'object' ? { hydrated: value.cache.hydrated === true, at: cleanSampleTime(value.cache.at) } : null
    const error = cleanError(value.error)
    return { startedAt, runId: typeof value.runId === 'string' && /^[a-f0-9-]{8,40}$/.test(value.runId) ? value.runId : null, phase, state, build, navigation, navigationType, visibility, lastObservedAt, lastHealthyAt: cleanSampleTime(value.lastHealthyAt), rootState, rootIdentity, environment, auth, cache, error, counts: cleanCounts(value.counts), countsSampledAt: cleanSampleTime(value.countsSampledAt), lastFailure: cleanFailure(value.lastFailure), events }
  }
  let stored = null
  try {
    const raw = window.localStorage.getItem(storageKey)
    const parsed = typeof raw === 'string' && raw.length <= maxBytes ? JSON.parse(raw || 'null') : null
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      stored = { current: cleanRun(parsed.current), previous: cleanRun(parsed.previous), incident: cleanIncident(parsed.incident) }
    }
  } catch { /* diagnostics are optional */ }
  const previous = stored?.current ?? stored?.previous ?? null
  let pinnedIncident = stored?.incident ?? null
  const eligibleCurrentRun = stored?.current?.phase === 'mounted' && stored.current.state !== 'pagehide' ? stored.current : null
  const eligibleFallbackRun = !stored?.current && stored?.previous?.phase === 'mounted' && stored.previous.state !== 'pagehide' ? stored.previous : null
  const unclosedRun = eligibleCurrentRun ?? eligibleFallbackRun
  const sameInferredRun = unclosedRun && pinnedIncident?.kind === 'previous-run-unclosed'
    && (unclosedRun.runId && pinnedIncident.runId
      ? pinnedIncident.runId === unclosedRun.runId
      : pinnedIncident.sourceStartedAt > 0 && pinnedIncident.sourceStartedAt === unclosedRun.startedAt)
  if (unclosedRun && (!pinnedIncident || (pinnedIncident.kind === 'previous-run-unclosed' && !sameInferredRun))) {
    pinnedIncident = makeUnclosedIncident(unclosedRun)
  }
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
  let rootIdentity = 0
  let rootObserver = null
  let rootHeartbeat = 0
  let rootWasMounted = false
  let lastRootState = 'unknown'
  const current = { startedAt: now(), runId: makeRunId(), phase, state: 'active', build: null, navigation, navigationType, visibility: document.visibilityState === 'hidden' ? 'hidden' : 'visible', lastObservedAt: now(), lastHealthyAt: 0, rootState: 'unknown', rootIdentity: 0, environment: readEnvironment(), auth: null, cache: null, error: null, counts: { ...countsShape }, countsSampledAt: 0, lastFailure: null, events: [] }
  const snapshot = () => ({ current, previous, incident: pinnedIncident })
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
  const record = (kind, nextPhase, counts, error) => {
    if (!eventKinds.has(kind)) return
    if (phases.has(nextPhase)) phase = nextPhase
    current.phase = phase
    if (kind === 'hidden') current.state = 'hidden'
    if (kind === 'visible') current.state = 'active'
    if (kind === 'pagehide') current.state = 'pagehide'
    current.lastObservedAt = now()
    current.visibility = document.visibilityState === 'hidden' || kind === 'hidden' ? 'hidden' : 'visible'
    if (counts) { current.counts = cleanCounts(counts); current.countsSampledAt = now() }
    const at = now()
    if (error) current.error = cleanError(error)
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
    if (kind === 'mounted') startRootWatch()
  }
  const inspectRoot = (heartbeat = false) => {
    if (!rootWasMounted || document.visibilityState === 'hidden') return
    let root = null
    try { root = document.getElementById('root') } catch { /* partial DOM */ }
    let state = 'unknown'
    if (!root) state = 'missing'
    else {
      const children = root.children?.length ?? 0
      if (children === 1) {
        const child = root.firstElementChild
        const textNodes = child?.childNodes
        const onlyTextNode = textNodes?.length === 1 && textNodes[0]?.nodeType === 3 ? textNodes[0].nodeValue : null
        if (child?.tagName === 'P' && child.getAttribute?.('role') === 'status' && String(onlyTextNode || '').trim() === 'Загрузка memoLy…') state = 'startup-placeholder'
        else state = 'present'
      } else if (!root.childNodes?.length) state = 'empty'
      else state = 'present'
      if (rootIdentity && root !== observedRoot) record('root-replaced', 'mounted')
      if (root !== observedRoot) { observedRoot = root; rootIdentity = Math.min(rootIdentity + 1, 9999); current.rootIdentity = rootIdentity }
    }
    current.rootState = state
    current.lastObservedAt = now()
    if (state === 'present') current.lastHealthyAt = current.lastObservedAt
    if (state !== lastRootState) {
      if (state === 'missing' || state === 'empty' || state === 'startup-placeholder') {
        pinnedIncident = makeIncident('screen-loss', state)
        record('screen-loss', 'mounted')
        persistNow()
      }
      lastRootState = state
      persist()
    }
    if (heartbeat) persist()
  }
  let observedRoot = null
  const startRootWatch = () => {
    if (rootWasMounted) return
    rootWasMounted = true
    inspectRoot()
    try {
      if (typeof MutationObserver === 'function') {
        rootObserver = new MutationObserver((records) => {
          if (records.some((record) => mutationTouchesRoot(record))) inspectRoot(false)
        })
        rootObserver.observe(document.documentElement, { childList: true, subtree: true, characterData: true })
      }
    } catch { /* mutation observation is optional */ }
    rootHeartbeat = window.setInterval(() => inspectRoot(true), rootHeartbeatInterval)
    persistNow()
  }
  const mutationTouchesRoot = (record) => {
    const root = observedRoot
    const status = root?.firstElementChild
    if (record.target === root || record.target === status) return true
    const nodes = [...(record.addedNodes ?? []), ...(record.removedNodes ?? [])]
    return nodes.some((node) => {
      if (node === root || node?.id === 'root') return true
      try { return Boolean(root && node?.contains?.(root)) } catch { return false }
    })
  }
  const persistNow = () => {
    if (writeTimer) { window.clearTimeout(writeTimer); writeTimer = 0 }
    lastAttempt = 0
    persist()
  }
  function makeRunId() {
    try { return window.crypto?.randomUUID?.() ?? `${now().toString(16)}-${Math.random().toString(16).slice(2, 10)}` } catch { return `${now().toString(16)}-${Math.random().toString(16).slice(2, 10)}` }
  }
  function makeIncident(kind, rootState) {
    return { kind, at: now(), rootState: cleanRootState(rootState), rootIdentity: current.rootIdentity, navigationType: current.navigationType, build: current.build, runId: current.runId, lastHealthyAt: current.lastHealthyAt, environment: current.environment, lastObservedAt: current.lastObservedAt, auth: current.auth, cache: current.cache, error: current.error, lastFailure: cleanFailure(current.lastFailure), context: current.events.slice(-6) }
  }
  function makeUnclosedIncident(run) {
    return { kind: 'previous-run-unclosed', at: now(), rootState: cleanRootState(run.rootState), rootIdentity: run.rootIdentity, navigationType: run.navigationType, build: run.build, runId: run.runId, sourceStartedAt: run.startedAt, lastHealthyAt: run.lastHealthyAt, environment: run.environment, lastObservedAt: run.lastObservedAt, auth: run.auth, cache: run.cache, error: run.error, lastFailure: run.lastFailure, context: run.events.slice(-6) }
  }
  function readEnvironment() {
    const ua = typeof navigator !== 'undefined' && typeof navigator.userAgent === 'string' ? navigator.userAgent : ''
    const os = /iPhone|iPad|iPod/.test(ua) ? 'ios' : /Android/.test(ua) ? 'android' : 'other'
    const osMatch = os === 'ios' ? ua.match(/(?:iPhone OS|CPU OS) ([\d_]+)/) : os === 'android' ? ua.match(/Android ([\d.]+)/) : null
    const webkit = ua.match(/AppleWebKit\/([\d.]+)/)
    const version = (value) => value ? value.replaceAll('_', '.') : null
    let standalone = false
    try { standalone = window.matchMedia?.('(display-mode: standalone)')?.matches === true || navigator.standalone === true } catch { /* optional */ }
    return cleanEnvironment({ os, osVersion: version(osMatch?.[1]), webkitVersion: version(webkit?.[1]), standalone })
  }
  const updateState = (area, value) => {
    const at = now()
    if (area === 'auth' && value && typeof value === 'object') {
      const next = { bootstrapping: value.bootstrapping === true, authenticated: value.authenticated === true, at }
      if (!current.auth || current.auth.bootstrapping !== next.bootstrapping || current.auth.authenticated !== next.authenticated) {
        const kind = next.bootstrapping ? 'auth-restoring' : current.auth?.authenticated !== next.authenticated ? next.authenticated ? 'auth-signed-in' : 'auth-signed-out' : 'auth-ready'
        record(kind)
      }
      current.auth = next
    }
    if (area === 'cache' && value && typeof value === 'object') {
      const next = { hydrated: value.hydrated === true, at }
      if (!current.cache || current.cache.hydrated !== next.hydrated) record(next.hydrated ? 'cache-ready' : 'cache-wait')
      current.cache = next
    }
    current.lastObservedAt = at
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
  window.__MEMOLY_DIAGNOSTICS__ = { record, updateState, report: () => { sampleCounts('resource-sample', false); return JSON.stringify(snapshot()) } }
  record('app-entry')
  window.addEventListener('error', (event) => record('error', undefined, undefined, sanitizeError(event)), true)
  window.addEventListener('unhandledrejection', (event) => record('unhandled-rejection', undefined, undefined, sanitizeError({ error: event?.reason })))
  document.addEventListener('visibilitychange', () => { record(document.visibilityState === 'hidden' ? 'hidden' : 'visible'); inspectRoot() })
  window.addEventListener('pageshow', () => record('visible'))
  window.addEventListener('pagehide', () => record('pagehide'))
  window.addEventListener('pagehide', persistNow)
  function sanitizeError(event) {
    try {
    const error = event?.error ?? event
    const errorClass = error && typeof error.name === 'string' ? error.name : 'Error'
    const stack = error && typeof error.stack === 'string' ? error.stack : ''
    const frames = []
    const expression = /(https?:\/\/[^\s/]+)?\/assets\/((?:index|vendor|react-vendor|chunk)-[A-Za-z0-9_-]{6,64}\.js):(\d+):(\d+)/g
    let match
    while ((match = expression.exec(stack)) && frames.length < 4) {
      if (match[1]) {
        try { if (new URL(match[1]).origin !== window.location.origin) continue } catch { continue }
      }
      frames.push({ asset: match[2], line: Number(match[3]), column: Number(match[4]) })
    }
    if (frames.length < 4 && typeof event?.filename === 'string') {
      try {
        const url = new URL(event.filename, window.location.href)
        const asset = url.pathname.split('/').pop()
        if (url.origin === window.location.origin && /^(?:index|vendor|react-vendor|chunk)-[A-Za-z0-9_-]{6,64}\.js$/.test(asset)) {
          frames.push({ asset, line: Number(event.lineno) || 0, column: Number(event.colno) || 0 })
        }
      } catch { /* invalid source locations are discarded */ }
    }
    return cleanError({ errorClass, frames })
    } catch { return { errorClass: 'Error', frames: [] } }
  }
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
