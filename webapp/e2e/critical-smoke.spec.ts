import { createHmac, randomUUID } from 'node:crypto'
import { createPrisma } from '../../backend/src/db'
import { jpegImage } from './helpers/images'
import { expect, test } from '@playwright/test'

const ownerId = 81000991
const viewerId = 81000992
const botToken = '123456:web-e2e-synthetic-token'

function signedInitData(subject: number, name: string) {
  const fields = new URLSearchParams({ auth_date: String(Math.floor(Date.now() / 1000)), query_id: randomUUID(), user: JSON.stringify({ id: subject, first_name: name }) })
  const check = [...fields.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => `${key}=${value}`).join('\n')
  const secret = createHmac('sha256', 'WebAppData').update(botToken).digest()
  fields.set('hash', createHmac('sha256', secret).update(check).digest('hex'))
  return fields.toString()
}

async function seed() {
  const prisma = createPrisma(process.env.TEST_DATABASE_URL!)
  try {
    for (const subject of [ownerId, viewerId]) {
      const old = await prisma.externalIdentity.findUnique({ where: { provider_subject: { provider: 'telegram', subject: String(subject) } }, select: { userId: true } })
      if (old) {
        await prisma.authSession.deleteMany({ where: { userId: old.userId } })
        await prisma.family.deleteMany({ where: { ownerUserId: old.userId } })
        await prisma.externalIdentity.deleteMany({ where: { userId: old.userId } })
        await prisma.user.deleteMany({ where: { id: old.userId } })
      }
    }
    const owner = await prisma.user.create({ data: { displayName: 'Synthetic owner' } })
    const viewer = await prisma.user.create({ data: { displayName: 'Synthetic viewer' } })
    await prisma.externalIdentity.createMany({ data: [
      { userId: owner.id, provider: 'telegram', subject: String(ownerId) },
      { userId: viewer.id, provider: 'telegram', subject: String(viewerId) },
    ] })
    await prisma.pilotAdmission.createMany({ data: [ownerId, viewerId].map((id) => ({ provider: 'telegram' as const, subject: String(id) })), skipDuplicates: true })
    const familyId = randomUUID()
    const childId = randomUUID()
    await prisma.$transaction(async (tx) => {
      await tx.family.create({ data: { id: familyId, name: 'Synthetic family', timezone: 'Europe/Moscow', ownerUserId: owner.id } })
      await tx.familyMember.createMany({ data: [
        { familyId, userId: owner.id, role: 'full' }, { familyId, userId: viewer.id, role: 'viewer' },
      ] })
      await tx.child.create({ data: { id: childId, familyId, displayName: 'Synthetic child' } })
    })
    return { familyId }
  } finally { await prisma.$disconnect() }
}

async function enter(page: import('@playwright/test').Page, subject: number, name: string) {
  await page.route(/telegram\.org\/js\/telegram-web-app\.js(?:\?.*)?$/, (route) => route.fulfill({ status: 200, contentType: 'application/javascript', body: '' }))
  await page.addInitScript((initData) => Object.defineProperty(window, 'Telegram', { configurable: true, value: { WebApp: {
    initData, version: '8.0', platform: 'tdesktop', ready() {}, safeAreaInset: { top: 0, bottom: 0 }, contentSafeAreaInset: { top: 0, bottom: 0 },
    BackButton: { show() {}, hide() {}, onClick() {}, offClick() {} },
  } } }), signedInitData(subject, name))
  const exchange = page.waitForResponse((response) => response.url().endsWith('/api/v1/auth/telegram'))
  await page.goto('/')
  expect((await exchange).status()).toBe(200)
  const welcome = page.getByRole('button', { name: 'Продолжить' })
  const familyHeading = page.getByRole('heading', { name: 'Мои семьи' })
  await expect(welcome.or(familyHeading).first()).toBeVisible()
  if (await welcome.isVisible()) await welcome.click()
  await expect(familyHeading).toBeVisible()
  await page.locator('.family-hub-card').click()
  await expect(page.locator('[data-memoly-feed="true"]')).toBeVisible()
}

test('signed owner enters the seeded family and publishes a note', async ({ page }) => {
  const { familyId } = await seed()
  await enter(page, ownerId, 'Synthetic owner')
  await page.getByRole('button', { name: 'Добавить', exact: true }).click()
  await page.getByRole('button', { name: 'Добавить заметку' }).click()
  const body = `Synthetic note ${randomUUID()}`
  await page.getByRole('textbox', { name: 'Текст заметки' }).fill(body)
  const published = page.waitForResponse((response) => response.request().method() === 'POST' && /\/memories$/.test(new URL(response.url()).pathname))
  await page.getByRole('button', { name: 'Опубликовать' }).click()
  const response = await published
  expect(response.ok()).toBe(true)
  const created = await response.json() as { id: string }
  const prisma = createPrisma(process.env.TEST_DATABASE_URL!)
  try {
    expect(await prisma.memory.count({ where: { id: created.id, familyId, body } })).toBe(1)
  } finally { await prisma.$disconnect() }
  await page.getByRole('button', { name: 'Смотреть в ленте' }).click()
  await expect(page.getByRole('button', { name: `Открыть заметку: ${body}` })).toBeVisible()
})

test('owner uploads one photo and the protected image loads from storage', async ({ page }) => {
  const { familyId } = await seed()
  await enter(page, ownerId, 'Synthetic owner')
  await page.getByRole('button', { name: 'Добавить', exact: true }).click()
  await page.getByRole('button', { name: 'Добавить фото и видео' }).click()
  await page.locator('#photo-composer-files').setInputFiles({ ...jpegImage, name: 'synthetic.jpg' })
  const published = page.waitForResponse((response) => response.request().method() === 'POST' && /\/memories$/.test(new URL(response.url()).pathname))
  await page.getByRole('button', { name: 'Опубликовать (1)' }).click()
  const response = await published
  expect(response.ok()).toBe(true)
  const created = await response.json() as { id: string }
  const prisma = createPrisma(process.env.TEST_DATABASE_URL!)
  try {
    const memory = await prisma.memory.findFirstOrThrow({ where: { id: created.id, familyId }, include: { media: true } })
    expect(memory.media).toHaveLength(1)
  } finally { await prisma.$disconnect() }
  await page.getByRole('button', { name: 'Смотреть в ленте' }).click()
  const image = page.locator(`.memory-card[data-memory-id="${created.id}"] .memory-media-slot img[alt="Воспоминание"]`)
  await expect(image).toBeVisible()
  await expect.poll(() => image.evaluate((element: HTMLImageElement) => element.complete && element.naturalWidth > 0)).toBe(true)
  await expect(image.locator('xpath=..')).toHaveAttribute('data-seen-ready', 'true')
})

test('rapid full-app navigation and carousel switching while requests are pending', async ({ browser }, testInfo) => {
  const { familyId } = await seed()
  const context = await browser.newContext()
  const page = await context.newPage()
  const observations: Array<Record<string, unknown>> = []
  const documentNavigations: string[] = []
  const mainFrameUrls: string[] = []
  const pageErrors: string[] = []
  let crashes = 0
  page.on('request', (request) => {
    if (request.isNavigationRequest() && request.resourceType() === 'document') documentNavigations.push(request.url())
  })
  page.on('framenavigated', (frame) => { if (frame === page.mainFrame()) mainFrameUrls.push(frame.url()) })
  page.on('pageerror', (error) => pageErrors.push(error.message))
  page.on('crash', () => { crashes += 1 })
  const photoData = await page.evaluate(async () => Promise.all(['#d7a36a', '#6cae9c', '#9a8dc4'].map(async (color, index) => {
    const canvas = document.createElement('canvas')
    canvas.width = 2048
    canvas.height = 1536
    const context = canvas.getContext('2d')!
    context.fillStyle = color
    context.fillRect(0, 0, canvas.width, canvas.height)
    for (let y = 0; y < 12; y += 1) for (let x = 0; x < 16; x += 1) {
      context.fillStyle = (x + y + index) % 2 ? 'rgba(255,255,255,.14)' : 'rgba(20,30,45,.12)'
      context.fillRect(x * 128, y * 128, 128, 128)
    }
    const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((value) => value ? resolve(value) : reject(new Error('canvas_encode_failed')), 'image/jpeg', 0.82))
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(String(reader.result))
      reader.onerror = () => reject(reader.error)
      reader.readAsDataURL(blob)
    })
    return { name: `synthetic-${index + 1}.jpg`, dataUrl }
  })))
  const photoFiles = photoData.map(({ name, dataUrl }) => ({ name, mimeType: 'image/jpeg', buffer: Buffer.from(dataUrl.split(',')[1]!, 'base64') }))
  try {
  await page.addInitScript(() => {
    const state = window as Window & { __reactStateSamples?: Array<Record<string, unknown>>; __REACT_DEVTOOLS_GLOBAL_HOOK__?: Record<string, unknown> }
    const cacheHookIndexes = new Map<unknown, number>()
    const hook = {
      supportsFiber: true,
      renderers: new Map<number, unknown>(),
      inject(renderer: unknown) { this.renderers.set(1, renderer); return 1 },
      onCommitFiberRoot(_rendererId: number, root: { current: FiberNode }) {
        const sample: Record<string, unknown> = { at: performance.now() }
        const pending: FiberNode[] = [root.current]
        while (pending.length) {
          const fiber = pending.pop()!
          if (fiber.type && typeof fiber.type === 'object' && fiber.memoizedProps?.value && typeof fiber.memoizedProps.value.isBootstrapping === 'boolean') {
            const value = fiber.memoizedProps.value
            sample.auth = { isBootstrapping: value.isBootstrapping, isAuthenticated: value.isAuthenticated, userPresent: Boolean(value.user) }
          }
          if (typeof fiber.type === 'function') {
            let stateHook = fiber.memoizedState
            let hookIndex = 0
            const knownCacheHookIndex = cacheHookIndexes.get(fiber.type)
            while (stateHook) {
              const hydrated = stateHook.memoizedState
              const hasHydratedIdentity = Boolean(hydrated && typeof hydrated === 'object' && 'userId' in hydrated && 'generation' in hydrated
                && typeof hydrated.userId === 'string' && Number.isFinite(hydrated.generation))
              if (knownCacheHookIndex === hookIndex) {
                sample.cache = { hydrated: hasHydratedIdentity, generationPresent: hasHydratedIdentity }
                break
              }
              if (knownCacheHookIndex === undefined && hasHydratedIdentity) {
                cacheHookIndexes.set(fiber.type, hookIndex)
                sample.cache = { hydrated: true, generationPresent: true }
                break
              }
              stateHook = stateHook.next
              hookIndex += 1
            }
          }
          if (fiber.child) pending.push(fiber.child)
          if (fiber.sibling) pending.push(fiber.sibling)
        }
        const samples = state.__reactStateSamples ?? []
        samples.push(sample)
        if (samples.length > 3000) samples.splice(0, samples.length - 3000)
        state.__reactStateSamples = samples
      },
    }
    type HookNode = { memoizedState?: unknown; next?: HookNode }
    type FiberNode = { type?: unknown; memoizedProps?: { value?: Record<string, unknown> }; memoizedState?: HookNode; child?: FiberNode | null; sibling?: FiberNode | null }
    state.__REACT_DEVTOOLS_GLOBAL_HOOK__ = hook
    const record = () => {
      const currentRoot = document.getElementById('root')
      const windowState = window as Window & { __initialRoot?: Element; __rootIdentityLost?: boolean; __interfaceLossObservations?: Array<Record<string, unknown>> }
      if (currentRoot && !windowState.__initialRoot) windowState.__initialRoot = currentRoot
      if (currentRoot && windowState.__initialRoot !== currentRoot) windowState.__rootIdentityLost = true
      const loading = currentRoot?.querySelector('[data-slot="app-loading"]')
      const row = {
        at: performance.now(),
        rootPresent: Boolean(currentRoot),
        rootConnected: Boolean(currentRoot?.isConnected),
        appLoading: Boolean(loading),
        loadingText: loading?.textContent?.trim() ?? null,
        staticPlaceholder: currentRoot?.children.length === 1
          && currentRoot.firstElementChild?.matches('p[role="status"]') === true
          && currentRoot.firstElementChild.textContent?.trim() === 'Загрузка memoLy…',
        feedPresent: Boolean(currentRoot?.querySelector('[data-memoly-feed="true"]')),
        navigationPresent: Boolean(currentRoot?.querySelector('[data-testid="bottom-navigation"]')),
      }
      const records = windowState.__interfaceLossObservations ?? []
      records.push(row)
      windowState.__interfaceLossObservations = records
    }
    record()
    const timer = window.setInterval(record, 25)
    window.addEventListener('beforeunload', () => window.clearInterval(timer), { once: true })
  })

  await enter(page, ownerId, 'Synthetic owner')
  await page.getByRole('button', { name: 'Добавить', exact: true }).click()
  await page.getByRole('button', { name: 'Добавить фото и видео' }).click()
  await page.locator('#photo-composer-files').setInputFiles(photoFiles)
  await page.getByRole('button', { name: 'Опубликовать (3)' }).click()
  await page.getByRole('button', { name: 'Смотреть в ленте' }).click()
  const carousel = page.locator('.memoly-mixed-carousel').first()
  await expect(carousel).toBeVisible()
  await expect(carousel.locator('[data-carousel-dot]')).toHaveCount(3)
  await expect(carousel.locator('.memoly-mixed-controls button')).toHaveCount(0)

  const feedMemoriesUrl = `**/api/v1/families/${familyId}/memories*`
  const mediaUrl = `**/api/v1/families/${familyId}/media/*/content*`
  const runCase = async (name: string, mode: 'baseline' | 'api-delay' | 'api-error' | 'media-delay') => {
    let releasePending: (() => void) | undefined
    let pendingCount = 0
    let firstPendingAt: number | null = null
    let responseHeaderCount = 0
    let requestFinishedCount = 0
    let pendingFailureCount = 0
    let controlledResponses = 0
    const terminalRequests: Array<Record<string, unknown>> = []
    const interceptedRequests = new Set<import('@playwright/test').Request>()
    const responseStatuses = new Map<import('@playwright/test').Request, number>()
    const responseListener = (response: import('@playwright/test').Response) => {
      const request = response.request()
      if (!interceptedRequests.has(request)) return
      responseHeaderCount += 1
      responseStatuses.set(request, response.status())
      terminalRequests.push({ event: 'response-headers', status: response.status(), path: new URL(response.url()).pathname })
    }
    const finishedListener = (request: import('@playwright/test').Request) => {
      if (!interceptedRequests.delete(request)) return
      requestFinishedCount += 1
      terminalRequests.push({ event: 'request-finished', status: responseStatuses.get(request) ?? null, path: new URL(request.url()).pathname })
      responseStatuses.delete(request)
    }
    const failedListener = (request: import('@playwright/test').Request) => {
      if (!interceptedRequests.delete(request)) return
      pendingFailureCount += 1
      terminalRequests.push({ failure: request.failure()?.errorText ?? 'unknown', path: new URL(request.url()).pathname })
      responseStatuses.delete(request)
    }
    if (mode !== 'baseline') {
      page.on('response', responseListener)
      page.on('requestfinished', finishedListener)
      page.on('requestfailed', failedListener)
    }
    const pendingGate = new Promise<void>((resolve) => { releasePending = resolve })
    const routeContext = page.context()
    if (mode === 'api-delay') {
      await routeContext.route(feedMemoriesUrl, async (route) => {
        interceptedRequests.add(route.request())
        pendingCount += 1
        firstPendingAt ??= Date.now()
        await pendingGate
        await route.continue()
      })
    } else if (mode === 'api-error') {
      await routeContext.route(feedMemoriesUrl, async (route) => {
        interceptedRequests.add(route.request())
        pendingCount += 1
        firstPendingAt ??= Date.now()
        await pendingGate
        await route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'synthetic_test_failure' }) })
        controlledResponses += 1
      })
    } else if (mode === 'media-delay') {
      await routeContext.route(mediaUrl, async (route) => {
        interceptedRequests.add(route.request())
        pendingCount += 1
        firstPendingAt ??= Date.now()
        await pendingGate
        await route.continue()
      })
      await page.getByRole('button', { name: 'Добавить', exact: true }).click()
      await page.getByRole('button', { name: 'Добавить фото и видео' }).click()
      await page.locator('#photo-composer-files').setInputFiles(photoFiles.map((file, index) => ({ ...file, name: `synthetic-pending-${index + 1}.jpg` })))
      await page.getByRole('button', { name: 'Опубликовать (3)' }).click()
      await page.getByRole('button', { name: 'Смотреть в ленте' }).click()
      await expect(page.locator('.memoly-mixed-carousel').first()).toBeVisible()
      await expect.poll(() => pendingCount).toBeGreaterThan(0)
    }
    const beforeDocs = documentNavigations.length
    const beforeFrameUrls = mainFrameUrls.length
    const beforeDomSamples = await page.evaluate(() => (window as Window & { __interfaceLossObservations?: unknown[] }).__interfaceLossObservations?.length ?? 0)
    const beforeReactSamples = await page.evaluate(() => (window as Window & { __reactStateSamples?: unknown[] }).__reactStateSamples?.length ?? 0)
    const started = performance.now()
    const observation: Record<string, unknown> = { name, mode, phase: 'ready', pendingCount: 0, pendingAtInteractionStart: 0 }
    observations.push(observation)
    let interactionStartedAt: number
    observation.serviceWorkerController = await page.evaluate(() => navigator.serviceWorker?.controller?.scriptURL ?? null)
    if (mode === 'api-delay' || mode === 'api-error') {
      const documentHidden = await page.evaluate(() => document.hidden)
      expect(documentHidden).toBe(false)
      observation.setupTrigger = 'test-dispatched document.visibilitychange to invoke active FeedPage foreground check'
      await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')))
      await expect.poll(() => pendingCount).toBeGreaterThan(0)
      interactionStartedAt = Date.now()
      observation.pendingAtInteractionStart = pendingCount
      observation.interactionStartedAt = interactionStartedAt
    } else {
      observation.setupTrigger = mode === 'media-delay'
        ? 'synthetic media memory loaded while protected content requests were held'
        : 'baseline UI interaction'
    }
    if (mode === 'baseline' || mode === 'media-delay') {
      interactionStartedAt = Date.now()
      observation.pendingAtInteractionStart = pendingCount
      observation.interactionStartedAt = interactionStartedAt
    }
    await page.getByRole('button', { name: 'Семья' }).click()
    observation.phase = 'interactions'
    observation.pendingCount = pendingCount
    observation.firstPendingAt = firstPendingAt
    await page.getByRole('button', { name: 'Лента' }).click()
    await expect(carousel).toBeVisible()
    await carousel.focus()
    await page.keyboard.press('ArrowLeft')
    await page.keyboard.press('ArrowLeft')
    await page.keyboard.press('ArrowRight')
    await page.keyboard.press('ArrowRight')
    await expect(carousel).toHaveAttribute('data-seen-active-index', '2')
    if (mode === 'baseline') {
      for (let attempt = 0; attempt < 2; attempt += 1) {
        await carousel.getByRole('button', { name: 'Открыть фото' }).click()
        await expect(page.getByRole('dialog')).toBeVisible()
        await page.getByRole('button', { name: 'Close' }).click()
        await expect(page.getByRole('dialog')).toHaveCount(0)
      }
    }
    if (mode === 'media-delay') await expect.poll(() => pendingCount).toBeGreaterThan(0)
    if (mode === 'api-delay' || mode === 'api-error') {
      for (let attempt = 0; attempt < 2; attempt += 1) {
        await page.getByRole('button', { name: 'Семья' }).click()
        await expect(page.getByRole('button', { name: 'Лента' })).toBeVisible()
        await page.getByRole('button', { name: 'Лента' }).click()
      }
    }
    const pendingAtRelease = pendingCount
    observation.pendingCount = pendingCount
    observation.pendingAtRelease = pendingAtRelease
    observation.releaseStartedAt = Date.now()
    observation.pendingStillOpenAtRelease = interceptedRequests.size
    releasePending?.()
    if (mode === 'api-delay' || mode === 'api-error' || mode === 'media-delay') {
      await expect.poll(() => requestFinishedCount + pendingFailureCount).toBeGreaterThanOrEqual(pendingAtRelease)
    }
    await expect(page.locator('#root')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Семья' })).toBeVisible()
    const state = await page.evaluate(() => ({
      rows: (window as Window & { __interfaceLossObservations?: Array<Record<string, unknown>> }).__interfaceLossObservations ?? [],
      react: (window as Window & { __reactStateSamples?: Array<Record<string, unknown>> }).__reactStateSamples ?? [],
      rootLost: Boolean((window as Window & { __rootIdentityLost?: boolean }).__rootIdentityLost),
      feed: Boolean(document.querySelector('#root [data-memoly-feed="true"]')),
      nav: Boolean(document.querySelector('#root [data-testid="bottom-navigation"]')),
      staticPlaceholder: document.querySelector('#root > p[role="status"]')?.textContent?.trim() ?? null,
    }))
    const rows = state.rows.slice(beforeDomSamples)
    const react = state.react.slice(beforeReactSamples)
    const authStates = react.map((row) => row.auth).filter((value): value is Record<string, unknown> => Boolean(value))
    const cacheStates = react.map((row) => row.cache).filter((value): value is Record<string, unknown> => Boolean(value))
    Object.assign(observation, {
      pendingCount, controlledResponses,
      firstPendingAt,
      responseHeaderCount, requestFinishedCount, pendingFailureCount, terminalRequests,
      documentNavigations: documentNavigations.slice(beforeDocs),
      mainFrameUrlChanges: mainFrameUrls.slice(beforeFrameUrls),
      rootConnected: await page.locator('#root').evaluate((element) => element.isConnected),
      rootIdentityPreserved: await page.locator('#root').evaluate((element) => element === (window as Window & { __initialRoot?: Element }).__initialRoot),
      rootLost: state.rootLost,
      pageErrors: [...pageErrors], crashes,
      loadingSamples: rows.filter((row) => row.appLoading === true).length,
      staticPlaceholderSamples: rows.filter((row) => row.staticPlaceholder === true).length,
      authSampleCount: authStates.length,
      authTransitions: authStates.filter((value, index, all) => index === 0 || JSON.stringify(value) !== JSON.stringify(all[index - 1])),
      cacheSampleCount: cacheStates.length,
      cacheTransitions: cacheStates.filter((value, index, all) => index === 0 || JSON.stringify(value) !== JSON.stringify(all[index - 1])),
      staticPlaceholder: state.staticPlaceholder,
      feedPresent: state.feed, navigationPresent: state.nav,
      interactionDurationMs: Date.now() - interactionStartedAt!,
      elapsedMs: Math.round(performance.now() - started),
      phase: 'settled',
    })
    expect(documentNavigations.length).toBe(beforeDocs)
    expect(observation.rootConnected).toBe(true)
    expect(observation.rootIdentityPreserved).toBe(true)
    expect(state.rootLost).toBe(false)
    expect(observation.loadingSamples).toBe(0)
    expect(observation.staticPlaceholderSamples).toBe(0)
    expect(state.staticPlaceholder).not.toBe('Загрузка memoLy…')
    expect(state.feed).toBe(true)
    expect(state.nav).toBe(true)
    expect(crashes).toBe(0)
    expect(pageErrors).toEqual([])
    expect(authStates.length).toBeGreaterThan(0)
    expect(cacheStates.length).toBeGreaterThan(0)
    if (mode === 'api-error') {
      expect(terminalRequests.some((request) => request.event === 'response-headers' && request.status === 500)).toBe(true)
      expect(terminalRequests.some((request) => request.event === 'request-finished' && request.status === 500)).toBe(true)
    }
    if (mode === 'api-delay' || mode === 'api-error' || mode === 'media-delay') await routeContext.unrouteAll()
    page.off('response', responseListener)
    page.off('requestfinished', finishedListener)
    page.off('requestfailed', failedListener)
    await page.waitForTimeout(150)
    await page.getByRole('button', { name: 'Семья' }).click()
    await expect(page.getByRole('button', { name: 'Лента' })).toBeVisible()
    await page.getByRole('button', { name: 'Лента' }).click()
    await expect(page.locator('[data-memoly-feed="true"]')).toBeVisible()
    await expect(carousel).toBeVisible()
    await expect(carousel.locator('[data-carousel-dot]')).toHaveCount(3)
  }

  await expect.poll(() => page.evaluate(() => Boolean((window as Window & { __initialRoot?: Element }).__initialRoot))).toBe(true)
  await runCase('baseline rapid app navigation', 'baseline')
  await runCase('delayed family API', 'api-delay')
  await runCase('failed family API (500)', 'api-error')
  await runCase('delayed protected media', 'media-delay')
  } finally {
    const report = {
      runtime: { project: testInfo.project.name, browserVersion: browser.version(), appMode: process.env.MEMOLY_E2E_APP_MODE ?? 'vite-development (default; custom runner must set MEMOLY_E2E_APP_MODE)', syntheticPhotoDimensions: '2048x1536 each', syntheticPhotos: 3 },
      documentNavigations, mainFrameUrls, pageErrors, crashes, observations,
      limitation: 'AuthProvider and PrivateCacheGate state samples come from read-only React committed fibers; this does not reproduce iOS PWA lifecycle behavior.',
    }
    console.log(`PWA_INTERFACE_LOSS_EXPERIMENT ${JSON.stringify(report)}`)
    await testInfo.attach('interface-loss-experiment.json', { body: JSON.stringify(report, null, 2), contentType: 'application/json' })
    await context.close()
  }
})

test('viewer cannot update or delete an owner memory and anonymous access to its media is denied', async ({ browser, page }) => {
  const { familyId } = await seed()
  const mediaRequests: string[] = []
  page.on('request', (request) => { if (/\/media\/.*\/content$/.test(new URL(request.url()).pathname)) mediaRequests.push(request.url()) })
  await enter(page, ownerId, 'Synthetic owner')
  await page.getByRole('button', { name: 'Добавить', exact: true }).click()
  await page.getByRole('button', { name: 'Добавить фото и видео' }).click()
  await page.locator('#photo-composer-files').setInputFiles({ ...jpegImage, name: 'synthetic-private.jpg' })
  await page.getByRole('button', { name: 'Опубликовать (1)' }).click()
  await page.getByRole('button', { name: 'Смотреть в ленте' }).click()
  const prisma = createPrisma(process.env.TEST_DATABASE_URL!)
  let memoryId: string
  let mediaId: string
  try {
    const memory = await prisma.memory.findFirstOrThrow({ where: { familyId }, include: { media: true } })
    memoryId = memory.id
    mediaId = memory.media[0]!.mediaId
  } finally { await prisma.$disconnect() }
  const image = page.locator(`.memory-card[data-memory-id="${memoryId}"] .memory-media-slot img[alt="Воспоминание"]`)
  await expect(image).toBeVisible()
  await expect.poll(() => image.evaluate((element: HTMLImageElement) => element.complete && element.naturalWidth > 0)).toBe(true)
  const mediaPath = `/api/v1/families/${familyId}/media/${mediaId}/content`
  await expect.poll(() => mediaRequests.some((url) => new URL(url).pathname === mediaPath)).toBe(true)
  const viewer = await browser.newPage()
  await enter(viewer, viewerId, 'Synthetic viewer')
  await expect(viewer.getByRole('button', { name: 'Добавить', exact: true })).toHaveCount(0)
  const viewerMemory = viewer.locator(`.memory-card[data-memory-id="${memoryId}"]`)
  await viewerMemory.getByRole('button', { name: 'Действия с воспоминанием' }).click()
  const actions = viewer.locator(`[data-memory-actions-for="${memoryId}"]`)
  await expect(actions.getByRole('button', { name: 'Редактировать' })).toHaveCount(0)
  await expect(actions.getByRole('button', { name: 'Удалить воспоминание' })).toHaveCount(0)
  const anonymous = await browser.newPage()
  const mediaResponse = await anonymous.request.get(mediaRequests.find((url) => new URL(url).pathname === mediaPath)!)
  expect([401, 403]).toContain(mediaResponse.status())
  await viewer.close()
  await anonymous.close()
})
