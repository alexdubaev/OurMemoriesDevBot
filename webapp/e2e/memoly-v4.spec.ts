import { expect, test } from '@playwright/test'

test('selected child avatar and header stay stable across feed and family', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/e2e/memoly-v4.harness.html?avatarDelay=300')
  const feedHeader = page.locator('.ui-v2-child-header')
  await expect(feedHeader).toBeVisible()
  await expect(page.locator('.memory-card').first()).toBeVisible()
  const coldState = await feedHeader.locator('[data-slot="child-avatar-loading"]').count().then((count) => count ? 'loading' : 'unknown')
  console.log(`cold child-avatar state before response: ${coldState}`)
  await expect(feedHeader.locator('[data-slot="child-avatar-image"]')).toBeVisible()
  const feedGeometry = await headerGeometry(page, '.ui-v2-child-header')

  await page.getByRole('button', { name: 'Семья', exact: true }).click()
  const familyHeader = page.locator('.ui-v2-child-header[data-child-header-mode="family"]')
  await expect(familyHeader).toBeVisible()
  await expect(familyHeader.locator('[data-slot="child-avatar-image"]')).toBeVisible()
  const familyGeometry = await headerGeometry(page, '.ui-v2-child-header[data-child-header-mode="family"]')

  await page.getByRole('button', { name: 'Лента', exact: true }).click()
  await expect(feedHeader).toBeVisible()
  await expect(feedHeader.locator('[data-slot="child-avatar-image"]')).toBeVisible()
  const returnedGeometry = await headerGeometry(page, '.ui-v2-child-header')
  console.log(`feed/family header geometry: ${JSON.stringify({ feed: feedGeometry, family: familyGeometry })}`)
  expect.soft(coldState).toBe('loading')
  expect.soft(familyGeometry).toEqual(feedGeometry)
  expect.soft(returnedGeometry).toEqual(feedGeometry)
})

test('gift form handles marketplace clipboard shares before the single-line URL field', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write'])
  await page.goto('/e2e/selected-family-app.harness.html')
  const welcome = page.getByRole('button', { name: 'Продолжить' })
  const feed = page.locator('[data-navigation-surface="feed"] .ui-v2-child-header')
  await expect(welcome.or(feed).first()).toBeVisible()
  if (await welcome.isVisible()) await welcome.click()
  await expect(feed).toBeVisible()
  await page.getByRole('button', { name: 'Подарки', exact: true }).click()
  await page.getByRole('button', { name: 'Добавить подарок' }).click()

  const form = page.locator('[data-slot="gift-form"]')
  const urlField = form.getByLabel('Ссылка на товар')
  const titleField = form.getByLabel('Название')
  const saveButton = form.getByRole('button', { name: 'Сохранить' })
  const shareText = 'Magno World Магнитный конструктор робот трансформер спецтехника\nhttps://www.wildberries.ru/catalog/859795006/detail.aspx?size=1294253169'
  await page.evaluate(async (text) => navigator.clipboard.writeText(text), shareText)
  await urlField.focus()
  await page.keyboard.press('Control+V')
  await expect(urlField).toHaveValue('https://www.wildberries.ru/catalog/859795006/detail.aspx?size=1294253169')
  await expect(titleField).toHaveValue('Magno World Магнитный конструктор робот трансформер спецтехника')
  await expect(saveButton).toBeEnabled()
  await expect(urlField).toBeInViewport()
  await expect(titleField).toBeInViewport()
  await form.screenshot({ path: testInfo.outputPath('gift-share-paste-form.png'), animations: 'disabled' })

  await titleField.fill('Моё название')
  await page.evaluate(async () => navigator.clipboard.writeText('Неоднозначная ссылка\nhttps://shop.example/one https://shop.example/two'))
  await urlField.focus()
  await page.keyboard.press('Control+V')
  await expect(urlField).toHaveAttribute('aria-invalid', 'true')
  await expect(titleField).toHaveValue('Моё название')
  await expect(saveButton).toBeDisabled()

  await page.evaluate(async (text) => navigator.clipboard.writeText(text), shareText)
  await urlField.focus()
  await page.keyboard.press('Control+V')
  await expect(titleField).toHaveValue('Моё название')
  await expect(urlField).toHaveValue('https://www.wildberries.ru/catalog/859795006/detail.aspx?size=1294253169')

  await form.locator('input[type="file"]').setInputFiles({
    name: 'photo.png',
    mimeType: 'image/png',
    buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/pT8AAAAASUVORK5CYII=', 'base64'),
  })
  await expect(saveButton).toBeEnabled()

  const initialValue = 'https://shop.example/keep-this-suffix'
  await urlField.fill(initialValue)
  await urlField.evaluate((input: HTMLInputElement) => input.setSelectionRange(8, 18))
  await page.evaluate(async (text) => navigator.clipboard.writeText(text), 'https://paste.example')
  await urlField.focus()
  await page.keyboard.press('Control+V')
  await expect(urlField).toHaveValue(`${initialValue.slice(0, 8)}https://paste.example${initialValue.slice(18)}`)
})

test('production App keeps the selected child avatar through tabs and editor return', async ({ page }) => {
  const pageErrors: string[] = []
  page.on('pageerror', (error) => pageErrors.push(error.message))
  await page.setViewportSize({ width: 390, height: 844 })
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto('/e2e/selected-family-app.harness.html?avatarDelay=250')
  const welcome = page.getByRole('button', { name: 'Продолжить' })
  const feed = page.locator('[data-navigation-surface="feed"] .ui-v2-child-header')
  await expect(welcome.or(feed).first()).toBeVisible()
  if (await welcome.isVisible()) {
    await expect(welcome).toBeEnabled()
    await welcome.click()
  }
  await expect(feed).toBeVisible()
  await expect(feed.locator('[data-slot="child-avatar-image"]')).toBeVisible()
  const feedUrl = await feed.locator('[data-slot="child-avatar-image"]').getAttribute('src')
  const feedGeometry = await headerGeometry(page, '[data-navigation-surface="feed"] .ui-v2-child-header')
  await page.getByRole('button', { name: 'Семья', exact: true }).click()
  const family = page.locator('[data-navigation-surface="family"] .ui-v2-child-header[data-child-header-mode="family"]')
  await expect(family).toBeVisible()
  await expect(family.locator('[data-slot="child-avatar-image"]')).toBeVisible()
  const familyUrl = await family.locator('[data-slot="child-avatar-image"]').getAttribute('src')
  const familyGeometry = await headerGeometry(page, '[data-navigation-surface="family"] .ui-v2-child-header[data-child-header-mode="family"]')
  const warmRequestCount = await avatarRequestCount(page)
  const warmDecodeCount = await avatarDecodeCount(page)
  const warmBlobCount = await liveChildBlobCount(page)
  for (let cycle = 0; cycle < 3; cycle += 1) {
    await page.getByRole('button', { name: 'Лента', exact: true }).click()
    await expect(page.locator('[data-navigation-surface="feed"] [data-slot="child-avatar-image"]')).toBeVisible()
    await page.getByRole('button', { name: 'Семья', exact: true }).click()
    await expect(page.locator('[data-navigation-surface="family"] [data-slot="child-avatar-image"]')).toBeVisible()
  }
  await page.locator('[data-navigation-surface="family"] .ui-v2-settings').click()
  await expect(page.locator('.ml-settings-sheet[data-view="menu"]')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect.poll(() => page.evaluate(() => document.activeElement?.classList.contains('ui-v2-settings') ?? false)).toBe(true)
  expect(pageErrors).toEqual([])
  await page.getByRole('button', { name: 'Лента', exact: true }).click()
  await expect(page.locator('[data-navigation-surface="feed"] [data-slot="child-avatar-image"]')).toBeVisible()
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')))
  await expect.poll(() => avatarRequestCount(page)).toBe(warmRequestCount)
  const retainedAfterReturn = await page.locator('[data-navigation-surface="feed"] [data-slot="child-avatar-image"]').getAttribute('src')
  expect.soft(retainedAfterReturn).toBe(feedUrl)
  expect.soft(await avatarDecodeCount(page)).toBe(warmDecodeCount)
  expect.soft(await liveChildBlobCount(page)).toBe(warmBlobCount)
  expect.soft(await isChildBlobLive(page, feedUrl ?? '')).toBe(true)
  const countsBeforeEditor = await avatarRequestCount(page)

  await page.getByRole('button', { name: 'Семья', exact: true }).click()
  await expect(page.locator('[data-navigation-surface="family"] .ui-v2-child-header[data-child-header-mode="family"]')).toBeVisible()
  await page.getByRole('button', { name: /Редактировать профиль ребёнка: Алиса/ }).click()
  await expect(page.locator('[data-slot="child-profile-editor"]')).toBeVisible()
  await page.getByRole('button', { name: 'Назад к семье' }).click()
  await expect(page.locator('[data-navigation-surface="family"] .ui-v2-child-header[data-child-header-mode="family"]')).toBeVisible()
  await expect(page.locator('[data-navigation-surface="family"] [data-slot="child-avatar-image"]')).toBeVisible()
  const familyUrlAfterEditor = await page.locator('[data-navigation-surface="family"] [data-slot="child-avatar-image"]').getAttribute('src')
  const countsAfterEditor = await avatarRequestCount(page)

  console.log(`production App child-avatar request count through editor return: ${countsBeforeEditor} -> ${countsAfterEditor}; feed/family URL equal: ${feedUrl === familyUrl}`)
  expect.soft(familyGeometry).toEqual(feedGeometry)
  expect.soft(feedUrl).toBe(familyUrl)
  expect.soft(familyUrlAfterEditor).toBe(familyUrl)
  expect.soft(countsAfterEditor).toBe(countsBeforeEditor + 1) // The editor owns one source read for its crop preview.
})

test('production App reuses one child avatar across feed, family and same-family hub round trips', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto('/e2e/selected-family-app.harness.html?avatarDelay=180&channelMemory&onlyOneFamily')
  await startProductionFeed(page)

  const feedAvatar = page.locator('[data-navigation-surface="feed"] .ui-v2-child-header [data-slot="child-avatar-image"]')
  await expect(feedAvatar).toBeVisible()
  const readyUrl = await feedAvatar.getAttribute('src')
  const initialRequests = await avatarRequestCount(page)
  const initialDecodes = await avatarDecodeCount(page)
  const channelPath = '/api/v1/families/11111111-1111-4111-8111-111111111111/media/max-channels/1234567890123456789/avatar'
  await expect(page.getByText('Домашний канал')).toBeVisible()

  await page.evaluate(() => {
    const win = window as typeof window & { __selectedFamilyAvatarLoadingMutations?: number; __selectedFamilyAvatarLoadingObserver?: MutationObserver }
    win.__selectedFamilyAvatarLoadingMutations = 0
    win.__selectedFamilyAvatarLoadingObserver = new MutationObserver((records) => {
      for (const record of records) for (const node of record.addedNodes) {
        if (!(node instanceof Element)) continue
        if (node.matches('[data-slot="child-avatar-loading"]') || node.querySelector('[data-slot="child-avatar-loading"]')) {
          win.__selectedFamilyAvatarLoadingMutations = (win.__selectedFamilyAvatarLoadingMutations ?? 0) + 1
        }
      }
    })
    win.__selectedFamilyAvatarLoadingObserver.observe(document.body, { childList: true, subtree: true })
  })

  for (let cycle = 0; cycle < 2; cycle += 1) {
    await page.getByRole('button', { name: 'Семья', exact: true }).click()
    const familyAvatar = page.locator('[data-navigation-surface="family"] .ui-v2-child-header [data-slot="child-avatar-image"]')
    await expect(familyAvatar).toBeVisible()
    await expect(familyAvatar).toHaveAttribute('src', readyUrl ?? '')
    await page.getByRole('button', { name: 'Лента', exact: true }).click()
    await expect(feedAvatar).toBeVisible()
    await expect(feedAvatar).toHaveAttribute('src', readyUrl ?? '')

    await page.getByRole('button', { name: 'Мои семьи' }).click()
    await expect(page.getByRole('heading', { name: 'Мои семьи' })).toBeVisible()
    const familyCard = page.locator('.family-hub-card').filter({ hasText: 'Семья Алисы' })
    await expect(familyCard.locator('[data-slot="child-avatar-image"]')).toBeVisible()
    await expect(familyCard.locator('[data-slot="child-avatar-image"]')).toHaveAttribute('src', readyUrl ?? '')
    await familyCard.click()
    await expect(feedAvatar).toBeVisible()
    await expect(feedAvatar).toHaveAttribute('src', readyUrl ?? '')
  }

  expect(await avatarRequestCount(page)).toBe(initialRequests)
  expect(await avatarDecodeCount(page)).toBe(initialDecodes)
  expect(await page.evaluate(() => (window as typeof window & { __selectedFamilyAvatarLoadingMutations?: number }).__selectedFamilyAvatarLoadingMutations ?? 0)).toBe(0)
  expect(await rawRequestPaths(page)).not.toContain(channelPath)
  await page.evaluate(() => {
    const win = window as typeof window & { __selectedFamilyUpdateAvatar?: (mediaId: string, crop: { x: number; y: number; width: number; height: number }) => void }
    win.__selectedFamilyUpdateAvatar?.('aaa00000-0000-4000-8000-000000000012', { x: 0.18, y: 0.12, width: 0.48, height: 0.48 })
  })
  const channelSlot = page.locator('.publication-channel-avatar')
  const channelAvatarImage = channelSlot.locator('[data-slot="child-avatar-image"]')
  await expect(channelAvatarImage).toHaveAttribute('src', readyUrl ?? '')
  await expect(channelAvatarImage).toHaveCSS('position', 'absolute')
  const channelAvatarGeometry = () => channelSlot.evaluate((container) => {
    const avatar = container.querySelector<HTMLElement>('[data-slot="child-avatar"]')
    const image = container.querySelector<HTMLImageElement>('[data-slot="child-avatar-image"]')
    if (!avatar || !image) return null
    const slot = container.getBoundingClientRect()
    const bounds = avatar.getBoundingClientRect()
    const imageBounds = image.getBoundingClientRect()
    return {
      slot: { width: slot.width, height: slot.height, clientWidth: container.clientWidth, clientHeight: container.clientHeight, left: slot.left, top: slot.top, borderLeft: Number.parseFloat(getComputedStyle(container).borderLeftWidth), borderTop: Number.parseFloat(getComputedStyle(container).borderTopWidth) },
      avatar: { width: bounds.width, height: bounds.height },
      image: { width: imageBounds.width, height: imageBounds.height },
      contained: bounds.left >= slot.left + Number.parseFloat(getComputedStyle(container).borderLeftWidth) - 1
        && bounds.top >= slot.top + Number.parseFloat(getComputedStyle(container).borderTopWidth) - 1
        && bounds.right <= slot.right - Number.parseFloat(getComputedStyle(container).borderRightWidth) + 1
        && bounds.bottom <= slot.bottom - Number.parseFloat(getComputedStyle(container).borderBottomWidth) + 1,
      imageLoaded: image.complete && image.naturalWidth > 0,
    }
  })
  const normalChannelGeometry = await channelAvatarGeometry()
  expect(normalChannelGeometry).not.toBeNull()
  expect(normalChannelGeometry!.slot.clientWidth).toBeGreaterThan(0)
  expect(normalChannelGeometry!.slot.clientHeight).toBeGreaterThan(0)
  expect(Math.abs(normalChannelGeometry!.avatar.width - normalChannelGeometry!.slot.clientWidth)).toBeLessThanOrEqual(1)
  expect(Math.abs(normalChannelGeometry!.avatar.height - normalChannelGeometry!.slot.clientHeight)).toBeLessThanOrEqual(1)
  expect(normalChannelGeometry!.contained).toBe(true)
  expect(normalChannelGeometry!.imageLoaded).toBe(true)
  await page.setViewportSize({ width: 320, height: 800 })
  const narrowChannelGeometry = await channelAvatarGeometry()
  expect(narrowChannelGeometry).not.toBeNull()
  expect(narrowChannelGeometry!.slot.clientWidth).toBeGreaterThan(0)
  expect(narrowChannelGeometry!.slot.clientHeight).toBeGreaterThan(0)
  expect(Math.abs(narrowChannelGeometry!.avatar.width - narrowChannelGeometry!.slot.clientWidth)).toBeLessThanOrEqual(1)
  expect(Math.abs(narrowChannelGeometry!.avatar.height - narrowChannelGeometry!.slot.clientHeight)).toBeLessThanOrEqual(1)
  expect(narrowChannelGeometry!.contained).toBe(true)
  expect(narrowChannelGeometry!.imageLoaded).toBe(true)
  expect(await channelAvatarImage.getAttribute('src')).toBe(readyUrl)
  const avatarStages = await page.evaluate(() => (window as typeof window & { __selectedFamilyAvatarTimeline?: Array<{ stage: string; at: number; cacheHit?: boolean; duration?: number }> }).__selectedFamilyAvatarTimeline ?? [])
  const stageAt = (stage: string) => avatarStages.find((item) => item.stage === stage)?.at
  console.log(`avatar stage durations (ms): rights=${avatarStages.find((item) => item.stage === 'rights:data:home')?.duration?.toFixed(1) ?? 'n/a'}, idb=${avatarStages.find((item) => item.stage === 'idb:image:ready')?.duration?.toFixed(1) ?? 'n/a'} (hit=${avatarStages.find((item) => item.stage === 'idb:image:ready')?.cacheHit ?? 'n/a'}), network=${stageAt('fetch:start') !== undefined && stageAt('fetch:ready') !== undefined ? Math.round(stageAt('fetch:ready')! - stageAt('fetch:start')!) : 'avoided'}, decode=${stageAt('decode:start') !== undefined && stageAt('decode:ready') !== undefined ? Math.round(stageAt('decode:ready')! - stageAt('decode:start')!) : 'n/a'}`)
  await page.evaluate(() => (window as typeof window & { __selectedFamilyAvatarLoadingObserver?: MutationObserver }).__selectedFamilyAvatarLoadingObserver?.disconnect())

  const replacementId = 'aaa00000-0000-4000-8000-000000000013'
  const replacementCrop = { x: 0.2, y: 0.1, width: 0.6, height: 0.7 }
  await page.evaluate(({ replacementId, replacementCrop }) => {
    const win = window as typeof window & { __selectedFamilyUpdateAvatar?: (mediaId: string | null, crop: typeof replacementCrop) => void }
    win.__selectedFamilyUpdateAvatar?.(replacementId, replacementCrop)
  }, { replacementId, replacementCrop })
  await expect(feedAvatar).toBeVisible()
  const replacementUrl = await feedAvatar.getAttribute('src')
  expect(replacementUrl).not.toBe(readyUrl)
  const feedCropLeft = Number.parseFloat(await feedAvatar.evaluate((image) => image.style.left))
  expect(feedCropLeft).toBeCloseTo(-33.333, 2)
  await page.getByRole('button', { name: 'Мои семьи' }).click()
  await expect(page.getByRole('heading', { name: 'Мои семьи' })).toBeVisible()
  const updatedCardAvatar = page.locator('.family-hub-card').filter({ hasText: 'Семья Алисы' }).locator('[data-slot="child-avatar-image"]')
  await expect(updatedCardAvatar).toBeVisible()
  await expect(updatedCardAvatar).toHaveAttribute('src', replacementUrl ?? '')
  const hubCropLeft = Number.parseFloat(await updatedCardAvatar.evaluate((image) => image.style.left))
  expect(hubCropLeft).toBeCloseTo(feedCropLeft, 4)
  await page.locator('.family-hub-card').filter({ hasText: 'Семья Алисы' }).click()
  await expect(feedAvatar).toHaveAttribute('src', replacementUrl ?? '')
  const channelAvatar = page.locator('.publication-channel-avatar img')
  await expect(channelAvatar).toHaveAttribute('src', replacementUrl ?? '')
  const channelCropLeft = Number.parseFloat(await channelAvatar.evaluate((image) => image.style.left))
  expect(channelCropLeft).toBeCloseTo(feedCropLeft, 4)
  expect(await rawRequestPaths(page)).not.toContain(channelPath)
})

test('welcome CTA is ready immediately, pauses with document visibility, and completes the real App transition', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 740 })
  await page.goto('/e2e/selected-family-app.harness.html?avatarDelay=250&welcomeFirst')

  const welcome = page.getByRole('button', { name: 'Продолжить', exact: true })
  await expect(welcome).toBeVisible({ timeout: 1_500 })
  await expect(welcome).toBeEnabled()
  await welcome.focus()
  await expect(welcome).toBeFocused()

  await page.emulateMedia({ reducedMotion: 'reduce' })
  await expect.poll(() => page.locator('.memolyWelcome .photo').evaluate((image) => getComputedStyle(image).opacity)).toBe('1')
  await expect.poll(() => page.locator('.memolyWelcome .bg').evaluate((image) => getComputedStyle(image).animationName)).toBe('none')
  await page.emulateMedia({ reducedMotion: 'no-preference' })

  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' })
    document.dispatchEvent(new Event('visibilitychange'))
  })
  await expect.poll(() => page.locator('.memolyWelcome .bg').evaluate((image) => getComputedStyle(image).animationPlayState)).toBe('paused')
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' })
    document.dispatchEvent(new Event('visibilitychange'))
  })
  await expect.poll(() => page.locator('.memolyWelcome .bg').evaluate((image) => getComputedStyle(image).animationPlayState)).toBe('running')

  await welcome.evaluate((button: HTMLButtonElement) => {
    button.click()
    button.click()
  })
  await expect(page.locator('[data-navigation-surface="feed"] .ui-v2-child-header')).toBeVisible()
  await expect(page.locator('.memolyWelcome')).toHaveCount(0)
})

test('production App skips the welcome after the account claim has been used', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/e2e/selected-family-app.harness.html?welcomeFirst')
  const welcome = page.getByRole('button', { name: 'Продолжить', exact: true })
  await expect(welcome).toBeVisible()
  await welcome.click()
  await expect(page.locator('[data-navigation-surface="feed"] .ui-v2-child-header')).toBeVisible()

  await page.reload()
  await expect(page.locator('[data-navigation-surface="feed"] .ui-v2-child-header')).toBeVisible()
  await expect(page.locator('.memolyWelcome')).toHaveCount(0)
})

test('production entry blocks page pinch zoom while preserving ordinary input and PhotoSwipe gestures', async ({ page }) => {
  const cdp = await page.context().newCDPSession(page)
  let pinchScale: number
  try {
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: 390,
      height: 740,
      deviceScaleFactor: 1,
      mobile: true,
    })
    await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true })
    await page.goto('/')
    const blockingZoomListeners = async () => {
      const remoteDocument = await cdp.send('Runtime.evaluate', { expression: 'document' })
      if (!remoteDocument.result.objectId) throw new Error('Could not inspect document event listeners')
      const { listeners } = await cdp.send('DOMDebugger.getEventListeners', { objectId: remoteDocument.result.objectId })
      return listeners
        .filter((listener) => ['gesturestart', 'gesturechange', 'touchmove'].includes(listener.type) && listener.passive !== true)
        .map((listener) => listener.type)
        .sort()
    }
    expect(await blockingZoomListeners()).toEqual([])
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 195, y: 300, id: 1 }] })
    expect(await blockingZoomListeners()).toEqual(['gesturestart'])
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
    await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
    expect(await blockingZoomListeners()).toEqual([])
    await cdp.send('Input.synthesizePinchGesture', {
      x: 195,
      y: 300,
      scaleFactor: 1.6,
      relativeSpeed: 800,
      gestureSourceType: 'touch',
    })
    pinchScale = await page.evaluate(() => window.visualViewport?.scale ?? 1)
  } finally {
    await cdp.detach()
  }

  const outcomes = await page.evaluate(() => {
    const dispatch = (target: EventTarget, type: string, properties: Record<string, unknown> = {}) => {
      const event = new Event(type, { bubbles: true, cancelable: true })
      for (const [key, value] of Object.entries(properties)) Object.defineProperty(event, key, { configurable: true, value })
      target.dispatchEvent(event)
      return event.defaultPrevented
    }
    const pswp = document.createElement('div')
    pswp.className = 'pswp'
    const image = document.createElement('img')
    pswp.append(image)
    document.body.append(pswp)

    const outcome = {
      rootTouchAction: getComputedStyle(document.documentElement).touchAction,
      firstFinger: dispatch(document, 'touchstart', { touches: [{}] }),
      gestureStart: dispatch(document, 'gesturestart'),
      secondFinger: dispatch(document, 'touchstart', { touches: [{}, {}] }),
      multiTouch: dispatch(document, 'touchmove', { touches: [{}, {}] }),
      gestureChange: dispatch(document, 'gesturechange'),
      lastFinger: dispatch(document, 'touchend', { touches: [{}] }),
      singleTouch: dispatch(document, 'touchmove', { touches: [{}] }),
      finalFinger: dispatch(document, 'touchend', { touches: [] }),
      ctrlWheel: dispatch(document, 'wheel', { ctrlKey: true }),
      metaWheel: dispatch(document, 'wheel', { metaKey: true }),
      ordinaryWheel: dispatch(document, 'wheel', { ctrlKey: false, metaKey: false }),
      photoSwipeTouchStart: dispatch(image, 'touchstart', { touches: [{}] }),
      photoSwipeGesture: dispatch(image, 'gesturestart'),
      photoSwipeTouchEnd: dispatch(image, 'touchend', { touches: [] }),
    }
    pswp.remove()
    return outcome
  })

  expect(pinchScale).toBe(1)
  expect(outcomes).toEqual({
    rootTouchAction: 'pan-x pan-y',
    firstFinger: false,
    gestureStart: true,
    secondFinger: false,
    multiTouch: true,
    gestureChange: true,
    lastFinger: false,
    singleTouch: false,
    finalFinger: false,
    ctrlWheel: true,
    metaWheel: true,
    ordinaryWheel: false,
    photoSwipeTouchStart: false,
    photoSwipeGesture: false,
    photoSwipeTouchEnd: false,
  })
})

test('production App confirms a cold hub family before loading and keeps its avatar on first selection', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto('/e2e/selected-family-app.harness.html?hubFirst&onlyOneFamily&homeDelay=450&avatarDelay=180&welcomeFirst')
  const welcome = page.getByRole('button', { name: 'Продолжить' })
  const card = page.locator('.family-hub-card').filter({ hasText: 'Семья Алисы' })
  await expect(welcome).toBeVisible()
  await welcome.click()
  await expect(card).toBeVisible()
  await expect(card.locator('[data-slot="child-avatar-loading"]')).toBeVisible()
  expect(await avatarRequestCount(page)).toBe(0)
  await expect(card.locator('[data-slot="child-avatar-image"]')).toBeVisible()
  const readyUrl = await card.locator('[data-slot="child-avatar-image"]').getAttribute('src')
  const requestsBeforeSelection = await avatarRequestCount(page)
  await card.click()
  const feedAvatar = page.locator('[data-navigation-surface="feed"] .ui-v2-child-header [data-slot="child-avatar-image"]')
  await expect(feedAvatar).toBeVisible()
  await expect(feedAvatar).toHaveAttribute('src', readyUrl ?? '')
  expect(requestsBeforeSelection).toBe(1)
  expect(await avatarRequestCount(page)).toBe(requestsBeforeSelection)
  const timeline = await page.evaluate(() => (window as typeof window & { __selectedFamilyAvatarTimeline?: Array<{ stage: string; at: number; cacheHit?: boolean; duration?: number }> }).__selectedFamilyAvatarTimeline ?? [])
  expect(timeline.findIndex((item) => item.stage === 'rights:data:home')).toBeLessThan(timeline.findIndex((item) => item.stage === 'fetch:start'))
  expect(await isChildBlobLive(page, readyUrl ?? '')).toBe(true)
})

test('production App remains usable with a delayed cold child avatar', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 740 })
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto('/e2e/selected-family-app.harness.html?avatarDelay=1400')
  await startProductionFeed(page)
  const header = page.locator('[data-navigation-surface="feed"] .ui-v2-child-header')
  await expect(header.locator('[data-slot="child-avatar-loading"]')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Семья', exact: true })).toBeVisible()
  const loadingGeometry = await headerGeometry(page, '[data-navigation-surface="feed"] .ui-v2-child-header')
  await expect(header.locator('[data-slot="child-avatar-image"]')).toBeVisible({ timeout: 5000 })
  expect(await headerGeometry(page, '[data-navigation-surface="feed"] .ui-v2-child-header')).toEqual(loadingGeometry)
  const timeline = await page.evaluate(() => (window as typeof window & { __selectedFamilyAvatarTimeline?: Array<{ stage: string; at: number; cacheHit?: boolean; duration?: number }> }).__selectedFamilyAvatarTimeline ?? [])
  const fetchStart = timeline.find((item) => item.stage === 'fetch:start')?.at
  const fetchReady = timeline.find((item) => item.stage === 'fetch:ready')?.at
  const decodeReady = timeline.find((item) => item.stage === 'decode:ready')?.at
  const idbReady = timeline.find((item) => item.stage === 'idb:image:ready')
  console.log(`cold avatar stage durations (ms): rights=${timeline.find((item) => item.stage === 'rights:data:home')?.duration?.toFixed(1) ?? 'n/a'}, idb=${idbReady?.duration?.toFixed(1) ?? 'n/a'} (hit=${idbReady?.cacheHit ?? 'n/a'}), network=${fetchStart !== undefined && fetchReady !== undefined ? Math.round(fetchReady - fetchStart) : 'n/a'}, decode=${timeline.find((item) => item.stage === 'decode:start')?.at !== undefined && decodeReady !== undefined ? Math.round(decodeReady - timeline.find((item) => item.stage === 'decode:start')!.at) : 'n/a'}`)
})

test('production App uses the saved private child photo while a refresh is delayed', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto('/e2e/selected-family-app.harness.html?cached&avatarDelay=1400')
  await startProductionFeed(page)
  const header = page.locator('[data-navigation-surface="feed"] .ui-v2-child-header')
  await expect(header.locator('[data-slot="child-avatar-image"]')).toBeVisible()
  const url = await header.locator('[data-slot="child-avatar-image"]').getAttribute('src')
  const requests = await avatarRequestCount(page)
  const timeline = await page.evaluate(() => (window as typeof window & { __selectedFamilyAvatarTimeline?: Array<{ stage: string; at: number; cacheHit?: boolean; duration?: number }> }).__selectedFamilyAvatarTimeline ?? [])
  expect(requests).toBe(0)
  expect(timeline.some((item) => item.stage === 'decode:ready')).toBe(true)
  expect(timeline.some((item) => item.stage === 'fetch:ready')).toBe(false)
  const fetchStart = timeline.find((item) => item.stage === 'fetch:start')?.at
  const idbReady = timeline.find((item) => item.stage === 'idb:image:ready')
  const decodeReady = timeline.find((item) => item.stage === 'decode:ready')?.at
  expect(idbReady?.cacheHit).toBe(true)
  expect(decodeReady).toBeDefined()
  if (fetchStart !== undefined) expect(decodeReady!).toBeLessThan(fetchStart)
  console.log(`cached avatar stage durations (ms): rights=${timeline.find((item) => item.stage === 'rights:data:home')?.duration?.toFixed(1) ?? 'n/a'}, idb=${idbReady?.duration?.toFixed(1) ?? 'n/a'} (hit=${idbReady?.cacheHit ?? 'n/a'}), decode=${timeline.find((item) => item.stage === 'decode:start')?.at !== undefined && decodeReady !== undefined ? Math.round(decodeReady - timeline.find((item) => item.stage === 'decode:start')!.at) : 'n/a'}, network=${fetchStart === undefined ? 'avoided for immutable child resource' : 'unexpected'} (delay configured=1400 ms)`)
  await expect(header.locator('[data-slot="child-avatar-image"]')).toHaveAttribute('src', url ?? '')
})

test('production App drops the previous avatar across family and account changes', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto('/e2e/selected-family-app.harness.html?avatarDelay=500')
  await startProductionFeed(page)
  const original = page.locator('[data-navigation-surface="feed"] [data-slot="child-avatar-image"]')
  await expect(original).toBeVisible()
  const firstUrl = await original.getAttribute('src')

  await page.getByRole('button', { name: 'Мои семьи' }).click()
  await expect(page.getByRole('heading', { name: 'Мои семьи' })).toBeVisible()
  await page.getByRole('button', { name: /Семья Миши, Миша/ }).click()
  const secondHeader = page.locator('[data-navigation-surface="feed"] .ui-v2-child-header')
  await expect(secondHeader.locator('[data-slot="child-avatar-loading"]')).toBeVisible()
  await expect(secondHeader.locator('[data-slot="child-avatar-image"]')).toHaveCount(0)
  expect(await isChildBlobLive(page, firstUrl ?? '')).toBe(false)
  await expect(secondHeader.locator('[data-slot="child-avatar-image"]')).toBeVisible()
  const secondUrl = await secondHeader.locator('[data-slot="child-avatar-image"]').getAttribute('src')
  expect(secondUrl).not.toBe(firstUrl)

  await page.evaluate(() => (window as typeof window & { __selectedFamilyChangeAccount?: () => void }).__selectedFamilyChangeAccount?.())
  await startProductionFeed(page)
  await expect(page.locator('[data-navigation-surface="feed"] .ui-v2-child-header [data-slot="child-avatar-loading"]')).toBeVisible()
  await expect(page.locator('[data-navigation-surface="feed"] .ui-v2-child-header [data-slot="child-avatar-image"]')).toHaveCount(0)
  expect(await isChildBlobLive(page, secondUrl ?? '')).toBe(false)
  await expect(page.locator('[data-navigation-surface="feed"] .ui-v2-child-header [data-slot="child-avatar-image"]')).toBeVisible()
  expect(await page.locator('[data-navigation-surface="feed"] [data-slot="child-avatar-image"]').getAttribute('src')).not.toBe(secondUrl)
})

test('production App replaces, recrops, removes and revokes only the current child avatar', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto('/e2e/selected-family-app.harness.html?avatarDelay=350')
  await startProductionFeed(page)
  const feedHeader = page.locator('[data-navigation-surface="feed"] .ui-v2-child-header')
  await expect(feedHeader.locator('[data-slot="child-avatar-image"]')).toBeVisible()
  const firstUrl = await feedHeader.locator('[data-slot="child-avatar-image"]').getAttribute('src')
  const requestsBefore = await avatarRequestCount(page)
  const replacementId = 'aaa00000-0000-4000-8000-000000000013'
  await page.evaluate(({ replacementId }) => {
    const win = window as typeof window & { __selectedFamilyUpdateAvatar?: (mediaId: string | null, crop: { x: number; y: number; width: number; height: number } | null) => void }
    win.__selectedFamilyUpdateAvatar?.(replacementId, { x: 0.2, y: 0.1, width: 0.6, height: 0.7 })
  }, { replacementId })
  await expect(feedHeader.locator('[data-slot="child-avatar-loading"]')).toBeVisible()
  await expect(feedHeader.locator('[data-slot="child-avatar-image"]')).toHaveCount(0)
  await expect(feedHeader.locator('[data-slot="child-avatar-image"]')).toBeVisible()
  const replacementUrl = await feedHeader.locator('[data-slot="child-avatar-image"]').getAttribute('src')
  const replacementImage = feedHeader.locator('[data-slot="child-avatar-image"]')
  expect(Number.parseFloat(await replacementImage.evaluate((image) => (image as HTMLImageElement).style.left))).toBeCloseTo(-33.3333, 2)
  expect(replacementUrl).not.toBe(firstUrl)
  expect(await avatarRequestCount(page)).toBe(requestsBefore + 1)

  await page.getByRole('button', { name: 'Семья', exact: true }).click()
  const familyImage = page.locator('[data-navigation-surface="family"] [data-slot="child-avatar-image"]')
  await expect(familyImage).toBeVisible()
  expect(Number.parseFloat(await familyImage.evaluate((image) => (image as HTMLImageElement).style.left))).toBeCloseTo(-33.3333, 2)
  expect(await familyImage.getAttribute('src')).toBe(replacementUrl)

  await page.evaluate(({ replacementId }) => {
    const win = window as typeof window & { __selectedFamilyUpdateAvatar?: (mediaId: string | null, crop: { x: number; y: number; width: number; height: number } | null) => void }
    win.__selectedFamilyUpdateAvatar?.(replacementId, { x: 0.1, y: 0.15, width: 0.8, height: 0.75 })
  }, { replacementId })
  await expect.poll(() => familyImage.evaluate((image) => Number.parseFloat((image as HTMLImageElement).style.left))).toBeCloseTo(-12.5, 2)
  const requestCountAfterCrop = await avatarRequestCount(page)
  await expect(familyImage).toHaveAttribute('src', replacementUrl ?? '')
  expect(requestCountAfterCrop).toBe(requestsBefore + 1)

  await page.evaluate(() => {
    const win = window as typeof window & { __selectedFamilyUpdateAvatar?: (mediaId: string | null, crop: { x: number; y: number; width: number; height: number } | null) => void }
    win.__selectedFamilyUpdateAvatar?.(null, null)
  })
  await expect(page.locator('[data-navigation-surface="family"] [data-slot="child-avatar-loading"]')).toHaveCount(0)
  await expect(page.locator('[data-navigation-surface="family"] [data-slot="child-avatar-image"]')).toHaveCount(0)
  await expect(page.locator('[data-navigation-surface="family"] .ui-v2-child-avatar [data-slot="avatar-letter"]')).toBeVisible()
  expect(await isChildBlobLive(page, replacementUrl ?? '')).toBe(false)

  await page.evaluate(({ replacementId }) => {
    const win = window as typeof window & { __selectedFamilyUpdateAvatar?: (mediaId: string | null, crop: { x: number; y: number; width: number; height: number } | null) => void }
    win.__selectedFamilyUpdateAvatar?.(replacementId, null)
  }, { replacementId })
  await expect(page.locator('[data-navigation-surface="family"] [data-slot="child-avatar-image"]')).toBeVisible()
  const authorizedUrl = await page.locator('[data-navigation-surface="family"] [data-slot="child-avatar-image"]').getAttribute('src')
  await page.evaluate(() => (window as typeof window & { __selectedFamilyRevokeAccess?: () => void }).__selectedFamilyRevokeAccess?.())
  await expect(page.locator('[data-navigation-surface="family"] .ui-v2-child-header')).toHaveCount(0)
  expect(await isChildBlobLive(page, authorizedUrl ?? '')).toBe(false)
})

async function avatarRequestCount(page: import('@playwright/test').Page) {
  return page.evaluate(() => (window as typeof window & { __selectedFamilyAvatarRequests?: number[] }).__selectedFamilyAvatarRequests?.length ?? 0)
}

async function rawRequestPaths(page: import('@playwright/test').Page) {
  return page.evaluate(() => (window as typeof window & { __selectedFamilyRawPaths?: string[] }).__selectedFamilyRawPaths ?? [])
}

async function startProductionFeed(page: import('@playwright/test').Page) {
  const welcome = page.getByRole('button', { name: 'Продолжить' })
  const feed = page.locator('[data-navigation-surface="feed"] .ui-v2-child-header')
  await expect(welcome.or(feed).first()).toBeVisible()
  if (await welcome.isVisible()) await welcome.click()
  await expect(feed).toBeVisible()
}

async function avatarDecodeCount(page: import('@playwright/test').Page) {
  return page.evaluate(() => (window as typeof window & { __selectedFamilyAvatarTimeline?: Array<{ stage: string }> }).__selectedFamilyAvatarTimeline?.filter((item) => item.stage === 'decode:ready').length ?? 0)
}

async function liveChildBlobCount(page: import('@playwright/test').Page) {
  return page.evaluate(() => (window as typeof window & { __selectedFamilyLiveBlobCount?: () => number }).__selectedFamilyLiveBlobCount?.() ?? 0)
}

async function isChildBlobLive(page: import('@playwright/test').Page, url: string) {
  return page.evaluate((candidate) => (window as typeof window & { __selectedFamilyIsBlobLive?: (url: string) => boolean }).__selectedFamilyIsBlobLive?.(candidate) ?? false, url)
}

async function headerGeometry(page: import('@playwright/test').Page, selector: string) {
  return page.locator(selector).evaluate((header) => {
    const rect = (element: Element | null) => {
      if (!element) return null
      const { x, y, width, height } = element.getBoundingClientRect()
      return { x, y, width, height }
    }
    return {
      header: rect(header),
      avatar: rect(header.querySelector('.ui-v2-child-avatar')),
      name: rect(header.querySelector('.ui-v2-child-name')),
      age: rect(header.querySelector('.ui-v2-child-subtitle')),
      settings: rect(header.querySelector('.ui-v2-settings')),
    }
  })
}
test('feed and family navigation expose working controls', async ({ page }) => {
  await page.goto('/e2e/memoly-v4.harness.html')
  await expect(page.locator('.memory-card').first()).toBeVisible()
  await page.getByRole('button', { name: 'Настройки' }).click()
  await expect(page.locator('.ml-settings-sheet[data-view="menu"]')).toBeVisible()
  await page.keyboard.press('Escape')
  await page.goto('/e2e/memoly-v4.harness.html?family=1&role=owner')
  await expect(page.locator('.family-screen')).toBeVisible()
  await expect(page.locator('.family-invite-btn')).toBeVisible()
})

test('add sheet traps focus and closes with Escape or browser Back', async ({ page }) => {
  await page.goto('/e2e/memoly-v4.harness.html')
  const opener = page.getByRole('button', { name: 'Добавить' })
  await opener.click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()
  const firstControl = dialog.locator('button:visible').first()
  const lastControl = dialog.locator('button:visible').last()
  await lastControl.focus()
  await page.keyboard.press('Tab')
  await expect(firstControl).toBeFocused()
  await page.keyboard.press('Shift+Tab')
  await expect(lastControl).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)
  await expect(opener).toBeFocused()

  await opener.click()
  await expect(dialog).toBeVisible()
  await page.goBack()
  await expect(dialog).toHaveCount(0)
  await expect(page.locator('.memory-card').first()).toBeVisible()
})

test('viewer can open an attributed publication, navigate attachments and return to the feed', async ({ page }) => {
  await page.goto('/e2e/memoly-v4.harness.html?attribution&role=viewer')
  const cards = page.locator('.memory-card')
  await expect(cards).toHaveCount(6)
  const channelCard = cards.nth(0)
  await expect(channelCard.locator('.author-name')).not.toBeEmpty()
  await expect(channelCard.locator('.publication-channel-avatar img')).toBeVisible()
  const fallbackCard = cards.nth(3)
  await expect(fallbackCard.locator('.publication-channel-avatar img')).toBeVisible()
  const memberCard = cards.nth(1)
  await expect(memberCard.locator('.author-avatar img')).toBeVisible()
  await channelCard.locator('[data-carousel-position="1"] button').click()
  const viewer = page.locator('[data-mixed-viewer]')
  await expect(viewer).toBeVisible()
  await expect(viewer.locator('.memoly-viewer-author')).toBeVisible()
  await page.keyboard.press('ArrowRight')
  await expect(viewer.locator('.memoly-viewer-count')).toContainText('2')
  await page.keyboard.press('ArrowLeft')
  await expect(viewer.locator('.memoly-viewer-count')).toContainText('1')
  await viewer.getByRole('button', { name: 'Закрыть просмотр' }).click()
  await expect(viewer).toHaveCount(0)
  await expect(channelCard).toBeVisible()
  await fallbackCard.locator('[data-carousel-position="1"] button').click()
  await expect(page.locator('[data-mixed-viewer] .memoly-viewer-author')).toBeVisible()
  await page.locator('[data-mixed-viewer]').getByRole('button', { name: 'Закрыть просмотр' }).click()
  await memberCard.locator('[data-carousel-position="1"] button').click()
  await expect(page.locator('[data-mixed-viewer] .memoly-viewer-author')).toBeVisible()
  await page.locator('[data-mixed-viewer]').getByRole('button', { name: 'Закрыть просмотр' }).click()
})
test('family screen exposes actions allowed by each membership role', async ({ page }) => {
  for (const role of ['owner', 'full', 'viewer'] as const) {
    await page.goto('/e2e/memoly-v4.harness.html?family=1&role=' + role)
    await expect(page.locator('.family-screen')).toBeVisible()
    await expect(page.locator('.family-member-row')).toHaveCount(2)
    const canWrite = role !== 'viewer'
    await expect(page.locator('.family-invite-btn')).toHaveCount(canWrite ? 1 : 0)
    if (canWrite) await expect(page.locator('nav').getByRole('button', { name: 'Добавить' })).toBeVisible()
    else await expect(page.getByRole('img', { name: 'Режим просмотра' })).toBeVisible()
    if (role === 'full') await expect(page.locator('.family-leave-action')).toBeVisible()
  }
})
test('photo-only album uses the unified viewer and navigates its loaded slides', async ({ page }) => {
  await page.goto('/e2e/memoly-v4.harness.html')
  const album = page.locator('.memory-card').nth(3)
  await album.scrollIntoViewIfNeeded()
  await album.getByRole('button', { name: 'Открыть фото' }).click()
  const viewer = page.locator('[data-mixed-viewer]')
  await expect(viewer).toBeVisible()
  const thumbnails = viewer.locator('.memoly-viewer-thumbnails button')
  await expect(thumbnails).toHaveCount(3)
  await expect(viewer.locator('.memoly-viewer-caption')).toBeVisible()
  await expect.poll(() => thumbnails.locator('img').evaluateAll((images) => images.every((image) => image instanceof HTMLImageElement && image.complete && image.naturalWidth > 0))).toBe(true)
  await thumbnails.nth(1).click()
  await expect(thumbnails.nth(1)).toHaveAttribute('aria-pressed', 'true')
  await expect(viewer.getByText('2 / 3')).toBeVisible()
  const activeSlide = viewer.locator('.memoly-mixed-viewer-slide[data-carousel-active="true"]')
  await expect(activeSlide).toHaveCount(1)
  await expect.poll(() => activeSlide.locator('img').evaluate((image) => image instanceof HTMLImageElement && image.complete && image.naturalWidth > 0 && image.getBoundingClientRect().width > 0)).toBe(true)
})
test('owner family child card opens the editor directly with separate avatar actions', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/e2e/memoly-v4.harness.html?family=1&role=owner')
  await page.getByRole('button', { name: /Редактировать профиль ребёнка: Алиса/ }).click()
  await expect(page.locator('[data-slot="child-profile-editor"]')).toBeVisible()
  await expect(page.locator('.child-profile')).toHaveCount(0)
  await expect(page.getByLabel('Имя ребёнка')).toHaveValue('Алиса')
  await expect(page.getByLabel('Дата рождения')).toHaveValue('2024-01-17')
  await expect(page.getByRole('radio', { name: /Девочка/ })).toBeChecked()
  await expect(page.getByText('Имя в семье', { exact: true })).toHaveCount(0)
  await page.screenshot({ path: testInfo.outputPath('family-child-editor.png'), fullPage: true })
  await page.getByRole('button', { name: 'Изменить кадрирование' }).click()
  const cropper = page.getByRole('dialog', { name: 'Редактирование фотографии' })
  await expect(cropper).toBeVisible()
  await expect(cropper.getByRole('slider', { name: 'Масштаб' })).toBeEnabled()
  await cropper.getByRole('button', { name: 'Отмена' }).click()
  await page.locator('#child-avatar').setInputFiles({ name: 'synthetic.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/R8kAAAAASUVORK5CYII=', 'base64') })
  await expect(cropper).toBeVisible()
  await cropper.getByRole('button', { name: 'Отмена' }).click()
  await expect(page.locator('[data-slot="child-profile-editor"]')).toBeVisible()
  await page.getByRole('button', { name: 'Назад к семье' }).click()
  await page.getByRole('button', { name: 'Открыть участника: Папа' }).click()
  await expect(page.getByText('Имя в семье', { exact: true })).toHaveCount(0)
  await expect(page.getByLabel('Имя профиля')).toBeVisible()
})
test('nonowner family child card stays static and its family alias remains visible', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/e2e/memoly-v4.harness.html?family=1&role=viewer')
  await expect(page.getByRole('button', { name: /Редактировать профиль ребёнка/ })).toHaveCount(0)
  await expect(page.locator('[data-child-header-mode="family"] .ui-v2-child-identity')).toHaveCount(1)
  await expect(page.locator('[data-slot="child-profile-editor"]')).toHaveCount(0)
  await page.getByRole('button', { name: 'Открыть участника: Дедушка' }).click()
  await expect(page.getByRole('heading', { name: 'Имя в семье' })).toBeVisible()
  await expect(page.getByRole('textbox', { name: 'Имя в семье' })).toHaveValue('Дедушка')
})
