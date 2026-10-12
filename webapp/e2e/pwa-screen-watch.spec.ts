import { expect, test } from '@playwright/test'

test('mounted app pins a literal loading screen loss before any report is requested', async ({ page }) => {
  await page.goto('/')
  await page.waitForFunction(() => {
    const report = (window as Window & { __MEMOLY_DIAGNOSTICS__?: { report: () => string } }).__MEMOLY_DIAGNOSTICS__?.report()
    return report ? JSON.parse(report).current.phase === 'mounted' : false
  })

  await page.evaluate(() => {
    const root = document.getElementById('root')
    const placeholder = document.createElement('p')
    placeholder.setAttribute('role', 'status')
    placeholder.textContent = 'Загрузка memoLy…'
    root?.replaceChildren(placeholder)
  })

  await page.waitForFunction(() => {
    const saved = localStorage.getItem('memoly:pwa-diagnostics:v1')
    return saved ? JSON.parse(saved).incident?.kind === 'screen-loss' : false
  })
  const storedBeforeReport = await page.evaluate(() => JSON.parse(localStorage.getItem('memoly:pwa-diagnostics:v1')!))
  expect(storedBeforeReport.incident).toMatchObject({ kind: 'screen-loss', rootState: 'startup-placeholder' })
  expect(storedBeforeReport.current.rootState).toBe('startup-placeholder')

  await page.reload()
  await page.waitForFunction(() => localStorage.getItem('memoly:pwa-diagnostics:v1') !== null)
  const afterRestart = await page.evaluate(() => JSON.parse(localStorage.getItem('memoly:pwa-diagnostics:v1')!))
  expect(afterRestart.incident).toMatchObject({ kind: 'screen-loss', rootState: 'startup-placeholder' })
})

test('an independent witness persists a main response gap while the app thread is blocked', async ({ page }) => {
  await page.goto('/')
  await page.waitForFunction(() => {
    const report = (window as Window & { __MEMOLY_DIAGNOSTICS__?: { report: () => string } }).__MEMOLY_DIAGNOSTICS__?.report()
    return report ? JSON.parse(report).current.phase === 'mounted' : false
  })
  await page.waitForFunction(() => {
    const diagnostics = (window as Window & { __MEMOLY_DIAGNOSTICS__?: { report: () => string } }).__MEMOLY_DIAGNOSTICS__
    if (!diagnostics) return false
    const report = JSON.parse(diagnostics.report())
    return report.witness?.status === 'ready' && report.witness?.lastAckAt > 0
  }, undefined, { timeout: 5_000 })

  const runId = await page.evaluate(() => {
    const diagnostics = (window as Window & { __MEMOLY_DIAGNOSTICS__?: { report: () => string } }).__MEMOLY_DIAGNOSTICS__
    return diagnostics ? JSON.parse(diagnostics.report()).current.runId : null
  })
  expect(runId).toBeTruthy()
  const stall = page.evaluate(() => {
    const startAt = Date.now()
    const start = performance.now()
    while (performance.now() - start < 18_000) { /* block only the app's main thread */ }
    return { startAt, endAt: Date.now() }
  })
  const stallResult = await stall
  const reportBeforeReload = await page.evaluate(() => {
    const diagnostics = (window as Window & { __MEMOLY_DIAGNOSTICS__?: { report: () => string } }).__MEMOLY_DIAGNOSTICS__
    return diagnostics ? JSON.parse(diagnostics.report()) : null
  })
  const durableGap = reportBeforeReload?.witness?.records?.find((record: { runId: string }) => record.runId === runId)
  expect(durableGap).toMatchObject({ runId, evidence: { kind: 'main-response-gap', runId }, storage: { backend: 'opfs-sync' } })
  expect(durableGap.evidence.evidenceAt).toBeGreaterThanOrEqual(stallResult.startAt)
  expect(durableGap.evidence.evidenceAt).toBeLessThan(stallResult.endAt)
  expect(durableGap.storage.gapReadBackAt).toBeGreaterThanOrEqual(stallResult.startAt)
  expect(durableGap.storage.gapReadBackAt).toBeLessThan(stallResult.endAt)
  expect(durableGap.storage.lastReadBackAt).toBeGreaterThanOrEqual(stallResult.startAt)
  expect(durableGap.storage.lastReadBackAt).toBeLessThan(stallResult.endAt)
  expect(new TextEncoder().encode(JSON.stringify(reportBeforeReload)).byteLength).toBeLessThanOrEqual(8192)

  await page.reload()
  await page.waitForFunction((expectedRunId) => {
    const diagnostics = (window as Window & { __MEMOLY_DIAGNOSTICS__?: { report: () => string } }).__MEMOLY_DIAGNOSTICS__
    const record = diagnostics && JSON.parse(diagnostics.report()).witness?.records?.find((item: { runId: string }) => item.runId === expectedRunId)
    return record?.evidence?.kind === 'main-response-gap' && record.storage?.backend === 'opfs-sync'
  }, runId, { timeout: 10_000 })
  const recovered = await page.evaluate((expectedRunId) => {
    const diagnostics = (window as Window & { __MEMOLY_DIAGNOSTICS__?: { report: () => string } }).__MEMOLY_DIAGNOSTICS__
    const record = diagnostics && JSON.parse(diagnostics.report()).witness?.records?.find((item: { runId: string }) => item.runId === expectedRunId)
    return record ?? null
  }, runId)
  expect(recovered).toMatchObject({ runId, evidence: { kind: 'main-response-gap', runId, evidenceAt: durableGap.evidence.evidenceAt }, storage: { backend: 'opfs-sync' } })
  expect(recovered.storage.gapReadBackAt).toBeGreaterThanOrEqual(durableGap.storage.gapReadBackAt)
  expect(new TextEncoder().encode(await page.evaluate(() => (window as Window & { __MEMOLY_DIAGNOSTICS__?: { report: () => string } }).__MEMOLY_DIAGNOSTICS__!.report())).byteLength).toBeLessThanOrEqual(8192)
})

test('a suspended witness records monitor lateness without labeling the responsive app as a main gap', async ({ page }) => {
  await page.goto('/')
  await page.waitForFunction(() => {
    const diagnostics = (window as Window & { __MEMOLY_DIAGNOSTICS__?: { report: () => string } }).__MEMOLY_DIAGNOSTICS__
    if (!diagnostics) return false
    const report = JSON.parse(diagnostics.report())
    return report.current.phase === 'mounted' && report.witness?.status === 'ready' && report.witness?.lastAckAt > 0
  }, undefined, { timeout: 5_000 })

  const runId = await page.evaluate(() => {
    const diagnostics = (window as Window & { __MEMOLY_DIAGNOSTICS__?: { report: () => string } }).__MEMOLY_DIAGNOSTICS__
    return diagnostics ? JSON.parse(diagnostics.report()).current.runId : null
  })
  const worker = page.workers().find((candidate) => candidate.url().includes('/pwa-runtime-witness-v1.js'))
  expect(runId).toBeTruthy()
  expect(worker).toBeDefined()

  const workerPause = worker!.evaluate(() => {
    const start = performance.now()
    while (performance.now() - start < 15_000) { /* suspend only witness timers */ }
    return true
  })
  const pageRemainedResponsive = await page.evaluate(() => document.getElementById('root') !== null)
  expect(pageRemainedResponsive).toBe(true)
  await workerPause

  await page.waitForFunction((expectedRunId) => {
    const diagnostics = (window as Window & { __MEMOLY_DIAGNOSTICS__?: { report: () => string } }).__MEMOLY_DIAGNOSTICS__
    const record = diagnostics && JSON.parse(diagnostics.report()).witness?.records?.find((item: { runId: string }) => item.runId === expectedRunId)
    return record?.monitorGap?.elapsedMs > 3_000
  }, runId, { timeout: 5_000 })
  const report = await page.evaluate(() => {
    const diagnostics = (window as Window & { __MEMOLY_DIAGNOSTICS__?: { report: () => string } }).__MEMOLY_DIAGNOSTICS__
    return diagnostics ? JSON.parse(diagnostics.report()) : null
  })
  const record = report.witness.records.find((item: { runId: string }) => item.runId === runId)
  expect(record).toMatchObject({ runId, monitorGap: { elapsedMs: expect.any(Number) }, storage: { backend: 'opfs-sync' } })
  expect(record.monitorGap.elapsedMs).toBeGreaterThan(3_000)
  expect(record.evidence?.kind).not.toBe('main-response-gap')
})

test('witness OPFS storage denial is reported as unavailable without becoming an app error', async ({ page }) => {
  await page.route('**/pwa-runtime-witness-v1.js', async (route) => {
    const response = await route.fetch()
    const source = await response.text()
    await route.fulfill({
      response,
      body: `Object.defineProperty(navigator, 'storage', { configurable: true, value: { getDirectory() { return Promise.reject(new DOMException('blocked', 'SecurityError')) } } });\n${source}`,
    })
  })
  await page.goto('/')
  await page.waitForFunction(() => {
    const diagnostics = (window as Window & { __MEMOLY_DIAGNOSTICS__?: { report: () => string } }).__MEMOLY_DIAGNOSTICS__
    if (!diagnostics) return false
    const report = JSON.parse(diagnostics.report())
    return report.current.phase === 'mounted' && report.witness?.status === 'storage-unavailable'
  }, undefined, { timeout: 5_000 })

  const report = await page.evaluate(() => {
    const diagnostics = (window as Window & { __MEMOLY_DIAGNOSTICS__?: { report: () => string } }).__MEMOLY_DIAGNOSTICS__
    return diagnostics ? JSON.parse(diagnostics.report()) : null
  })
  expect(report.witness.reason).toBe('storage-open-failed')
  expect(report.current.rootState).toBe('present')
  expect(report.current.lastFailure).toBeNull()
  expect(report.current.events.some((event: { kind: string }) => event.kind === 'error' || event.kind === 'unhandled-rejection')).toBe(false)
})

test('unavailable OPFS API is reported while the app remains mounted', async ({ page, browserName }) => {
  if (browserName === 'chromium') {
    await page.route('**/pwa-runtime-witness-v1.js', async (route) => {
      const response = await route.fetch()
      const source = await response.text()
      await route.fulfill({ response, body: `Object.defineProperty(navigator, 'storage', { configurable: true, value: undefined });\n${source}` })
    })
  }
  await page.goto('/')
  await page.waitForFunction(() => {
    const diagnostics = (window as Window & { __MEMOLY_DIAGNOSTICS__?: { report: () => string } }).__MEMOLY_DIAGNOSTICS__
    if (!diagnostics) return false
    const report = JSON.parse(diagnostics.report())
    return report.current.phase === 'mounted' && report.witness?.status === 'storage-unavailable'
  }, undefined, { timeout: 5_000 })
  const report = await page.evaluate(() => {
    const diagnostics = (window as Window & { __MEMOLY_DIAGNOSTICS__?: { report: () => string } }).__MEMOLY_DIAGNOSTICS__
    return diagnostics ? JSON.parse(diagnostics.report()) : null
  })
  expect(report.witness.reason).toBe('opfs-api-unavailable')
  expect(report.current.rootState).toBe('present')
  expect(report.current.lastFailure).toBeNull()
})
