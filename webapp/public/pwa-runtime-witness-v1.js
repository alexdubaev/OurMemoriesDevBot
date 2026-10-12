(() => {
  const journalFileName = 'memoly-pwa-runtime-witness-v1.bin'
  const journalVersion = 1
  const slotBytes = 8192
  const journalBytes = slotBytes * 2
  const maxJournalBytes = 8192
  const probeIntervalMs = 5000
  const responseDeadlineMs = 10000
  const monitorIntervalMs = 1000
  const monitorLatenessMs = 3000
  const maxRuns = 2
  const allowedEvents = new Set([
    'app-entry', 'module-ready', 'mounted', 'root-replaced', 'app-loading', 'app-working', 'screen-loss',
    'auth-restoring', 'auth-ready', 'auth-signed-in', 'auth-signed-out', 'cache-wait', 'cache-ready',
    'startup-failed', 'startup-timeout', 'startup-asset-failed', 'startup-runtime-failed',
    'startup-unhandled-rejection', 'host-sdk-unavailable', 'error', 'unhandled-rejection',
    'react-boundary', 'scroll', 'resource-sample', 'media-load', 'media-error', 'media-play',
    'media-pause', 'carousel-selection', 'hidden', 'visible', 'pagehide',
  ])
  const allowedRootStates = new Set(['present', 'app-loading', 'empty', 'missing', 'startup-placeholder', 'unknown'])
  let directoryHandle = null
  let fileHandle = null
  let accessHandle = null
  let journalReady = false
  let journalOpenPromise = null
  let lifecycleGeneration = 0
  let journalRecords = []
  let journalGeneration = 0
  let activeSlot = -1
  let storageReason = null
  let storageTiming = { backend: 'opfs-sync', lastFlushAt: 0, lastReadBackAt: 0, gapReadBackAt: 0 }
  let current = null
  let pendingProbe = null
  let probeSequence = 0
  let nextProbeAt = 0
  let awaitingFreshAck = false
  let nextFreshAckAt = 0
  let lastAckAt = 0
  let monitorLastAt = performance.now()
  let monitorLastWallAt = Date.now()
  let monitorGap = null
  let evidence = null
  let status = 'starting'
  let writeDirty = false
  let writePromise = null
  let persistTimer = 0
  let lastPersistAt = 0

  const post = (message) => { try { self.postMessage(message) } catch { /* diagnostics are optional */ } }
  const finiteTime = (value) => Number.isFinite(value) && value > 0 ? Math.floor(value) : 0
  const cleanAuthState = (value) => value && typeof value === 'object'
    ? { bootstrapping: value.bootstrapping === true, authenticated: value.authenticated === true, at: finiteTime(value.at) }
    : null
  const cleanEvents = (value) => Array.isArray(value)
    ? value.slice(-6).map((item) => item && allowedEvents.has(item.kind) && Number.isFinite(item.at)
      ? { kind: item.kind, at: finiteTime(item.at), phase: item.phase === 'mounted' ? 'mounted' : 'startup' }
      : null).filter(Boolean)
    : []
  const cleanSample = (value) => {
    if (!value || typeof value !== 'object' || typeof value.runId !== 'string' || !/^[a-f0-9-]{8,40}$/.test(value.runId)) return null
    return {
      runId: value.runId,
      sentAt: finiteTime(value.sentAt),
      documentTimeOrigin: finiteTime(value.documentTimeOrigin),
      phase: value.phase === 'mounted' ? 'mounted' : 'startup',
      state: ['active', 'hidden', 'pagehide'].includes(value.state) ? value.state : 'active',
      visibility: value.visibility === 'hidden' ? 'hidden' : 'visible',
      lastObservedAt: finiteTime(value.lastObservedAt),
      lastHealthyAt: finiteTime(value.lastHealthyAt),
      rootState: allowedRootStates.has(value.rootState) ? value.rootState : 'unknown',
      auth: cleanAuthState(value.auth),
      cache: value.cache && typeof value.cache === 'object' ? { hydrated: value.cache.hydrated === true, at: finiteTime(value.cache.at) } : null,
      events: cleanEvents(value.events),
      pagehidePersisted: typeof value.pagehidePersisted === 'boolean' ? value.pagehidePersisted : null,
      pageshowPersisted: typeof value.pageshowPersisted === 'boolean' ? value.pageshowPersisted : null,
    }
  }
  const cleanRecord = (value) => {
    if (!value || typeof value !== 'object' || typeof value.runId !== 'string' || !/^[a-f0-9-]{8,40}$/.test(value.runId)) return null
    const sample = cleanSample(value.sample)
    if (!sample || sample.runId !== value.runId) return null
    const storedEvidence = value.evidence?.kind === 'main-response-gap' && value.evidence.runId === value.runId
      ? {
          kind: 'main-response-gap',
          runId: value.runId,
          probeSeq: Number.isInteger(value.evidence.probeSeq) ? Math.max(0, value.evidence.probeSeq) : 0,
          sentAt: finiteTime(value.evidence.sentAt),
          deadlineAt: finiteTime(value.evidence.deadlineAt),
          evidenceAt: finiteTime(value.evidence.evidenceAt),
          lastAckAt: finiteTime(value.evidence.lastAckAt),
          visibilityAtLastAck: value.evidence.visibilityAtLastAck === 'hidden' ? 'hidden' : 'visible',
          sample: cleanSample(value.evidence.sample),
        }
      : null
    const storedMonitorGap = value.monitorGap && typeof value.monitorGap === 'object'
      ? {
          fromAt: finiteTime(value.monitorGap.fromAt),
          observedAt: finiteTime(value.monitorGap.observedAt),
          elapsedMs: Number.isFinite(value.monitorGap.elapsedMs) ? Math.max(0, Math.min(86400000, Math.floor(value.monitorGap.elapsedMs))) : 0,
          visibilityAtLastAck: value.monitorGap.visibilityAtLastAck === 'hidden' ? 'hidden' : 'visible',
        }
      : null
    return {
      runId: value.runId,
      updatedAt: Math.min(finiteTime(value.updatedAt), Date.now() + 86400000),
      lastAckAt: Math.min(finiteTime(value.lastAckAt), Date.now() + 86400000),
      sample,
      evidence: storedEvidence,
      monitorGap: storedMonitorGap,
      status: ['ready', 'awaiting-fresh-ack', 'storage-unavailable'].includes(value.status) ? value.status : 'ready',
      storageReason: ['opfs-api-unavailable', 'storage-busy', 'storage-open-failed', 'journal-corrupt', 'journal-write-failed', 'journal-record-too-large', 'storage-quota-exceeded', 'storage-sync-method-unavailable', 'storage-open-cancelled'].includes(value.storageReason) ? value.storageReason : null,
      storage: value.storage?.backend === 'opfs-sync' ? {
        backend: 'opfs-sync',
        lastFlushAt: finiteTime(value.storage.lastFlushAt),
        lastReadBackAt: finiteTime(value.storage.lastReadBackAt),
        gapReadBackAt: finiteTime(value.storage.gapReadBackAt),
      } : null,
    }
  }
  const reportState = () => {
    if (!current) return
    current.updatedAt = Date.now()
    current.lastAckAt = lastAckAt
    current.evidence = evidence
    current.monitorGap = monitorGap
    current.status = status === 'storage-unavailable' ? status : awaitingFreshAck ? 'awaiting-fresh-ack' : 'ready'
    current.storageReason = storageReason
    current.storage = { ...storageTiming }
    post({ type: 'record', record: cleanRecord(current) })
  }
  const checksum = (text) => {
    let hash = 2166136261
    for (const byte of new TextEncoder().encode(text)) hash = Math.imul(hash ^ byte, 16777619) >>> 0
    return hash.toString(16).padStart(8, '0')
  }
  const requireSync = (result) => {
    if (result && typeof result.then === 'function') {
      try { result.catch?.(() => {}) } catch { /* diagnostics are optional */ }
      throw new Error('storage-sync-method-unavailable')
    }
    return result
  }
  const readSlot = (slot, handle = accessHandle) => {
    const buffer = new Uint8Array(slotBytes)
    const read = requireSync(handle.read(buffer, { at: slot * slotBytes }))
    if (read !== slotBytes) return null
    const end = buffer.indexOf(0)
    if (end <= 0) return null
    try {
      const envelope = JSON.parse(new TextDecoder().decode(buffer.subarray(0, end)))
      if (envelope?.magic !== 'MWJ1' || envelope.version !== journalVersion || !Number.isSafeInteger(envelope.generation) || envelope.generation < 1 || typeof envelope.payload !== 'string' || envelope.length !== new TextEncoder().encode(envelope.payload).byteLength || envelope.length > maxJournalBytes || envelope.checksum !== checksum(envelope.payload)) return null
      const parsed = JSON.parse(envelope.payload)
      if (!Array.isArray(parsed.records)) return null
      const records = parsed.records.map(cleanRecord).filter(Boolean)
      if (records.length > maxRuns) return null
      return { generation: envelope.generation, records, slot }
    } catch { return null }
  }
  const encodeSlot = (generation, records) => {
    const payload = JSON.stringify({ records })
    const payloadBytes = new TextEncoder().encode(payload)
    if (payloadBytes.byteLength > maxJournalBytes) throw new Error('journal-record-too-large')
    const envelope = JSON.stringify({ magic: 'MWJ1', version: journalVersion, generation, length: payloadBytes.byteLength, checksum: checksum(payload), payload })
    const bytes = new TextEncoder().encode(envelope)
    if (bytes.byteLength > slotBytes) throw new Error('journal-record-too-large')
    const slot = new Uint8Array(slotBytes)
    slot.set(bytes)
    return slot
  }
  const syncCommit = (records) => {
    if (!accessHandle) throw new Error(storageReason || 'journal-write-failed')
    const nextGeneration = journalGeneration + 1
    const nextSlot = activeSlot === 0 ? 1 : 0
    const bytes = encodeSlot(nextGeneration, records)
    const written = requireSync(accessHandle.write(bytes, { at: nextSlot * slotBytes }))
    if (written !== slotBytes) throw new Error('journal-write-failed')
    requireSync(accessHandle.flush())
    const flushedAt = Date.now()
    const verified = readSlot(nextSlot)
    const readBackAt = Date.now()
    if (!verified || verified.generation !== nextGeneration || JSON.stringify(verified.records) !== JSON.stringify(records)) throw new Error('journal-write-failed')
    journalGeneration = nextGeneration
    activeSlot = nextSlot
    journalRecords = records
    return { flushedAt, readBackAt }
  }
  const openJournal = () => {
    if (journalReady) return Promise.resolve(true)
    if (journalOpenPromise) return journalOpenPromise
    const generation = lifecycleGeneration
    let pending
    const attempt = async () => {
      let candidate = null
      try {
        if (typeof navigator.storage?.getDirectory !== 'function') throw new Error('opfs-api-unavailable')
        const directory = await navigator.storage.getDirectory()
        if (generation !== lifecycleGeneration) return null
        const file = await directory.getFileHandle(journalFileName, { create: true })
        if (generation !== lifecycleGeneration) return null
        candidate = await file.createSyncAccessHandle()
        if (generation !== lifecycleGeneration) {
          try { requireSync(candidate.close()) } catch { /* optional */ }
          return null
        }
        if (candidate.getSize() < journalBytes) {
          requireSync(candidate.truncate(journalBytes))
          requireSync(candidate.flush())
        }
        const candidates = [readSlot(0, candidate), readSlot(1, candidate)].filter(Boolean).sort((a, b) => b.generation - a.generation)
        let records = []
        let generationNumber = 0
        let selectedSlot = -1
        if (candidates.length) {
          generationNumber = candidates[0].generation
          selectedSlot = candidates[0].slot
          records = candidates[0].records
        } else {
          const existingBytes = new Uint8Array(journalBytes)
          const existingLength = requireSync(candidate.read(existingBytes, { at: 0 }))
          if (existingLength > 0 && existingBytes.subarray(0, existingLength).some((byte) => byte !== 0)) throw new Error('journal-corrupt')
        }
        if (generation !== lifecycleGeneration) {
          try { requireSync(candidate.close()) } catch { /* optional */ }
          return null
        }
        directoryHandle = directory
        fileHandle = file
        accessHandle = candidate
        candidate = null
        journalGeneration = generationNumber
        activeSlot = selectedSlot
        journalRecords = records
        journalReady = true
        status = 'ready'
        storageReason = null
        return true
      } catch (error) {
        try { requireSync(candidate?.close()) } catch { /* optional */ }
        if (generation !== lifecycleGeneration) return null
        const name = error instanceof Error ? error.message : ''
        storageReason = name === 'opfs-api-unavailable' || name === 'storage-sync-method-unavailable' ? name : name === 'journal-corrupt' ? name : error?.name === 'NoModificationAllowedError' ? 'storage-busy' : error?.name === 'QuotaExceededError' ? 'storage-quota-exceeded' : 'storage-open-failed'
        status = 'storage-unavailable'
        return false
      }
    }
    pending = attempt().finally(() => { if (journalOpenPromise === pending) journalOpenPromise = null })
    journalOpenPromise = pending
    return pending
  }
  const closeJournal = (invalidate = true) => {
    if (invalidate) lifecycleGeneration += 1
    try { requireSync(accessHandle?.close()) } catch { /* optional */ }
    accessHandle = null
    journalReady = false
  }
  const isCurrentEligible = () => Boolean(current && current.sample.phase === 'mounted' && current.sample.state === 'active' && current.sample.visibility === 'visible')
  const openForVisibleRun = async () => {
    while (isCurrentEligible() && status !== 'storage-unavailable') {
      const generation = lifecycleGeneration
      const opened = await openJournal()
      if (opened === true && generation === lifecycleGeneration && isCurrentEligible()) {
        const previous = journalRecords.find((record) => record.runId === current.runId)
        if (previous) {
          if (!evidence) evidence = previous.evidence
          if (!monitorGap) monitorGap = previous.monitorGap
          lastAckAt = Math.max(lastAckAt, previous.lastAckAt)
        }
        current.evidence = evidence
        current.monitorGap = monitorGap
        current.lastAckAt = lastAckAt
        current.status = 'awaiting-fresh-ack'
        awaitingFreshAck = true
        post({ type: 'ready', status: 'awaiting-fresh-ack', reason: storageReason, runId: current.runId, lastAckAt, records: journalRecords })
        requestFreshAck()
        void persist(true).then(() => reportState())
        return true
      }
      if (opened === true && journalReady && !isCurrentEligible()) closeJournal()
      if (opened === false) return false
      if (opened === null) continue
      if (generation === lifecycleGeneration) return false
    }
    return false
  }
  const selectRecords = (record) => {
    const others = journalRecords.filter((item) => item.runId !== record.runId).sort((a, b) => b.updatedAt - a.updatedAt)
    return [record, ...others.slice(0, maxRuns - 1)]
  }
  const persist = (immediate = false) => {
    if (!journalReady || !current) return Promise.resolve(false)
    writeDirty = true
    const remaining = 10000 - (Date.now() - lastPersistAt)
    if (!immediate && lastPersistAt && remaining > 0) {
      if (!persistTimer) persistTimer = setTimeout(() => { persistTimer = 0; void persist(true).then(() => reportState()) }, remaining)
      return Promise.resolve(true)
    }
    if (persistTimer) { clearTimeout(persistTimer); persistTimer = 0 }
    if (writePromise) return writePromise
    writePromise = Promise.resolve().then(() => {
      let wrote = true
      while (writeDirty && status !== 'storage-unavailable') {
        writeDirty = false
        const record = cleanRecord({ ...current, storageReason, storage: storageTiming })
        if (!record) continue
        try {
          const records = selectRecords(record)
          const timing = syncCommit(records)
          storageTiming = { backend: 'opfs-sync', lastFlushAt: timing.flushedAt, lastReadBackAt: timing.readBackAt, gapReadBackAt: storageTiming.gapReadBackAt }
          if (record.evidence) {
            storageTiming.gapReadBackAt = timing.readBackAt
            const stamped = cleanRecord({ ...current, storageReason: null, storage: storageTiming })
            const stampTiming = syncCommit(selectRecords(stamped))
            storageTiming.lastFlushAt = stampTiming.flushedAt
            storageTiming.lastReadBackAt = stampTiming.readBackAt
          }
          lastPersistAt = Date.now()
          current.storage = { ...storageTiming }
          current.storageReason = null
        } catch (error) {
          const name = error instanceof Error ? error.message : ''
          storageReason = name === 'journal-record-too-large' ? name : error?.name === 'QuotaExceededError' ? 'storage-quota-exceeded' : 'journal-write-failed'
          status = 'storage-unavailable'
          current.status = status
          current.storageReason = storageReason
          wrote = false
          writeDirty = false
          reportState()
          break
        }
      }
      return wrote
    }).finally(() => { writePromise = null })
    return writePromise
  }
  const stopProbes = () => {
    pendingProbe = null
    nextProbeAt = 0
  }
  const needsProbe = () => journalReady && status === 'ready' && isCurrentEligible()
  const requestFreshAck = () => {
    if (!needsProbe() || pendingProbe) return
    probeSequence += 1
    const sentAt = Date.now()
    const sentMono = performance.now()
    pendingProbe = { seq: probeSequence, kind: 'fresh', sentAt, deadlineAt: sentAt + responseDeadlineMs, sentMono, deadlineMono: sentMono + responseDeadlineMs }
    nextFreshAckAt = pendingProbe.deadlineMono
    post({ type: 'challenge', seq: pendingProbe.seq, runId: current.runId })
  }
  const monitor = () => {
    const monoNow = performance.now()
    const wallNow = Date.now()
    const elapsed = monoNow - monitorLastAt
    const lateness = elapsed - monitorIntervalMs
    if (lateness > monitorLatenessMs) {
      stopProbes()
      awaitingFreshAck = true
      monitorGap = {
        fromAt: monitorLastWallAt,
        observedAt: wallNow,
        elapsedMs: Math.max(0, Math.min(86400000, Math.floor(elapsed))),
        visibilityAtLastAck: current?.sample.visibility === 'hidden' ? 'hidden' : 'visible',
      }
      if (current) current.status = 'awaiting-fresh-ack'
      void persist(true).then(() => {
        reportState()
        if (current) requestFreshAck()
      })
      monitorLastAt = monoNow
      monitorLastWallAt = wallNow
      return
    }
    monitorLastAt = monoNow
    monitorLastWallAt = wallNow
    if (pendingProbe && monoNow >= pendingProbe.deadlineMono) {
      const overdueProbe = pendingProbe
      const timeoutLateness = monoNow - overdueProbe.deadlineMono
      if (timeoutLateness > monitorLatenessMs) {
        stopProbes()
        awaitingFreshAck = true
        monitorGap = {
          fromAt: overdueProbe.sentAt,
          observedAt: wallNow,
          elapsedMs: Math.max(0, Math.min(86400000, Math.floor(monoNow - overdueProbe.sentMono))),
          visibilityAtLastAck: current?.sample.visibility === 'hidden' ? 'hidden' : 'visible',
        }
        current.status = 'awaiting-fresh-ack'
        void persist(true).then(() => { reportState(); requestFreshAck() })
        return
      }
      if (overdueProbe.kind === 'probe') {
        evidence = {
          kind: 'main-response-gap',
          runId: current.runId,
          probeSeq: overdueProbe.seq,
          sentAt: overdueProbe.sentAt,
          deadlineAt: overdueProbe.deadlineAt,
          evidenceAt: wallNow,
          lastAckAt,
          visibilityAtLastAck: current.sample.visibility,
          sample: current.sample,
        }
        current.evidence = evidence
        current.status = 'ready'
        void persist(true).then((ok) => {
          if (!ok) { status = 'storage-unavailable'; current.status = status }
          reportState()
        })
      } else {
        awaitingFreshAck = true
        current.status = 'awaiting-fresh-ack'
        nextFreshAckAt = monoNow + probeIntervalMs
        void persist(true).then(() => reportState())
      }
      pendingProbe = null
    }
    if (!needsProbe()) {
      stopProbes()
      awaitingFreshAck = false
      return
    }
    if (awaitingFreshAck) {
      if (!pendingProbe && monoNow >= nextFreshAckAt) requestFreshAck()
      return
    }
    if (lastAckAt && Date.now() - lastPersistAt >= 10000) void persist(true)
    if (pendingProbe) return
    if (!nextProbeAt) nextProbeAt = monoNow + probeIntervalMs
    if (monoNow < nextProbeAt) return
    probeSequence += 1
    const sentAt = Date.now()
    pendingProbe = { seq: probeSequence, kind: 'probe', sentAt, deadlineAt: sentAt + responseDeadlineMs, sentMono: monoNow, deadlineMono: monoNow + responseDeadlineMs }
    nextProbeAt = monoNow + probeIntervalMs
    post({ type: 'probe', seq: pendingProbe.seq, runId: current.runId, sentAt, deadlineAt: pendingProbe.deadlineAt })
  }
  const applyAck = (message) => {
    if (!pendingProbe || message.seq !== pendingProbe.seq || message.runId !== current?.runId) return
    const pending = pendingProbe
    const fresh = cleanSample(message.sample)
    if (!fresh || fresh.runId !== current.runId) return
    const monoNow = performance.now()
    const wallNow = Date.now()
    const monitorOnTime = monoNow - monitorLastAt <= monitorIntervalMs + monitorLatenessMs
    if (monoNow >= pending.deadlineMono && !monitorOnTime) {
      pendingProbe = null
      awaitingFreshAck = true
      nextFreshAckAt = monoNow + probeIntervalMs
      monitorGap = {
        fromAt: pending.sentAt,
        observedAt: wallNow,
        elapsedMs: Math.max(0, Math.min(86400000, Math.floor(monoNow - pending.sentMono))),
        visibilityAtLastAck: current.sample.visibility === 'hidden' ? 'hidden' : 'visible',
      }
      current.status = 'awaiting-fresh-ack'
      void persist(true).then(() => { reportState(); requestFreshAck() })
      return
    }
    let confirmedGap = false
    if (monoNow >= pending.deadlineMono && pending.kind === 'probe') {
      evidence = {
        kind: 'main-response-gap',
        runId: current.runId,
        probeSeq: pending.seq,
        sentAt: pending.sentAt,
        deadlineAt: pending.deadlineAt,
        evidenceAt: wallNow,
        lastAckAt,
        visibilityAtLastAck: current.sample.visibility,
        sample: current.sample,
      }
      current.evidence = evidence
      confirmedGap = true
    }
    lastAckAt = wallNow
    current.sample = fresh
    current.lastAckAt = lastAckAt
    current.updatedAt = lastAckAt
    if (pending.kind === 'fresh') {
      awaitingFreshAck = false
      nextProbeAt = monoNow + probeIntervalMs
      current.status = 'ready'
    }
    pendingProbe = null
    status = 'ready'
    current.status = status
    void persist(pending.kind === 'fresh' || confirmedGap).then((ok) => { if (!ok) return; reportState() })
  }
  const initialize = async () => {
    const opened = await openJournal()
    if (opened === null) {
      status = 'ready'
      storageReason = 'storage-open-cancelled'
      awaitingFreshAck = true
      post({ type: 'ready', status: 'awaiting-fresh-ack', reason: storageReason, lastAckAt: 0, records: journalRecords })
      if (isCurrentEligible()) void openForVisibleRun()
      return
    }
    if (opened) {
      const records = journalRecords
      if (current && !current.evidence) {
        const previous = records.find((item) => item.runId === current.runId)
        if (previous?.evidence) evidence = previous.evidence
        if (previous?.monitorGap) monitorGap = previous.monitorGap
        if (previous) lastAckAt = previous.lastAckAt
      }
      const eligible = isCurrentEligible()
      post({ type: 'ready', status: eligible ? status : 'awaiting-fresh-ack', reason: storageReason, runId: current?.runId, lastAckAt, records })
      if (current) {
        current.evidence = evidence
        current.monitorGap = monitorGap
        current.lastAckAt = lastAckAt
        current.status = eligible ? status : 'awaiting-fresh-ack'
        if (eligible) void persist(true).then(() => { reportState(); requestFreshAck() })
        else { awaitingFreshAck = true; closeJournal() }
      } else closeJournal()
    } else post({ type: 'ready', status, reason: storageReason, lastAckAt: 0, records: [] })
  }



  self.onmessage = (event) => {
    try {
      const message = event.data
      if (!message || typeof message !== 'object') return
      if (message.type === 'sample') {
        const sample = cleanSample(message.sample)
        if (!sample) return
        const wasEligible = needsProbe()
        const wasVisibility = current?.sample.visibility
        const runChanged = !current || current.runId !== sample.runId
        if (runChanged) {
          lifecycleGeneration += 1
          stopProbes()
          current = { runId: sample.runId, updatedAt: Date.now(), lastAckAt: 0, sample, evidence: null, monitorGap: null, status }
          evidence = null
          monitorGap = null
          lastAckAt = 0
          nextProbeAt = 0
        } else current.sample = sample
        current.updatedAt = Date.now()
        current.status = status
        const becameHidden = sample.state === 'pagehide' || sample.visibility === 'hidden' && wasVisibility !== 'hidden'
        if (becameHidden) { lifecycleGeneration += 1; stopProbes() }
        if (journalReady) void persist(becameHidden).then(() => { reportState(); if (becameHidden) closeJournal(false) })
        else if (sample.visibility === 'visible' && status !== 'storage-unavailable') void openForVisibleRun()
        if (!needsProbe()) {
          stopProbes()
          awaitingFreshAck = false
        } else if (!wasEligible || awaitingFreshAck) {
          stopProbes()
          awaitingFreshAck = true
          requestFreshAck()
        }
        return
      }
      if (message.type === 'ack') applyAck(message)
    } catch { /* malformed diagnostics messages must not affect the app */ }
  }
  setInterval(() => { try { monitor() } catch { /* monitoring remains optional */ } }, monitorIntervalMs)
  void initialize()
})()
