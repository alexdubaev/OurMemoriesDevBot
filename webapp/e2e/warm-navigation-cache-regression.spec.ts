import { expect, test } from '@playwright/test'
import { readFile, writeFile } from 'node:fs/promises'

const userId = '11111111-1111-4111-8111-111111111111'
const familyId = '22222222-2222-4222-8222-222222222222'
const childId = '33333333-3333-4333-8333-333333333333'
const memoryId = '44444444-4444-4444-8444-444444444444'
const photoId = '55555555-5555-4555-8555-555555555555'
const secondPhotoId = '88888888-8888-4888-8888-888888888888'
const maxVideoId = '99999999-9999-4999-8999-999999999999'
const childAvatarId = '66666666-6666-4666-8666-666666666666'
const demoImage = await readFile(new URL('../../assets/demo/beach.webp', import.meta.url))
const now = '2026-10-02T00:00:00.000Z'

test('warm navigation preserves family and feed state through ten round trips and a real cache restore', async ({ page }) => {
  const browserContext = page.context()
  const apiRequests: string[] = []
  const pageDiagnostics: string[] = []
  page.on('console', (message) => { if (message.type() === 'error') pageDiagnostics.push(message.text()) })
  page.on('pageerror', (error) => pageDiagnostics.push(error.message))
  let releaseTransportRefresh!: () => void
  let notifyTransportRefresh!: () => void
  let releaseReloadPhotoGet!: () => void
  let releaseMaxStatus!: () => void
  let notifyMaxStatus!: () => void
  let refreshRequestPending = false
  let transportRefreshCompleted = false
  let holdReloadPhotoGet = false
  let reloadPhotoGetPending = false
  let reloadPhotoGetCompleted = false
  let corruptResponseRequested = false
  let corruptResponseCompleted = false
  let holdMaxStatus = false
  let maxStatusRequestPending = false
  const transportRefreshRequest = new Promise<void>((resolve) => { notifyTransportRefresh = resolve })
  const transportRefreshResponse = new Promise<void>((resolve) => { releaseTransportRefresh = resolve })
  const reloadPhotoGetResponse = new Promise<void>((resolve) => { releaseReloadPhotoGet = resolve })
  const maxStatusRequest = new Promise<void>((resolve) => { notifyMaxStatus = resolve })
  const maxStatusResponse = new Promise<void>((resolve) => { releaseMaxStatus = resolve })
  await browserContext.route('**/api/uploads/avatar', (route) => route.fulfill({ json: { avatar: null } }))
  await browserContext.route('**/api/v1/**', async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    const path = `${url.pathname}${url.search}`
    apiRequests.push(path)

    if (url.pathname.endsWith(`/media/${photoId}/content`) || url.pathname.endsWith(`/media/${secondPhotoId}/content`) || url.pathname.endsWith(`/media/${childAvatarId}/content`) || url.pathname.endsWith(`/media/avatars/${familyId}/${userId}/content`) || url.pathname.endsWith(`/media/max-videos/${maxVideoId}/poster`)) {
      if (url.pathname.endsWith(`/media/${photoId}/content`) && holdReloadPhotoGet && request.headers()['x-fixture-transport-generation'] === '1') {
        reloadPhotoGetPending = true
        await reloadPhotoGetResponse
        reloadPhotoGetCompleted = true
      }
      if (url.pathname.endsWith(`/media/${photoId}/content`) && request.headers()['x-fixture-transport-generation'] === '3') {
        corruptResponseRequested = true
        await route.fulfill({ status: 200, contentType: 'image/png', headers: { 'Cache-Control': 'private, max-age=0, must-revalidate' }, body: Buffer.from('not-a-png') })
        corruptResponseCompleted = true
        return
      }
      if (url.pathname.endsWith(`/media/${photoId}/content`) && request.headers()['x-fixture-transport-generation'] === '2') {
        refreshRequestPending = true
        notifyTransportRefresh()
        await transportRefreshResponse
      }
      await route.fulfill({ status: 200, contentType: 'image/webp', headers: { 'Cache-Control': 'private, max-age=0, must-revalidate' }, body: demoImage })
      if (url.pathname.endsWith(`/media/${photoId}/content`) && request.headers()['x-fixture-transport-generation'] === '2') transportRefreshCompleted = true
      return
    }
    if (url.pathname.endsWith(`/media/max-videos/${maxVideoId}/readiness`)) {
      await route.fulfill({ json: { state: 'processing', recheckable: true } })
      return
    }
    if (url.pathname.endsWith('/max-channel')) {
      if (holdMaxStatus) {
        maxStatusRequestPending = true
        notifyMaxStatus()
        await maxStatusResponse
      }
      await route.fulfill({ json: { state: 'unconfigured', title: null, canManage: true } })
      return
    }
    if (url.pathname.endsWith('/usage')) {
      await route.fulfill({ json: { usedBytes: 1, quotaBytes: 1_000_000 } })
      return
    }
    if (url.pathname.endsWith('/members')) {
      await route.fulfill({ json: { items: [{ userId, avatarPath: `/api/v1/families/${familyId}/media/avatars/${familyId}/${userId}/content`, displayName: 'Анна', familyDisplayName: null, role: 'full', isOwner: true, joinedAt: now, version: 1 }] } })
      return
    }
    if (url.pathname.endsWith('/invites')) {
      await route.fulfill({ json: { items: [] } })
      return
    }
    if (url.pathname === '/api/v1/me/welcome/claim') {
      await route.fulfill({ json: { showWelcome: false } })
      return
    }
    if (url.pathname === `/api/v1/families/${familyId}/memories`) {
      await route.fulfill({ json: { items: [{
        id: memoryId,
        familyId,
        childId,
        author: { id: userId, name: 'Анна', avatarPath: null },
        kind: 'media',
        body: '',
        occurredAt: now,
        firstPublishedAt: now,
        sourcePublishedAt: null,
        createdAt: now,
        version: 1,
        status: 'published',
        attachments: [photoAttachment(photoId), photoAttachment(secondPhotoId), maxVideoAttachment(maxVideoId)],
        reactionCounts: {},
        currentUserReaction: null,
        likes: { count: 0, likedByMe: false },
        capabilities: { edit: true, delete: true, like: true },
      }], nextCursor: null } })
      return
    }
    if (url.pathname === `/api/v1/families/${familyId}`) {
      await route.fulfill({ json: familyResponse })
      return
    }
    if (url.pathname === '/api/v1/me/families') {
      await route.fulfill({ json: homeResponse })
      return
    }
    if (url.pathname === '/api/v1/me') {
      await route.fulfill({ json: { user: { id: userId, email: null, displayName: 'Анна', role: 'user', createdAt: now }, activeFamily: { id: familyId, name: 'Наша семья', role: 'full', isOwner: true }, limits: { activeFamiliesMaximum: 1 } } })
      return
    }
    await route.fulfill({ json: {} })
  })

  await browserContext.addInitScript(() => {
    const revoked = new Set<string>()
    const original = URL.revokeObjectURL.bind(URL)
    const revokeSnapshots: Array<Record<string, unknown>> = []
    URL.revokeObjectURL = (url: string) => {
      const images = [...document.images].filter((image) => image.src === url)
      revokeSnapshots.push({ url, images: images.map((image) => ({ alt: image.alt, src: image.src, isConnected: image.isConnected, complete: image.complete, naturalWidth: image.naturalWidth, hiddenSurface: Boolean(image.closest('[data-navigation-surface][hidden]')) })) })
      revoked.add(url)
      original(url)
    }
    ;(window as Window & { __warmNav?: Record<string, unknown> }).__warmNav = { revoked, revokeSnapshots, imageErrors: [], samples: [], feedNodes: new Set(), familyNodes: new Set(), running: true }
    document.addEventListener('error', (event) => {
      const image = event.target
      if (image instanceof HTMLImageElement && image.alt === 'Воспоминание') {
        const evidence = (window as Window & { __warmNav: { imageErrors: Array<Record<string, unknown>>; revoked: Set<string> } }).__warmNav
        evidence.imageErrors.push({ src: image.src, revokedAtError: evidence.revoked.has(image.src), at: performance.now() })
      }
    }, true)
    const sample = () => {
      const evidence = (window as Window & { __warmNav: { running: boolean; revoked: Set<string>; samples: Array<Record<string, unknown>>; feedNodes: Set<Element>; familyNodes: Set<Element> } }).__warmNav
      if (!evidence?.running) return
      const feed = document.querySelector('[data-memoly-feed]')
      const family = document.querySelector('.ml-page')
      if (feed) evidence.feedNodes.add(feed)
      if (family) evidence.familyNodes.add(family)
      if (feed) {
        const activeSlide = feed.querySelector('[data-carousel-active="true"]')
        const image = activeSlide?.querySelector<HTMLImageElement>('img[alt="Воспоминание"]') ?? null
        const placeholder = activeSlide?.querySelector('[aria-label="Загрузка фотографии"]') ?? null
        evidence.samples.push({ at: performance.now(), visible: feed.getClientRects().length > 0, hasImage: Boolean(image), hasPlaceholder: Boolean(placeholder), src: image?.src ?? null, complete: image?.complete ?? null, naturalWidth: image?.naturalWidth ?? null, revoked: image ? evidence.revoked.has(image.src) : false })
      }
      requestAnimationFrame(sample)
    }
    requestAnimationFrame(sample)
  })

  await page.goto('/e2e/warm-navigation-cache.fixture.html')
  const continueWelcome = async () => {
    await expect(page.locator('[data-slot="welcome-splash"] .continue-button')).toBeEnabled({ timeout: 6_000 })
    await page.locator('[data-slot="welcome-splash"] .continue-button').click()
  }
  await continueWelcome()

  const photo = page.locator('[data-memoly-feed] .memoly-mixed-slide[data-carousel-active="true"] img[alt="Воспоминание"]')
  await expect.poll(async () => (await photo.count()) > 0 || (await page.getByRole('alert').count()) > 0).toBe(true)
  if (await page.getByRole('alert').count()) {
    throw new Error(`Fixture render failed; requests=${JSON.stringify(apiRequests)}, browser=${JSON.stringify(pageDiagnostics)}`)
  }
  await expect(photo).toBeVisible()
  await expect.poll(() => photo.evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0)).toBe(true)
  const childAvatarPath = `/api/v1/families/${familyId}/media/${childAvatarId}/content?variant=display`
  await expect.poll(() => apiRequests.filter((path) => path === childAvatarPath).length).toBeGreaterThan(0)
  await page.evaluate(() => {
    const state = (window as Window & { __warmNav: { samples: unknown[] } }).__warmNav
    state.samples.length = 0
  })
  await page.evaluate(() => { document.body.style.minHeight = '1400px'; window.scrollTo(0, 100) })
  await page.locator('[data-nav-position="family"]').dispatchEvent('click')
  await expect(page.locator('.ml-page')).toBeVisible()
  await page.evaluate(() => window.scrollTo(0, 60))
  const familyScrollAtSwitch = await page.evaluate(() => window.scrollY)
  await page.locator('[data-navigation-surface="family"]:visible').getByRole('button', { name: 'Лента', exact: true }).click()
  const feedScrollRestored = await page.evaluate(() => window.scrollY)
  expect({ familyScrollAtSwitch, feedScrollRestored }).toEqual({ familyScrollAtSwitch: 60, feedScrollRestored: 100 })
  await page.evaluate(() => { document.body.style.minHeight = '' })
  await page.getByRole('button', { name: 'Следующий элемент' }).click()
  await expect(page.locator('[data-memoly-feed] .memoly-mixed-slide[data-carousel-active="true"]')).toHaveAttribute('data-carousel-position', '2')
  const activeSlide = page.locator('[data-memoly-feed] .memoly-mixed-slide[data-carousel-active="true"]')
  const carouselViewport = page.locator('[data-memoly-feed] .memoly-mixed-viewport')
  await expect.poll(async () => activeSlide.evaluate((slide) => {
    const viewport = slide.closest('.memoly-mixed-viewport')
    if (!viewport) return false
    const slideRect = slide.getBoundingClientRect()
    const viewportRect = viewport.getBoundingClientRect()
    return Math.abs(slideRect.left - viewportRect.left) < 1 && Math.abs(slideRect.width - viewportRect.width) < 1
  })).toBe(true)
  await page.evaluate(() => {
    const viewport = document.querySelector('[data-memoly-feed] .memoly-mixed-viewport')
    const slide = viewport?.querySelector('.memoly-mixed-slide[data-carousel-active="true"]')
    if (!viewport || !slide) throw new Error('Active carousel slide is unavailable for the initial capture')
    const viewportRect = viewport.getBoundingClientRect()
    const slideRect = slide.getBoundingClientRect()
    if (Math.abs(slideRect.left - viewportRect.left) >= 1 || Math.abs(slideRect.width - viewportRect.width) >= 1) {
      throw new Error('Initial capture requires the active slide to align with its viewport')
    }
    ;(window as Window & { __warmNav: { samples: unknown[] } }).__warmNav.samples.length = 0
  })
  expect(await activeSlide.boundingBox()).not.toBeNull()
  expect(await carouselViewport.boundingBox()).not.toBeNull()
  await expect.poll(() => photo.evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0)).toBe(true)
  const memberAvatar = page.locator('.family-member-avatar img')
  await expect.poll(() => memberAvatar.evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0)).toBe(true)
  const initialSrc = await photo.getAttribute('src')
  const playbackStarted = await page.evaluate(async () => {
    const bytes = new Uint8Array(44 + 16_000)
    const view = new DataView(bytes.buffer)
    const text = (offset: number, value: string) => [...value].forEach((char, index) => view.setUint8(offset + index, char.charCodeAt(0)))
    text(0, 'RIFF'); view.setUint32(4, bytes.length - 8, true); text(8, 'WAVE'); text(12, 'fmt ')
    view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true)
    view.setUint32(24, 8_000, true); view.setUint32(28, 16_000, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true)
    text(36, 'data'); view.setUint32(40, bytes.length - 44, true)
    const src = URL.createObjectURL(new Blob([bytes], { type: 'audio/wav' }))
    const elements = ['audio', 'video'].map((tag) => {
      const media = document.createElement(tag) as HTMLMediaElement
      media.dataset.warmPlayback = tag
      media.muted = true
      media.loop = true
      media.src = src
      media.style.cssText = 'position:absolute;width:1px;height:1px;pointer-events:none'
      document.querySelector('[data-memoly-feed]')!.append(media)
      return media
    })
    await Promise.all(elements.map((media) => media.play()))
    return elements.map((media) => ({ tag: media.tagName, paused: media.paused }))
  })
  expect(playbackStarted).toEqual([{ tag: 'AUDIO', paused: false }, { tag: 'VIDEO', paused: false }])
  let playbackHidden: boolean[] = []
  let playbackReturned: boolean[] = []
  const warmResourcePaths = [
    `/api/v1/families/${familyId}/media/${photoId}/content?variant=display`,
    `/api/v1/families/${familyId}/media/${secondPhotoId}/content?variant=display`,
    childAvatarPath,
    `/api/v1/families/${familyId}/media/avatars/${familyId}/${userId}/content`,
  ]
  const warmResourceGetsBeforeTabs = warmResourcePaths.map((path) => apiRequests.filter((requestPath) => requestPath === path).length)

  await page.screenshot({ path: test.info().outputPath('warm-navigation-initial-feed.png'), fullPage: true })
  for (let index = 0; index < 10; index += 1) {
    await page.getByRole('button', { name: 'Семья', exact: true }).click()
    await expect(page.locator('.ml-page')).toBeVisible()
    if (index === 0) {
      playbackHidden = await page.locator('[data-warm-playback]').evaluateAll((elements) => elements.map((element) => (element as HTMLMediaElement).paused))
      expect(playbackHidden).toEqual([true, true])
    }
    await expect(page.locator('[data-memoly-feed] .memoly-mixed-slide[data-carousel-active="true"]')).toHaveAttribute('data-carousel-position', '2')
    if (index === 0) await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(60)
    if (index === 0) await page.screenshot({ path: test.info().outputPath('warm-navigation-feed-to-family.png'), fullPage: true })
    if (index === 1) await page.screenshot({ path: test.info().outputPath('warm-navigation-second-family.png'), fullPage: true })
    await page.getByRole('button', { name: 'Лента', exact: true }).click()
    await expect(photo).toBeVisible()
    if (index === 0) {
      playbackReturned = await page.locator('[data-warm-playback]').evaluateAll((elements) => elements.map((element) => (element as HTMLMediaElement).paused))
      expect(playbackReturned).toEqual([true, true])
      await page.locator('[data-warm-playback]').evaluateAll((elements) => {
        const src = (elements[0] as HTMLMediaElement).src
        elements.forEach((element) => element.remove())
        URL.revokeObjectURL(src)
      })
    }
    await expect.poll(() => photo.evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0)).toBe(true)
    if (index === 0) await page.screenshot({ path: test.info().outputPath('warm-navigation-family-to-feed.png'), fullPage: true })
    if (index === 1) await page.screenshot({ path: test.info().outputPath('warm-navigation-second-feed.png'), fullPage: true })
  }
  const finalSrcAfterTabSwitches = await photo.getAttribute('src')
  expect(finalSrcAfterTabSwitches).toBe(initialSrc)
  await expect(page.locator('[data-memoly-feed] .memoly-mixed-slide[data-carousel-active="true"]')).toHaveAttribute('data-carousel-position', '2')
  await expect.poll(() => memberAvatar.evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0)).toBe(true)
  expect(warmResourcePaths.map((path) => apiRequests.filter((requestPath) => requestPath === path).length)).toEqual(warmResourceGetsBeforeTabs)
  const navigationPhotoGets = apiRequests.filter((path) => path === `/api/v1/families/${familyId}/media/${photoId}/content?variant=display`).length
  const plainTabRequestCounts = Object.fromEntries(warmResourcePaths.map((path) => [path, apiRequests.filter((requestPath) => requestPath === path).length]))
  const avatarGetsAfterWarmMount = apiRequests.filter((path) => path === childAvatarPath || path === `/api/v1/families/${familyId}/media/avatars/${familyId}/${userId}/content`).length
  await page.getByRole('button', { name: 'Следующий элемент' }).click()
  await expect(page.locator('[data-memoly-feed] .memoly-mixed-slide[data-carousel-active="true"]')).toHaveAttribute('data-carousel-position', '3')
  const maxPosterPath = `/api/v1/families/${familyId}/media/max-videos/${maxVideoId}/poster`
  const maxPoster = page.locator('[data-memoly-feed] [data-slot="max-video-frame"] video')
  await expect.poll(() => maxPoster.evaluate((video: HTMLVideoElement) => video.poster.startsWith('blob:'))).toBe(true)
  const posterGetsBeforeTabSwitch = apiRequests.filter((path) => path === maxPosterPath).length
  expect(posterGetsBeforeTabSwitch).toBe(1)
  await page.getByRole('button', { name: 'Семья', exact: true }).click()
  await expect(page.locator('.ml-page')).toBeVisible()
  await page.getByRole('button', { name: 'Лента', exact: true }).click()
  await expect(page.locator('[data-memoly-feed] .memoly-mixed-slide[data-carousel-active="true"]')).toHaveAttribute('data-carousel-position', '3')
  expect(apiRequests.filter((path) => path === maxPosterPath)).toHaveLength(posterGetsBeforeTabSwitch)
  expect(apiRequests.filter((path) => path === childAvatarPath || path === `/api/v1/families/${familyId}/media/avatars/${familyId}/${userId}/content`)).toHaveLength(avatarGetsAfterWarmMount)
  await page.getByRole('button', { name: 'Предыдущий элемент' }).click()
  await page.getByRole('button', { name: 'Предыдущий элемент' }).click()
  await expect(page.locator('[data-memoly-feed] .memoly-mixed-slide[data-carousel-active="true"]')).toHaveAttribute('data-carousel-position', '1')
  const mediaRequestCounts = Object.fromEntries([
    `/api/v1/families/${familyId}/media/${photoId}/content?variant=display`,
    `/api/v1/families/${familyId}/media/${secondPhotoId}/content?variant=display`,
    childAvatarPath,
    `/api/v1/families/${familyId}/media/avatars/${familyId}/${userId}/content`,
    `/api/v1/families/${familyId}/media/max-videos/${maxVideoId}/poster`,
  ].map((path) => [path, apiRequests.filter((requestPath) => requestPath === path).length]))
  const navigationEvidence = await page.evaluate(() => {
    const state = (window as Window & { __warmNav: { revoked: Set<string>; imageErrors: unknown[]; samples: Array<{ hasPlaceholder: boolean; visible: boolean; revoked: boolean; complete: boolean | null; naturalWidth: number | null }>; feedNodes: Set<Element>; familyNodes: Set<Element> } }).__warmNav
    return {
      feedMounts: state.feedNodes.size,
      familyMounts: state.familyNodes.size,
      brokenImageEvents: [...state.imageErrors],
      placeholderFrames: state.samples.filter((sample) => sample.visible && sample.hasPlaceholder).length,
      invalidOrRevokedImageFrames: state.samples.filter((sample) => sample.visible && sample.complete && (!sample.naturalWidth || sample.revoked)).length,
    }
  })
  await page.getByRole('button', { name: 'Семья', exact: true }).click()
  await expect(memberAvatar).toBeVisible()
  await expect.poll(() => memberAvatar.evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0)).toBe(true)
  const maxChannelStatus = page.getByText('Добавьте memoLy-бота администратором вашего канала')
  await expect(maxChannelStatus).toBeVisible()
  holdMaxStatus = true
  await page.evaluate(() => window.dispatchEvent(new Event('focus')))
  await maxStatusRequest
  await expect(maxChannelStatus).toBeVisible()
  await expect(page.getByText('Загружаем состояние канала…')).toHaveCount(0)
  releaseMaxStatus()
  holdMaxStatus = false
  await expect.poll(() => maxStatusRequestPending).toBe(true)
  await page.getByRole('button', { name: 'Добавить', exact: true }).click()
  await expect(page.locator('[data-slot="memoly-add-sheet-panel"]')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.locator('[data-slot="memoly-add-sheet-panel"]')).toHaveCount(0)
  await page.getByRole('button', { name: 'Семья', exact: true }).click()
  await page.getByRole('button', { name: 'Открыть участника: Анна' }).click()
  await expect(page.getByText('Профиль владельца')).toBeVisible()
  await page.getByRole('button', { name: 'Лента', exact: true }).click()
  await expect(photo).toBeVisible()
  await page.getByRole('button', { name: 'Открыть фото' }).click()
  const borrowedPhoto = page.locator('[data-mixed-viewer] img[alt="Воспоминание"]')
  await expect(borrowedPhoto).toBeVisible()
  await expect.poll(() => borrowedPhoto.evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0)).toBe(true)
  const borrowedSrcBeforeTransportRefresh = await borrowedPhoto.getAttribute('src')

  // AuthProvider recreates AuthenticatedTransport when its access token refreshes. Re-rendering
  // the real App with a new transport identity reproduces that lifecycle while the synthetic
  // private HTTP response is held, then verify the fullscreen viewer's borrowed URL stays live.
  const revokeCountBeforeTransportRefresh = await page.evaluate(() => (window as Window & { __warmNav: { revokeSnapshots: unknown[] } }).__warmNav.revokeSnapshots.length)
  await page.evaluate(() => (window as Window & { __warmNavRerender: (generation: number) => void }).__warmNavRerender(2))
  await transportRefreshRequest
  await expect.poll(() => refreshRequestPending, { timeout: 3_000 }).toBe(true)
  await page.waitForTimeout(100)
  const refreshEvidence = await page.evaluate(() => {
    const state = (window as Window & { __warmNav: { revoked: Set<string>; revokeSnapshots: Array<{ url: string; images: Array<{ alt: string; src: string; isConnected: boolean; complete: boolean; naturalWidth: number; hiddenSurface: boolean }> }>; imageErrors: unknown[]; samples: Array<{ revoked: boolean; complete: boolean | null; naturalWidth: number | null }> } }).__warmNav
    const image = document.querySelector<HTMLImageElement>('[data-mixed-viewer] img[alt="Воспоминание"]')
    return {
      src: image?.src ?? null,
      srcWasRevoked: Boolean(image && state.revoked.has(image.src)),
      naturalWidth: image?.naturalWidth ?? null,
      imageErrors: state.imageErrors,
      revokedWhileRendered: state.revokeSnapshots.flatMap(({ url, images }) => images.filter((entry) => entry.alt === 'Воспоминание').map((entry) => ({ url, ...entry }))),
      invalidOrRevokedFrames: state.samples.filter((sample) => sample.complete && (!sample.naturalWidth || sample.revoked)).length,
    }
  })
  releaseTransportRefresh()
  await expect.poll(() => transportRefreshCompleted).toBe(true)
  await expect.poll(() => page.evaluate(() => (window as Window & { __warmNav: { revokeSnapshots: unknown[] } }).__warmNav.revokeSnapshots.length)).toBeGreaterThan(revokeCountBeforeTransportRefresh)
  await expect.poll(() => photo.evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0)).toBe(true)
  const refreshReplacementEvidence = await page.evaluate((previousSrc) => {
    const state = (window as Window & { __warmNav: { revoked: Set<string>; revokeSnapshots: Array<{ url: string; images: Array<{ src: string; isConnected: boolean }> }> } }).__warmNav
    const image = document.querySelector<HTMLImageElement>('[data-mixed-viewer] img[alt="Воспоминание"]')
    return {
      previousSrc,
      currentSrc: image?.src ?? null,
      previousUrlRevoked: Boolean(previousSrc && state.revoked.has(previousSrc)),
      previousUrlStillRendered: Boolean(previousSrc && [...document.images].some((candidate) => candidate.src === previousSrc)),
      previousUrlRevokedWhileConnected: state.revokeSnapshots.some(({ url, images }) => url === previousSrc && images.some((entry) => entry.isConnected && entry.src === previousSrc)),
    }
  }, borrowedSrcBeforeTransportRefresh)

  holdReloadPhotoGet = true
  await page.close()
  page = await browserContext.newPage()
  page.on('console', (message) => { if (message.type() === 'error') pageDiagnostics.push(message.text()) })
  page.on('pageerror', (error) => pageDiagnostics.push(error.message))
  await page.goto('http://127.0.0.1:4193/e2e/warm-navigation-cache.fixture.html')
  await continueWelcome()
  await expect.poll(() => reloadPhotoGetPending).toBe(true)
  const reloadedPhoto = page.locator('[data-memoly-feed] .memoly-mixed-slide[data-carousel-active="true"] img[alt="Воспоминание"]')
  await expect(reloadedPhoto).toBeVisible()
  await expect.poll(() => reloadedPhoto.evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0)).toBe(true)
  const restoredSrcWhileOffline = await reloadedPhoto.getAttribute('src')
  expect(restoredSrcWhileOffline).toMatch(/^blob:/)
  releaseReloadPhotoGet()
  holdReloadPhotoGet = false
  await expect.poll(() => reloadPhotoGetCompleted).toBe(true)
  await expect.poll(() => reloadedPhoto.evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0)).toBe(true)
  expect(await reloadedPhoto.getAttribute('src')).toBe(restoredSrcWhileOffline)
  const readySrcBeforeCorruptResponse = await reloadedPhoto.getAttribute('src')

  // Remove this resource from the real IndexedDB private-image cache, then reproduce an HTTP 200
  // whose declared image format contains undecodable bytes during a transport-token refresh.
  await page.evaluate(() => (window as Window & { __warmNavEvictPhoto: () => Promise<void> }).__warmNavEvictPhoto())
  const revokeCountBeforeCorruptResponse = await page.evaluate(() => (window as Window & { __warmNav: { revokeSnapshots: unknown[] } }).__warmNav.revokeSnapshots.length)
  await page.evaluate(() => (window as Window & { __warmNavRerender: (generation: number) => void }).__warmNavRerender(3))
  await expect.poll(() => corruptResponseRequested).toBe(true)
  await expect.poll(() => corruptResponseCompleted).toBe(true)
  await expect.poll(() => page.evaluate(() => (window as Window & { __warmNav: { revokeSnapshots: unknown[] } }).__warmNav.revokeSnapshots.length)).toBeGreaterThan(revokeCountBeforeCorruptResponse)
  const corruptResponseEvidence = await page.evaluate(() => {
    const state = (window as Window & { __warmNav: { revoked: Set<string>; revokeSnapshots: Array<{ url: string; images: Array<{ alt: string; src: string; isConnected: boolean; complete: boolean; naturalWidth: number; hiddenSurface: boolean }> }>; imageErrors: Array<{ src: string; revokedAtError: boolean }> } }).__warmNav
    const image = document.querySelector<HTMLImageElement>('[data-memoly-feed] img[alt="Воспоминание"]')
    return {
      src: image?.src ?? null,
      srcWasRevoked: Boolean(image && state.revoked.has(image.src)),
      complete: image?.complete ?? null,
      naturalWidth: image?.naturalWidth ?? null,
      imageErrors: state.imageErrors,
      revokedWhileRendered: state.revokeSnapshots.flatMap(({ url, images }) => images.filter((entry) => entry.alt === 'Воспоминание').map((entry) => ({ url, ...entry }))),
    }
  })

  const finalSrc = await reloadedPhoto.getAttribute('src')
  await page.screenshot({ path: test.info().outputPath('warm-navigation-final.png'), fullPage: true })
  await writeFile(test.info().outputPath('warm-navigation-evidence.json'), JSON.stringify({ navigation: navigationEvidence, playback: { started: playbackStarted, hidden: playbackHidden, returned: playbackReturned }, scroll: { familyScrollAtSwitch, feedScrollRestored }, plainTabRequestCounts, mediaRequestCountsAfterPosterVisit: mediaRequestCounts, photoGetsOnPlainTabs: navigationPhotoGets, photoGetsAfterReload: apiRequests.filter((path) => path === `/api/v1/families/${familyId}/media/${photoId}/content?variant=display`).length, restoredSrcWhileOffline, refreshEvidence, refreshReplacementEvidence, corruptResponseEvidence }, null, 2))

  expect({ ...navigationEvidence, photoGets: navigationPhotoGets, initialSrc, finalSrcAfterTabSwitches }, 'Warm surfaces should retain valid private image state across plain tab switches').toEqual({
    feedMounts: 1,
    familyMounts: 1,
    brokenImageEvents: [],
    placeholderFrames: 0,
    invalidOrRevokedImageFrames: 0,
    photoGets: 1,
    initialSrc,
    finalSrcAfterTabSwitches: initialSrc,
  })
  expect(refreshEvidence).toMatchObject({ srcWasRevoked: false, naturalWidth: expect.any(Number), imageErrors: [], invalidOrRevokedFrames: 0, revokedWhileRendered: [] })
  expect(refreshEvidence.naturalWidth).toBeGreaterThan(0)
  expect(refreshEvidence.src).toMatch(/^blob:/)
  expect(refreshReplacementEvidence).toMatchObject({ previousUrlRevoked: false, previousUrlStillRendered: true, previousUrlRevokedWhileConnected: false })
  expect(refreshReplacementEvidence.currentSrc).toBe(refreshReplacementEvidence.previousSrc)
  expect(corruptResponseEvidence).toEqual({ src: readySrcBeforeCorruptResponse, srcWasRevoked: false, complete: true, naturalWidth: expect.any(Number), imageErrors: [], revokedWhileRendered: [] })
  expect(corruptResponseEvidence.naturalWidth).toBeGreaterThan(0)
  expect(finalSrc).toBe(readySrcBeforeCorruptResponse)
})

function photoAttachment(id: string) {
  const contentPath = `/api/v1/families/${familyId}/media/${id}/content`
  return { source: 'private_storage', id, kind: 'photo', width: 1_200, height: 800, durationMs: null, renditionStatus: 'ready', previewPath: `${contentPath}?variant=preview`, displayPath: `${contentPath}?variant=display`, playbackPath: null, originalDownloadPath: `${contentPath}?variant=original`, waveform: null }
}

function maxVideoAttachment(id: string) {
  return { id, source: 'max', kind: 'video', width: 1_280, height: 720, durationMs: 7_000, playbackPath: `/api/v1/families/${familyId}/media/max-videos/${id}/content` }
}

const familyResponse = {
  family: { id: familyId, name: 'Наша семья', timezone: 'Europe/Moscow', ownerUserId: userId },
  child: { id: childId, name: 'Миша', birthDate: null, sex: null, avatarMediaId: childAvatarId, avatarCrop: { x: 0, y: 0, width: 1, height: 1 }, version: 1, isComplete: true },
}

const homeResponse = {
  version: 1,
  ownFamilyId: familyId,
  ownFamilyStatus: 'active',
  canCreateOwnFamily: false,
  items: [{ familyId, name: 'Наша семья', displaySubtitle: 'Миша', childAvatarMediaId: childAvatarId, isOwner: true, role: 'full', setupStatus: 'ready', capabilities: { canCreateInvite: true, canManageMembers: true, canEditChild: true, canPublishNote: true, canPublishPhoto: true, canPublishVoice: true, canPublishVideo: true, canUploadChildAvatar: true }, unreadCount: null, unreadState: 'not_enabled', membershipEpoch: 1 }],
  nextCursor: null,
}
