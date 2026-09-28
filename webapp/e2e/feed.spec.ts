import type { Page } from '@playwright/test'
import { createHash, createHmac, randomUUID } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

import { createPrisma } from '../../backend/src/db'
import { FilesystemPrivateStorage } from '../../backend/src/storage/filesystem-storage'
import { pngImage } from './helpers/images'
import { expect, test } from './helpers/test'

type E2EAttachment = {
  id?: string
  source?: string
  kind?: string
  width?: number | null
  height?: number | null
  [key: string]: unknown
}

type E2EMemoryFixture = {
  familyId: string
  body?: string
  attachments: E2EAttachment[]
  [key: string]: unknown
}

const subject = '81000013'
const databaseUrl = process.env.TEST_DATABASE_URL!
const backendUrl = process.env.E2E_BACKEND_URL!
const storageRoot = resolve('e2e/.artifacts/storage')
const prisma = createPrisma(databaseUrl)
const storage = new FilesystemPrivateStorage({
  driver: 'filesystem',
  root: storageRoot,
  publicBaseUrl: backendUrl,
  signingKey: Buffer.alloc(32, 1),
  uploadMaxBytes: 100_000_000,
  uploadUrlTtlSeconds: 300,
  downloadUrlTtlSeconds: 300,
})

let fixture: Awaited<ReturnType<typeof seedFeed>>

test.describe.serial('T07 live feed', () => {
  test.beforeAll(async () => {
    fixture = await seedFeed()
  })

  test.afterAll(async () => {
    if (!fixture) {
      await prisma.$disconnect()
      return
    }
    await prisma.telegramVideoDelivery.deleteMany({ where: { familyId: fixture.familyId } })
    await prisma.telegramVideoReference.deleteMany({ where: { familyId: fixture.familyId } })
    await prisma.telegramSource.deleteMany({ where: { familyId: fixture.familyId } })
    await prisma.telegramInbox.deleteMany({ where: { botId: fixture.botId } })
    await prisma.family.delete({ where: { id: fixture.familyId } })
    await prisma.externalIdentity.deleteMany({ where: { userId: fixture.userId } })
    await prisma.authSession.deleteMany({ where: { userId: fixture.userId } })
    await prisma.user.delete({ where: { id: fixture.userId } })
    await prisma.user.delete({ where: { id: fixture.ownerUserId } })
    await Promise.all(fixture.objectKeys.map((key) => storage.deleteObject(key)))
    await prisma.$disconnect()
  })

  test.beforeEach(async ({ page }, testInfo) => {
    const initData = signedInitData(Number(subject), 'Лента E2E')
    const responsiveWidth = testInfo.title.match(/feed is usable at (\d+)px$/)?.[1]
    if (testInfo.title === 'renders intrinsic photo and MAX video ratios and opens the memoLy bot') {
      await installMaxHost(page, initData)
      await installMaxAuthRoute(page)
    } else {
      await installTelegramHost(page, initData, responsiveWidth ? { bottom: 18, top: 24 } : undefined)
    }
    if (responsiveWidth) await page.setViewportSize({ width: Number(responsiveWidth), height: 844 })
    await page.goto('/')
    await expect(page.getByRole('heading', { name: 'Мои семьи' })).toBeVisible()
  })

  for (const width of [320, 390, 430, 480]) {
    test(`feed is usable at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 844 })
      await openFeed(page)
      await page.evaluate(() => document.fonts.ready)
      await expect(page.getByTestId('bottom-navigation')).toBeVisible()
      const metrics = await page.evaluate(() => {
        const navigation = document.querySelector('[data-testid="bottom-navigation"]')
        const feedScroll = document.querySelector('[data-slot="feed-scroll"]')
        const header = document.querySelector('[data-child-header-mode="feed"]')
        if (!navigation || !feedScroll || !header) return null
        const navStyle = getComputedStyle(navigation)
        const scrollStyle = getComputedStyle(feedScroll)
        const navRect = navigation.getBoundingClientRect()
        return {
          clientWidth: document.documentElement.clientWidth,
          headerTop: header.getBoundingClientRect().top,
          scrollWidth: document.documentElement.scrollWidth,
          navBottom: navRect.bottom,
          navPaddingBottom: Number.parseFloat(navStyle.paddingBottom),
          navLeft: navRect.left,
          navWidth: navRect.width,
          scrollPaddingBottom: Number.parseFloat(scrollStyle.paddingBottom),
          viewportHeight: window.innerHeight,
        }
      })
      const filterMetrics = await page.locator('[data-slot="memoly-filter-rail"] .filter').evaluateAll((buttons) => buttons.map((button) => {
        const label = button.querySelector<HTMLElement>(':scope > span')
        if (!label) return { clipped: true, inBounds: false, text: '' }
        const buttonRect = button.getBoundingClientRect()
        const labelRect = label.getBoundingClientRect()
        return {
          clipped: label.scrollWidth > label.clientWidth + 1,
          inBounds: labelRect.left >= buttonRect.left && labelRect.right <= buttonRect.right,
          text: label.textContent ?? '',
        }
      }))

      expect(metrics).not.toBeNull()
      expect(metrics!.clientWidth).toBe(width)
      expect(metrics!.scrollWidth).toBeLessThanOrEqual(width)
      expect(metrics!.headerTop).toBeGreaterThanOrEqual(24)
      expect(metrics!.navWidth).toBe(width - 20)
      expect(metrics!.navLeft).toBe(10)
      expect(metrics!.navBottom).toBe(metrics!.viewportHeight)
      expect(metrics!.navPaddingBottom).toBe(18)
      expect(metrics!.scrollPaddingBottom).toBeGreaterThan(16)
      expect(filterMetrics).toHaveLength(5)
      expect(filterMetrics.map((filter) => filter.text)).toEqual(['Все', 'Фото', 'Видео', 'Голос', 'Заметки'])
      expect(filterMetrics.every((filter) => !filter.clipped && filter.inBounds), JSON.stringify(filterMetrics)).toBe(true)
      if (width === 320) {
        const rail = page.locator('[data-slot="memoly-filter-rail"]')
        const scrollable = await rail.evaluate((element) => element.scrollWidth > element.clientWidth)
        expect(scrollable).toBe(false)
        const railRight = await rail.evaluate((element) => element.getBoundingClientRect().right)
        const lastFilterRight = await page.getByRole('button', { name: 'Заметки' }).evaluate((element) => element.getBoundingClientRect().right)
        expect(lastFilterRight).toBeLessThanOrEqual(railRight)
        await page.getByRole('button', { name: 'Заметки' }).focus()
        await expect(page.getByRole('button', { name: 'Заметки' })).toBeFocused()
      }
      await page.screenshot({ path: resolve(`e2e/.artifacts/task-5-feed-${width}.png`), fullPage: true })
    })
  }

  test('memory like stays lightweight and accessible across phone sizes and themes', async ({ page }) => {
    await openFeed(page)
    const card = page.locator('[data-memory-kind="photo"]').filter({ hasText: 'Фотоальбом E2E' })
    const like = card.getByRole('button', { name: 'Поставить сердечко' })

    for (const [width, height] of [[320, 568], [390, 844], [430, 932]]) {
      await page.setViewportSize({ width, height })
      await like.scrollIntoViewIfNeeded()
      const geometry = await like.evaluate((button) => {
        const rect = button.getBoundingClientRect()
        const icon = button.querySelector('[data-slot="webp-icon"]')!.getBoundingClientRect()
        const style = getComputedStyle(button)
        return { width: rect.width, height: rect.height, iconWidth: icon.width, iconHeight: icon.height, background: style.backgroundImage, shadow: style.boxShadow }
      })
      expect(geometry.width).toBeGreaterThanOrEqual(44)
      expect(geometry.height).toBeGreaterThanOrEqual(44)
      expect(geometry.iconWidth).toBe(24)
      expect(geometry.iconHeight).toBe(24)
      expect(geometry.background).toBe('none')
      expect(geometry.shadow).toBe('none')
      await page.screenshot({ path: resolve(`e2e/.artifacts/memory-like-${width}x${height}.png`), animations: 'disabled' })
    }

    await page.setViewportSize({ width: 390, height: 844 })
    await expect(like).toHaveAttribute('aria-pressed', 'false')
    await expect(like).toHaveText('')
    await like.focus()
    await page.keyboard.press('Tab')
    await page.keyboard.press('Shift+Tab')
    await expect(like).toBeFocused()
    await expect(like).toHaveCSS('outline-style', 'solid')
    await like.hover()
    await expect(like).not.toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')
    await like.click()
    const unlike = card.getByRole('button', { name: 'Убрать сердечко' })
    await expect(unlike).toHaveAttribute('aria-pressed', 'true')
    await expect(unlike).toContainText('1')
    await unlike.evaluate((button) => (button as HTMLElement).blur())
    await page.mouse.move(0, 0)
    await page.screenshot({ path: resolve('e2e/.artifacts/memory-like-liked-count-390.png'), animations: 'disabled' })

    for (const theme of ['mint', 'rose', 'sky', 'lavender', 'apricot', 'sand']) {
      await page.evaluate((name) => {
        document.documentElement.setAttribute('data-memoly-theme', name)
        document.querySelector('.memoly-app-root')?.setAttribute('data-memoly-theme', name)
      }, theme)
      await expect(unlike).toHaveCSS('box-shadow', 'none')
      await expect(unlike).toHaveCSS('background-image', 'none')
      const colors = await unlike.evaluate((button) => {
        const icon = button.querySelector<HTMLElement>('[data-slot="webp-icon"]')!
        const token = getComputedStyle(document.documentElement).getPropertyValue('--theme-accent-text').trim()
        const hex = Number.parseInt(token.slice(1), 16)
        return {
          button: getComputedStyle(button).color,
          icon: getComputedStyle(icon).backgroundColor,
          mask: getComputedStyle(icon).maskImage,
          expected: `rgb(${(hex >> 16) & 255}, ${(hex >> 8) & 255}, ${hex & 255})`,
          tag: icon.tagName,
        }
      })
      expect(colors.button).toBe(colors.expected)
      expect(colors.icon).toBe(colors.expected)
      expect(colors.mask).not.toBe('none')
      expect(colors.tag).toBe('SPAN')
      await page.screenshot({ path: resolve(`e2e/.artifacts/memory-like-liked-${theme}-390.png`), animations: 'disabled' })
    }
    await unlike.click()
    await expect(like).toHaveAttribute('aria-pressed', 'false')
    await expect(like).toHaveText('')
  })

  for (const theme of ['mint', 'rose', 'sky', 'lavender', 'apricot', 'sand']) {
    test(`feed renders the ${theme} theme at 390px`, async ({ page }) => {
      await page.setViewportSize({ width: 390, height: 844 })
      await selectTheme(page, theme)
      await openFeed(page)
      await expect(page.locator('[data-slot="memoly-theme-root"]')).toHaveAttribute('data-memoly-theme', theme)
      await expect(page.locator('[data-slot="memoly-filter-rail"] .filter')).toHaveCount(5)
      const navColors = await page.locator('[data-testid="bottom-navigation"]').evaluate((nav) => {
        const item = nav.querySelector('[data-nav-position="home"]')
        const icon = item?.querySelector('[data-slot="webp-icon"]')
        return item && icon ? {
          foreground: getComputedStyle(item).color,
          icon: getComputedStyle(icon).backgroundColor,
          mask: getComputedStyle(icon).maskImage,
        } : null
      })
      expect(navColors).not.toBeNull()
      expect(navColors!.icon).toBe(navColors!.foreground)
      expect(navColors!.mask).toContain('home-active')
      await page.screenshot({ path: resolve(`e2e/.artifacts/agent-b-feed-${theme}-390.png`), animations: 'disabled' })
    })
  }

  test('private feed images survive three Feed → Family → Feed remounts', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await openFeed(page)
    const photo = page.locator('[data-memory-id]').filter({ hasText: 'Одиночное фото E2E' }).getByRole('img', { name: 'Воспоминание' })
    const photoFrame = page.locator('[data-memory-id]').filter({ hasText: 'Одиночное фото E2E' }).locator('.media-well .ml-media-button')
    const videoPoster = page.locator('[data-memory-id]').filter({ hasText: 'Telegram video E2E' }).getByRole('img', { name: 'Кадр видео' })
    await expect(photo).toHaveAttribute('src', /^blob:/)
    await expect.poll(() => photo.evaluate((image) => (image as HTMLImageElement).naturalWidth)).toBeGreaterThan(0)
    await expect(photoFrame).toHaveCSS('overflow', 'hidden')
    await expect(photoFrame).toHaveCSS('border-radius', '19px')
    await expect(videoPoster).toHaveAttribute('src', /^blob:/)
    await expect.poll(() => videoPoster.evaluate((image) => (image as HTMLImageElement).naturalWidth)).toBeGreaterThan(0)

    for (let transition = 0; transition < 3; transition += 1) {
      await page.getByRole('button', { name: 'Семья', exact: true }).click()
      await expect(page.locator('[data-slot="family-presentation"]')).toBeVisible()
      await page.getByRole('button', { name: 'Лента', exact: true }).click()
      await expect(photo).toHaveAttribute('src', /^blob:/)
      await expect.poll(() => photo.evaluate((image) => (image as HTMLImageElement).naturalWidth)).toBeGreaterThan(0)
      await expect(photoFrame).toHaveCSS('border-radius', '19px')
      await expect(videoPoster).toHaveAttribute('src', /^blob:/)
      await expect.poll(() => videoPoster.evaluate((image) => (image as HTMLImageElement).naturalWidth)).toBeGreaterThan(0)
    }
  })

  test('feed shows square, landscape, and portrait photos without cropping', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    const photos = [
      { body: 'Квадратное фото E2E', width: 360, height: 360, color: 'red' },
      { body: 'Горизонтальное фото E2E', width: 640, height: 360, color: 'teal' },
      { body: 'Вертикальное фото E2E', width: 360, height: 640, color: 'orange' },
    ].map((photo) => ({
      ...photo,
      memoryId: randomUUID(),
      mediaId: randomUUID(),
      bytes: generatedMedia(['-f', 'lavfi', '-i', `color=c=${photo.color}:s=${photo.width}x${photo.height}:d=0.1`, '-frames:v', '1', '-c:v', 'png', '-f', 'image2pipe', 'pipe:1']),
    }))
    const photoByMediaId = new Map(photos.map((photo) => [photo.mediaId, photo]))

    await page.route(/\/api\/v1\/families\/[^/]+\/media\/[^/]+\/content\?variant=display/, async (route) => {
      const mediaId = new URL(route.request().url()).pathname.split('/').at(-2)
      const photo = mediaId ? photoByMediaId.get(mediaId) : undefined
      if (!photo) return route.continue()
      await route.fulfill({ body: photo.bytes, contentType: 'image/png' })
    })
    await page.route('**/api/v1/families/*/memories**', async (route) => {
      if (route.request().method() !== 'GET') return route.continue()
      const response = await route.fetch()
      const payload = await response.json() as { items: E2EMemoryFixture[]; nextCursor: string | null }
      const template = payload.items.find((item) => item.attachments.some((attachment) => attachment.kind === 'photo' && attachment.source === 'private_storage'))
      if (!template) return route.fulfill({ response, body: JSON.stringify(payload) })
      payload.items = [...photos.map((photo, index) => ({
        ...template,
        id: photo.memoryId,
        body: photo.body,
        occurredAt: new Date(Date.now() - index * 1_000).toISOString(),
        attachments: [{
          ...template.attachments[0],
          id: photo.mediaId,
          width: photo.width,
          height: photo.height,
          displayPath: `/api/v1/families/${template.familyId}/media/${photo.mediaId}/content?variant=display`,
        }],
      })), ...payload.items]
      await route.fulfill({ response, body: JSON.stringify(payload) })
    })

    await page.reload()
    await openFeed(page)
    for (const photo of photos) {
      const card = page.locator('[data-memory-id]').filter({ hasText: photo.body })
      const image = card.getByRole('img', { name: 'Воспоминание' })
      const frame = card.getByRole('button', { name: 'Открыть фото' })
      await frame.scrollIntoViewIfNeeded()
      await expect(image).toBeVisible()
      await expect.poll(() => image.evaluate((element) => (element as HTMLImageElement).naturalWidth)).toBe(photo.width)
      await expect.poll(() => image.evaluate((element) => (element as HTMLImageElement).naturalHeight)).toBe(photo.height)
      await expect(frame).toHaveCSS('overflow', 'hidden')
      await expect(frame).toHaveCSS('border-radius', '19px')
      const geometry = await image.evaluate((element) => {
        const imageRect = element.getBoundingClientRect()
        const frameRect = element.closest('.ml-media-button')!.getBoundingClientRect()
        const wellRect = element.closest('.media-well')!.getBoundingClientRect()
        const actionsRect = element.closest('.memory-card')!.querySelector('.actions')!.getBoundingClientRect()
        return {
          imageWidth: imageRect.width, imageHeight: imageRect.height,
          frameWidth: frameRect.width, frameHeight: frameRect.height,
          imageTop: imageRect.top, imageBottom: imageRect.bottom,
          frameTop: frameRect.top, frameBottom: frameRect.bottom,
          wellBottom: wellRect.bottom, actionsTop: actionsRect.top,
          pageWidth: document.documentElement.scrollWidth, viewportWidth: window.innerWidth,
          objectFit: getComputedStyle(element).objectFit,
        }
      })
      expect(geometry.imageWidth / geometry.imageHeight).toBeCloseTo(photo.width / photo.height, 2)
      expect(Math.abs(geometry.imageWidth - geometry.frameWidth)).toBeLessThan(2)
      expect(Math.abs(geometry.imageHeight - geometry.frameHeight)).toBeLessThan(2)
      expect(geometry.imageTop).toBeGreaterThanOrEqual(geometry.frameTop - 1)
      expect(geometry.imageBottom).toBeLessThanOrEqual(geometry.frameBottom + 1)
      expect(geometry.wellBottom).toBeLessThanOrEqual(geometry.actionsTop + 1)
      expect(geometry.pageWidth).toBeLessThanOrEqual(geometry.viewportWidth + 1)
      expect(geometry.objectFit).not.toBe('cover')
    }
    await page.screenshot({ path: resolve('e2e/.artifacts/feed-photo-no-crop.png'), fullPage: true })
    await page.locator('[data-memory-id]').filter({ hasText: 'Вертикальное фото E2E' }).getByRole('button', { name: 'Открыть фото' }).click()
    await expect(page.locator('.pswp__zoom-wrap > img')).toBeVisible()
    await page.locator('.pswp__button--close').click()
  })

  test('keeps card video overlays below navigation while fullscreen media covers it', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await openFeed(page)
    const layers = await page.evaluate(() => {
      const navigation = document.querySelector('[data-testid="bottom-navigation"]')
      const overlay = document.querySelector('[data-slot="telegram-video-play-control"]')
      if (!navigation || !overlay) return null
      return {
        navigationPosition: getComputedStyle(navigation).position,
        navigationZIndex: Number.parseInt(getComputedStyle(navigation).zIndex, 10),
        overlayZIndex: Number.parseInt(getComputedStyle(overlay).zIndex, 10),
      }
    })

    expect(layers).not.toBeNull()
    expect(layers!.navigationPosition).toBe('fixed')
    expect(layers!.navigationZIndex).toBeGreaterThan(layers!.overlayZIndex)

    const opener = page.locator('[data-memory-id]').filter({ hasText: 'Фотоальбом E2E' }).getByRole('button', { name: 'Открыть фото' }).first()
    await opener.scrollIntoViewIfNeeded()
    await opener.click()
    await expect(page.locator('.pswp')).toBeVisible()
    const fullscreenZIndex = await page.locator('.pswp').evaluate((element) => Number.parseInt(getComputedStyle(element).zIndex, 10))
    expect(fullscreenZIndex).toBeGreaterThan(layers!.navigationZIndex)
    await page.locator('.pswp__button--close').click()
  })

  test('renders intrinsic photo and MAX video ratios and opens the memoLy bot', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    const maxVideos = [
      { body: 'MAX portrait video UX E2E', width: null, height: 720, decodedWidth: 720, decodedHeight: 1_280, bytes: generatedMedia(['-f', 'lavfi', '-i', 'color=c=orange:s=720x1280:d=2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-movflags', 'frag_keyframe+empty_moov', '-f', 'mp4', 'pipe:1']) },
      { body: 'MAX landscape video UX E2E', width: 1_280, height: 720, decodedWidth: 1_280, decodedHeight: 720, bytes: generatedMedia(['-f', 'lavfi', '-i', 'color=c=teal:s=1280x720:d=2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-movflags', 'frag_keyframe+empty_moov', '-f', 'mp4', 'pipe:1']) },
      { body: 'MAX square video UX E2E', width: 900, height: 900, decodedWidth: 900, decodedHeight: 900, bytes: generatedMedia(['-f', 'lavfi', '-i', 'color=c=purple:s=900x900:d=2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-movflags', 'frag_keyframe+empty_moov', '-f', 'mp4', 'pipe:1']) },
    ].map((video) => ({ ...video, id: randomUUID() }))
    const maxVideoById = new Map(maxVideos.map((video) => [video.id, video.bytes]))
    const maxVideoLikedByMe = new Map(maxVideos.map((video) => [video.id, false]))
    const maxVideoRequests: string[] = []

    page.on('request', (request) => {
      const url = request.url()
      if (url.includes('/media/max-videos/') && url.endsWith('/content')) maxVideoRequests.push(url)
    })

    await page.route('**/api/v1/families/*/media/max-videos/*/content', async (route) => {
      const segments = new URL(route.request().url()).pathname.split('/')
      const referenceId = segments[segments.length - 2]
      const bytes = referenceId ? maxVideoById.get(referenceId) : undefined
      if (!bytes) return route.continue()
      await route.fulfill({ body: bytes, contentType: 'video/mp4', headers: { 'accept-ranges': 'bytes' } })
    })
    await page.route('**/api/v1/families/*/memories**', async (route) => {
      const requestUrl = new URL(route.request().url())
      if (requestUrl.searchParams.has('cursor')) return route.continue()
      const response = await route.fetch()
      const payload = await response.json() as { items: E2EMemoryFixture[]; nextCursor: string | null }
      const first = payload.items[0]
      if (!first) return route.fulfill({ response, body: JSON.stringify(payload) })
      const now = new Date().toISOString()
      payload.items = [
        ...maxVideos.map((video) => ({
          ...first,
          id: video.id,
          kind: 'video',
          body: video.body,
          occurredAt: now,
          createdAt: now,
          likes: { count: maxVideoLikedByMe.get(video.id) ? 1 : 0, likedByMe: maxVideoLikedByMe.get(video.id) ?? false },
          attachments: [{
            id: randomUUID(), source: 'max', kind: 'video', width: video.width, height: video.height,
            durationMs: 2_000, playbackPath: `/api/v1/families/${first.familyId}/media/max-videos/${video.id}/content`,
          }],
        })),
        ...payload.items.map((item) => {
          if (item.body === 'Фотоальбом E2E') {
            return { ...item, attachments: item.attachments.map((attachment, index) => {
              const changed = index === 0 ? { ...attachment, width: 360, height: 640 } : { ...attachment, width: 640, height: 360 }
              return changed
            }) }
          }
          if (item.body === 'Одиночное фото E2E') {
            return { ...item, attachments: item.attachments.map((attachment) => {
              const changed = { ...attachment, width: 500, height: 500 }
              return changed
            }) }
          }
          return item
        }),
      ]
      await route.fulfill({ response, body: JSON.stringify(payload) })
    })
    await page.route('**/api/v1/families/*/memories/*/like', async (route) => {
      const segments = new URL(route.request().url()).pathname.split('/')
      const targetId = segments[segments.length - 2]
      if (!targetId || !maxVideoLikedByMe.has(targetId)) return route.continue()
      const payload = route.request().postDataJSON() as { liked?: unknown }
      if (typeof payload.liked !== 'boolean') return route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ error: { code: 'INVALID_REQUEST' } }) })
      maxVideoLikedByMe.set(targetId, payload.liked)
      await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ count: payload.liked ? 1 : 0, likedByMe: payload.liked }) })
    })

    // Keep this browser-only provider fixture on the page request path so Playwright can
    // deterministically serve the synthetic MP4; the production service worker remains covered
    // by the existing private-media E2E cases.
    await page.evaluate(async () => {
      await Promise.all((await navigator.serviceWorker?.getRegistrations() ?? []).map((registration) => registration.unregister()))
    })
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'serviceWorker', { configurable: true, get: () => undefined })
    })
    await page.addInitScript(() => {
      const originalLoad = HTMLMediaElement.prototype.load
      const sourceDescriptor = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'src')
      let explicitLoadCalls = 0
      let maxVideoSourceAssignments = 0
      HTMLMediaElement.prototype.load = function () {
        if (this.getAttribute('src')?.includes('/media/max-videos/')) explicitLoadCalls += 1
        return originalLoad.call(this)
      }
      if (sourceDescriptor?.get && sourceDescriptor.set) {
        Object.defineProperty(HTMLMediaElement.prototype, 'src', {
          configurable: sourceDescriptor.configurable,
          enumerable: sourceDescriptor.enumerable,
          get: sourceDescriptor.get,
          set(value: string) {
            if (this instanceof HTMLVideoElement && value.includes('/media/max-videos/')) maxVideoSourceAssignments += 1
            sourceDescriptor.set!.call(this, value)
          },
        })
      }
      Object.defineProperties(window, {
        __maxVideoExplicitLoadCalls: { configurable: true, get: () => explicitLoadCalls },
        __maxVideoSourceAssignments: { configurable: true, get: () => maxVideoSourceAssignments },
      })
    })
    await page.reload()
    await openFeed(page)
    const ratios = [
      ['Фотоальбом E2E', 'img', 1],
      ['Одиночное фото E2E', 'img', 1],
      ...maxVideos.map((video) => [video.body, 'video', video.decodedWidth / video.decodedHeight] as const),
    ] as const
    for (const [body, element, expected] of ratios) {
      const card = page.locator('[data-memory-id]').filter({ hasText: body })
      await expect(card).toBeVisible()
      const media = element === 'img'
        ? card.locator('[data-slot="memoly-photo-layout"] img').first()
        : card.locator('video').first()
      await expect(media).toBeVisible()
      const actual = await media.evaluate((entry) => {
        const rect = entry.getBoundingClientRect()
        return { ratio: rect.width / rect.height, objectFit: getComputedStyle(entry).objectFit }
      })
      expect(actual.ratio).toBeCloseTo(expected, 2)
      if (element === 'img') expect(actual.objectFit).not.toBe('cover')
      else expect(actual.objectFit).toBe('contain')
    }

    await page.screenshot({ path: resolve('e2e/.artifacts/t07-feed-media-ux.png'), fullPage: true })
    const albumOpener = page.locator('[data-memory-id]').filter({ hasText: 'Фотоальбом E2E' }).getByRole('button', { name: 'Открыть фото' })
    await albumOpener.click()
    const fullscreenPhoto = page.locator('.pswp__zoom-wrap > img').first()
    await expect(fullscreenPhoto).toBeVisible()
    const fullscreenRatio = await fullscreenPhoto.evaluate((entry) => {
      const rect = entry.getBoundingClientRect()
      return rect.width / rect.height
    })
    expect(fullscreenRatio).toBeCloseTo(360 / 640, 2)
    await page.screenshot({ path: resolve('e2e/.artifacts/t07-feed-media-ux-fullscreen.png') })
    await page.locator('.pswp__button--close').click()

    const maxVideoCard = page.locator('[data-memory-id]').filter({ hasText: maxVideos[0]!.body })
    const maxVideo = maxVideoCard.locator('video').first()
    await expect(maxVideo).toHaveAttribute('preload', 'metadata')
    await expect(maxVideo).toHaveAttribute('src', /\/media\/max-videos\/[^#]+\/content$/)
    expect(await maxVideo.evaluate((entry) => entry.src.includes('#'))).toBe(false)
    await expect.poll(() => page.evaluate(() => (window as typeof window & { __maxVideoExplicitLoadCalls?: number }).__maxVideoExplicitLoadCalls ?? 0)).toBe(maxVideos.length)
    expect(await page.evaluate(() => (window as typeof window & { __maxVideoSourceAssignments?: number }).__maxVideoSourceAssignments ?? 0)).toBe(maxVideos.length)
    await expect.poll(() => maxVideo.evaluate((entry) => entry.readyState)).toBeGreaterThanOrEqual(2)
    expect(maxVideoRequests.length).toBeGreaterThan(0)
    expect(maxVideoRequests.every((url) => !url.includes('#'))).toBe(true)
    const previewPixel = await maxVideo.evaluate((entry) => {
      const canvas = document.createElement('canvas')
      canvas.width = 1
      canvas.height = 1
      const context = canvas.getContext('2d')
      if (!context) return null
      context.drawImage(entry, 0, 0, 1, 1)
      return [...context.getImageData(0, 0, 1, 1).data]
    })
    expect(previewPixel).not.toBeNull()
    expect(previewPixel!.slice(0, 3)).not.toEqual([0, 0, 0])
    await expect(maxVideo).toHaveAttribute('controls', '')
    await expect(maxVideo).toHaveAttribute('playsinline', '')
    await expect.poll(() => maxVideo.evaluate((entry) => entry.paused)).toBe(true)
    expect(await maxVideo.evaluate((entry) => entry.muted)).toBe(false)
    await expect(maxVideoCard.getByRole('button', { name: 'Открыть', exact: true })).toHaveCount(0)
    await expect(maxVideoCard.getByRole('button', { name: 'Действия с воспоминанием' })).toHaveCount(1)
    const like = maxVideoCard.getByRole('button', { name: 'Поставить сердечко' })
    await like.click()
    await expect(maxVideoCard.getByRole('button', { name: 'Убрать сердечко' })).toHaveAttribute('aria-pressed', 'true')
    await expect.poll(() => maxVideo.evaluate((entry) => entry.paused)).toBe(true)
    await page.setViewportSize({ width: 390, height: 844 })
    await maxVideoCard.getByRole('button', { name: 'Действия с воспоминанием' }).click()
    await expect.poll(() => maxVideo.evaluate((entry) => entry.paused)).toBe(true)
    await page.getByRole('button', { name: 'Подробнее' }).click()
    await expect(page.getByRole('dialog')).toContainText(maxVideos[0]!.body)
    await expect.poll(() => page.evaluate(() => Boolean(document.querySelector('[role="dialog"]')?.contains(document.activeElement)))).toBe(true)
    await page.screenshot({ path: resolve('e2e/.artifacts/full-ui-detail-390.png'), animations: 'disabled' })
    await page.getByRole('dialog').getByRole('button', { name: 'Закрыть' }).click()
    await expect(maxVideoCard.getByRole('button', { name: 'Действия с воспоминанием' })).toBeFocused()
    await maxVideoCard.getByRole('button', { name: 'Смотреть видео' }).click()
    await expect.poll(() => maxVideo.evaluate((entry) => entry.paused)).toBe(false)
    expect(await page.evaluate(() => (window as typeof window & { __openedMaxLink?: string }).__openedMaxLink)).toBeUndefined()
    await maxVideoCard.getByRole('button', { name: 'Открыть в MAX' }).click()
    await expect.poll(() => page.evaluate(() => (window as typeof window & { __openedMaxLink?: string }).__openedMaxLink)).toBe('https://max.ru/memoLy')
  })

  test('keeps page one through a next-page failure, retries, and deduplicates 40+ memories', async ({ page }) => {
    let failedOnce = false
    let blockCursor = true
    await page.route('**/api/v1/families/*/memories**', async (route) => {
      const url = new URL(route.request().url())
      if (blockCursor && url.searchParams.has('cursor')) {
        failedOnce = true
        await route.fulfill({
          status: 503,
          contentType: 'application/json',
          body: JSON.stringify({ error: { code: 'UNAVAILABLE', message: 'Synthetic page failure' } }),
        })
        return
      }
      await route.continue()
    })

    await openFeed(page)
    await page.getByTestId('feed-load-more-sentinel').scrollIntoViewIfNeeded()
    await expect.poll(() => failedOnce).toBe(true)
    await expect(page.getByText('Фотоальбом E2E')).toBeVisible()
    await expect(page.getByRole('alert').filter({ hasText: 'Не удалось загрузить ещё' })).toBeVisible()
    blockCursor = false
    await page.getByRole('button', { name: 'Повторить' }).click()
    await expect(page.getByText('Заметка E2E 20')).toBeVisible()
    await page.getByTestId('feed-load-more-sentinel').scrollIntoViewIfNeeded()
    await expect(page.getByText('Заметка E2E 42')).toBeVisible()

    const cards = page.locator('[data-memory-id]')
    await expect(cards).toHaveCount(fixture.memoryCount)
    const ids = await cards.evaluateAll((entries) => entries.map((entry) => entry.getAttribute('data-memory-id')))
    expect(new Set(ids).size).toBe(ids.length)
    await page.screenshot({ path: resolve('e2e/.artifacts/t07-feed.png'), fullPage: true })
  })

  test('rolls back a failed like without losing the memory', async ({ page }) => {
    await openFeed(page)
    await expect(page.getByRole('navigation', { name: 'Основная навигация' })).toContainText('Просмотр')
    await expect(page.getByRole('button', { name: 'Добавить' })).toHaveCount(0)
    await page.route('**/api/v1/families/*/memories/*/like', (route) => route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({ error: { code: 'UNAVAILABLE', message: 'Synthetic like failure' } }),
    }))
    const albumCard = page.locator('[data-memory-id]').filter({ hasText: 'Фотоальбом E2E' })
    await expect(albumCard.getByRole('button', { name: /сердечко/i })).toBeEnabled()
    await expect(albumCard.getByRole('button', { name: 'Действия с воспоминанием' })).toHaveCount(1)
    const like = albumCard.getByRole('button', { name: /сердечко/i })
    await like.click()
    await expect(like).toHaveAttribute('aria-pressed', 'false')
    await expect(albumCard).toContainText('Фотоальбом E2E')
  })

  test('opens the approved Add sheet with three horizontal options across mobile viewports', async ({ page }) => {
    await prisma.familyMember.update({
      where: { familyId_userId: { familyId: fixture.familyId, userId: fixture.userId } },
      data: { role: 'full' },
    })

    try {
      for (const width of [320, 390, 430, 480]) {
        await page.setViewportSize({ width, height: 844 })
        await page.goto('/')
        await expect(page.getByRole('button', { name: 'Лента' })).toBeVisible()
        await openFeed(page)
        await page.getByRole('button', { name: 'Добавить', exact: true }).click()

        const panel = page.locator('[data-slot="memoly-add-sheet-panel"]')
        await expect(panel).toBeVisible()
        await expect(page.locator('[data-slot="memoly-bottom-sheet-handle"]')).toHaveCount(1)
        await expect(page.locator('[data-slot="drawer-handle"]')).toHaveCount(0)
        await expect(panel.getByRole('heading', { name: 'Добавить воспоминание', exact: true })).toBeVisible()
        await expect(panel.getByText('Сохраняйте моменты, которые важны', { exact: true })).toBeVisible()

        const options = panel.locator('[data-add-action]')
        await expect(options).toHaveCount(3)
        await expect(options.nth(0)).toHaveAttribute('data-add-action', 'photo')
        await expect(options.nth(0)).toHaveAccessibleName('Добавить фото')
        await expect(options.nth(1)).toHaveAttribute('data-add-action', 'note')
        await expect(options.nth(1)).toHaveAccessibleName('Добавить заметку')
        await expect(options.nth(2)).toHaveAttribute('data-add-action', 'voice-or-video')
        await expect(options.nth(2)).toHaveAccessibleName('Добавить голос или видео')
        for (let index = 0; index < 3; index += 1) await expect(options.nth(index)).toBeVisible()
        await page.waitForTimeout(500)

        const geometry = await options.evaluateAll((entries) => {
          const rects = entries.map((entry) => entry.getBoundingClientRect())
          const navigation = document.querySelector('[data-testid="bottom-navigation"]')
          const sheet = document.querySelector('[data-memoly-bottom-sheet="true"]')
          if (!navigation || !sheet) return null
          const navRect = navigation.getBoundingClientRect()
          const sheetRect = sheet.getBoundingClientRect()
          const navStyle = getComputedStyle(navigation)
          return {
            maxRight: Math.max(...rects.map((rect) => rect.right)),
            minLeft: Math.min(...rects.map((rect) => rect.left)),
            minTop: Math.min(...rects.map((rect) => rect.top)),
            maxTop: Math.max(...rects.map((rect) => rect.top)),
            maxBottom: Math.max(...rects.map((rect) => rect.bottom)),
            viewportWidth: window.innerWidth,
            viewportHeight: window.innerHeight,
            documentWidth: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth),
            navTop: navRect.top,
            navBottom: navRect.bottom,
            navPaddingBottom: Number.parseFloat(navStyle.paddingBottom),
            sheetBottom: sheetRect.bottom,
            navCovered: Boolean(document.elementFromPoint(window.innerWidth / 2, window.innerHeight - 40)?.closest('[data-memoly-bottom-sheet="true"]')),
          }
        })
        expect(geometry).not.toBeNull()
        expect(geometry!.minLeft).toBeGreaterThanOrEqual(0)
        expect(geometry!.maxRight).toBeLessThanOrEqual(geometry!.viewportWidth)
        expect(geometry!.maxBottom).toBeLessThanOrEqual(geometry!.viewportHeight - 12)
        expect(geometry!.documentWidth).toBeLessThanOrEqual(geometry!.viewportWidth)
        expect(geometry!.maxTop - geometry!.minTop).toBeLessThanOrEqual(1)
        expect(geometry!.navBottom).toBe(geometry!.viewportHeight)
        expect(geometry!.navTop).toBeLessThan(geometry!.navBottom)
        expect(geometry!.navPaddingBottom).toBeGreaterThanOrEqual(0)
        expect(geometry!.navCovered).toBe(true)
        if (width === 320 || width === 390) {
          const sheetTop = await page.locator('[data-memoly-bottom-sheet="true"]').evaluate((element) => element.getBoundingClientRect().top)
          expect(sheetTop).toBeGreaterThanOrEqual(width === 320 ? 631 : 640)
          expect(sheetTop).toBeLessThanOrEqual(width === 320 ? 637 : 652)
          expect(geometry!.minTop).toBeGreaterThanOrEqual(700)
        }

        await page.screenshot({ path: resolve(`e2e/.artifacts/full-ui-add-${width}.png`), animations: 'disabled' })
        await page.keyboard.press('Escape')
        await expect(panel).toHaveCount(0)
      }
      await page.setViewportSize({ width: 390, height: 844 })
      await page.getByRole('button', { name: 'Добавить', exact: true }).click()
      await page.waitForTimeout(500)
      for (const theme of ['mint', 'rose', 'sky', 'lavender', 'apricot', 'sand']) {
        await page.locator('html').evaluate((html, value) => html.setAttribute('data-memoly-theme', value), theme)
        const top = await page.locator('[data-memoly-bottom-sheet="true"]').evaluate((element) => element.getBoundingClientRect().top)
        expect(top).toBeGreaterThanOrEqual(640)
        expect(top).toBeLessThanOrEqual(652)
        await page.screenshot({ path: resolve(`e2e/.artifacts/full-ui-add-${theme}-390.png`), animations: 'disabled' })
      }
      await page.keyboard.press('Escape')
      await expect(page.locator('[data-slot="memoly-add-sheet-panel"]')).toHaveCount(0)
      const addButton = page.getByRole('button', { name: 'Добавить', exact: true })
      await expect(addButton).toBeFocused()
      await addButton.click()
      await expect(page.locator('[data-slot="memoly-add-sheet-panel"]')).toBeVisible()
      const textScale = await page.addStyleTag({ content: `.memoly-add-sheet-panel .sheet-title { font-size: 32px !important; } .memoly-add-sheet-panel .sheet-subtitle { font-size: 22px !important; } .memoly-add-sheet-panel .add-option-title { font-size: 26px !important; } .memoly-add-sheet-panel .add-option-copy { font-size: 20px !important; }` })
      await page.waitForTimeout(500)
      const scaledLayout = await page.locator('[data-memoly-bottom-sheet="true"]').evaluate((element) => {
        const rect = element.getBoundingClientRect()
        return { top: rect.top, right: rect.right, bottom: rect.bottom, scrollWidth: document.documentElement.scrollWidth, viewportWidth: innerWidth }
      })
      expect(scaledLayout.top).toBeGreaterThanOrEqual(0)
      expect(scaledLayout.right).toBeLessThanOrEqual(scaledLayout.viewportWidth)
      expect(scaledLayout.bottom).toBeLessThanOrEqual(844)
      expect(scaledLayout.scrollWidth).toBeLessThanOrEqual(scaledLayout.viewportWidth)
      await page.screenshot({ path: resolve('e2e/.artifacts/full-ui-add-text-200-390.png'), animations: 'disabled' })
      await textScale.evaluate((element) => element.remove())
      await page.getByRole('button', { name: 'Добавить голос или видео' }).click()
      await expect(page.locator('[data-slot="memoly-voice-video-sheet"]')).toBeVisible()
      await page.getByRole('button', { name: 'Назад' }).click()
      await expect(page.locator('[data-slot="memoly-add-sheet-panel"]')).toBeVisible()
      await page.goBack()
      await expect(page.locator('[data-slot="memoly-add-sheet-panel"]')).toHaveCount(0)
      await addButton.click()
      await page.getByRole('button', { name: 'Добавить заметку' }).click()
      await expect(page.getByRole('heading', { name: 'Добавить заметку' })).toBeVisible()
      await page.getByRole('button', { name: 'Назад' }).click()
      await addButton.click()
      await page.getByRole('button', { name: 'Добавить фото' }).click()
      await expect(page.getByRole('heading', { name: 'Добавить фото' })).toBeVisible()
      await page.getByRole('button', { name: 'Назад' }).click()
    } finally {
      await prisma.familyMember.update({
        where: { familyId_userId: { familyId: fixture.familyId, userId: fixture.userId } },
        data: { role: 'viewer' },
      })
    }
  })

  test('keeps delete spotlight and navigation within required mobile viewports', async ({ page }) => {
    await prisma.familyMember.update({
      where: { familyId_userId: { familyId: fixture.familyId, userId: fixture.userId } },
      data: { role: 'full' },
    })

    try {
      await page.reload()
      await openFeed(page)
      const card = page.locator('#root [data-memoly-feed] [data-memory-id]').filter({ hasText: 'Заметка E2E 42' })
      for (let pageIndex = 0; pageIndex < 4 && await card.count() === 0; pageIndex += 1) {
        await page.evaluate(() => window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' }))
        await page.waitForTimeout(250)
      }
      await expect(card).toHaveCount(1)
      const selectedId = await card.getAttribute('data-memory-id')
      expect(selectedId).toBeTruthy()

      for (const width of [320, 390, 430, 480]) {
        await page.setViewportSize({ width, height: 844 })
        await card.scrollIntoViewIfNeeded()
        await card.getByRole('button', { name: 'Действия с воспоминанием' }).click()
        await page.getByRole('button', { name: 'Удалить воспоминание' }).click()

        const spotlight = page.getByRole('alertdialog')
        await expect(spotlight).toContainText('Удалить воспоминание?')
        const selectedCard = page.locator(`[data-memory-id="${selectedId}"]`)
        await expect(selectedCard).toHaveCount(1)
        await expect(selectedCard).toBeVisible()

        const geometry = await spotlight.evaluate((dialog, id) => {
          const dialogRect = dialog.getBoundingClientRect()
          const source = document.querySelector<HTMLElement>(`[data-memory-id="${id}"]`)
          const navigation = document.querySelector('[data-testid="bottom-navigation"]')
          const overlay = document.querySelector<HTMLElement>('.memoly-delete-overlay')
          if (!source || !navigation || !overlay) return null
          const sourceRect = source.getBoundingClientRect()
          const navRect = navigation.getBoundingClientRect()
          const navStyle = getComputedStyle(navigation)
          return {
            dialogLeft: dialogRect.left,
            dialogRight: dialogRect.right,
            dialogTop: dialogRect.top,
            dialogBottom: dialogRect.bottom,
            sourceLeft: sourceRect.left,
            sourceRight: sourceRect.right,
            sourceTop: sourceRect.top,
            sourceBottom: sourceRect.bottom,
            navTop: navRect.top,
            navBottom: navRect.bottom,
            navZIndex: Number.parseInt(navStyle.zIndex, 10),
            overlayZIndex: Number.parseInt(getComputedStyle(overlay).zIndex, 10),
            viewportWidth: window.innerWidth,
            viewportHeight: window.innerHeight,
            documentWidth: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth),
          }
        }, selectedId)
        expect(geometry).not.toBeNull()
        expect(geometry!.dialogLeft).toBeGreaterThanOrEqual(0)
        expect(geometry!.dialogRight).toBeLessThanOrEqual(geometry!.viewportWidth)
        expect(geometry!.dialogTop).toBeGreaterThanOrEqual(0)
        expect(geometry!.dialogBottom).toBeLessThanOrEqual(geometry!.viewportHeight)
        expect(geometry!.sourceLeft).toBeGreaterThanOrEqual(0)
        expect(geometry!.sourceRight).toBeLessThanOrEqual(geometry!.viewportWidth)
        expect(geometry!.sourceBottom).toBeGreaterThan(0)
        expect(geometry!.sourceTop).toBeLessThan(geometry!.viewportHeight)
        expect(geometry!.navBottom).toBe(geometry!.viewportHeight)
        expect(geometry!.navTop).toBeLessThan(geometry!.navBottom)
        expect(geometry!.navZIndex).toBeGreaterThan(geometry!.overlayZIndex)
        expect(geometry!.documentWidth).toBeLessThanOrEqual(geometry!.viewportWidth)

        await page.screenshot({ path: resolve(`e2e/.artifacts/full-ui-delete-${width}.png`), animations: 'disabled' })
        await page.getByRole('button', { name: 'Отмена' }).click()
        await expect(spotlight).toHaveCount(0)
        await expect(selectedCard).toBeVisible()
      }
    } finally {
      await prisma.familyMember.update({
        where: { familyId_userId: { familyId: fixture.familyId, userId: fixture.userId } },
        data: { role: 'viewer' },
      })
    }
  })

  test('offers only truly newer memories and preserves the visible anchor when applying them', async ({ page }) => {
    await openFeed(page)
    const target = page.locator('[data-memory-id]').filter({ hasText: 'Заметка E2E 10' })
    await target.scrollIntoViewIfNeeded()
    const anchorId = await page.locator('[data-memory-id]').evaluateAll((cards) =>
      cards.find((card) => {
        const rect = card.getBoundingClientRect()
        return rect.bottom > 0 && rect.top < window.innerHeight
      })?.getAttribute('data-memory-id'))
    const anchor = page.locator(`[data-memory-id="${anchorId}"]`)

    await prisma.memory.create({ data: {
      familyId: fixture.familyId, childId: fixture.childId, authorId: fixture.ownerUserId,
      kind: 'note', body: 'Старая добавленная запись', occurredAt: new Date(Date.now() - 7 * 24 * 60 * 60_000),
    } })
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')))
    await expect(page.getByRole('button', { name: 'Показать новые' })).toHaveCount(0)

    await prisma.memory.create({ data: {
      familyId: fixture.familyId, childId: fixture.childId, authorId: fixture.ownerUserId,
      kind: 'note', body: 'Совсем новое воспоминание', occurredAt: new Date(),
    } })
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')))
    await expect(page.getByRole('button', { name: 'Показать новые' })).toBeVisible()
    const beforeTop = await anchor.evaluate((element) => element.getBoundingClientRect().top)
    await page.getByRole('button', { name: 'Показать новые' }).click()
    await expect(page.getByText('Совсем новое воспоминание')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Показать новые' })).toHaveCount(0)
    const afterTop = await anchor.evaluate((element) => element.getBoundingClientRect().top)
    expect(Math.abs(afterTop - beforeTop)).toBeLessThanOrEqual(2)
  })

  test('opens a two-photo PhotoSwipe album and restores focus and scroll on close', async ({ page }) => {
    await openFeed(page)
    const singleOpener = page.locator('[data-memory-id]').filter({ hasText: 'Одиночное фото E2E' }).getByRole('button', { name: 'Открыть фото' })
    await singleOpener.scrollIntoViewIfNeeded()
    await installObjectUrlTracker(page)
    await expect.poll(() => telegramBackHandlerCount(page)).toBe(0)
    const singleScroll = await page.evaluate(() => window.scrollY)
    await singleOpener.click()
    await expect(page.locator('.pswp__counter')).toContainText('1 / 1')
    await expect(page.locator('.pswp__zoom-wrap > img')).toBeVisible()
    await expect.poll(() => telegramBackHandlerCount(page)).toBe(1)
    await expect.poll(async () => (await objectUrlSnapshot(page)).created.length).toBe(1)
    await page.locator('.pswp__button--close').click()
    await expect(page.locator('.pswp')).toHaveCount(0)
    await expect(singleOpener).toBeFocused()
    expect(await page.evaluate(() => window.scrollY)).toBe(singleScroll)
    await expect.poll(() => telegramBackHandlerCount(page)).toBe(0)
    await expectObjectUrlsClean(page, 1)

    const opener = page.getByRole('button', { name: 'Открыть фото' }).first()
    await opener.scrollIntoViewIfNeeded()
    const beforeScroll = await page.evaluate(() => window.scrollY)
    await opener.click()
    await expect(page.locator('.pswp')).toBeVisible()
    await expect(page.locator('.pswp__counter')).toContainText('1 / 2')
    await expect.poll(() => telegramBackHandlerCount(page)).toBe(1)
    await expect.poll(async () => (await objectUrlSnapshot(page)).created.length).toBe(3)
    await page.locator('.pswp__button--arrow--next').click()
    await expect(page.locator('.pswp__counter')).toContainText('2 / 2')
    await page.screenshot({ path: resolve('e2e/.artifacts/t07-photoswipe.png') })
    await triggerTelegramBack(page)
    await expect(page.locator('.pswp')).toHaveCount(0)
    await expect(opener).toBeFocused()
    expect(await page.evaluate(() => window.scrollY)).toBe(beforeScroll)
    await expect.poll(() => telegramBackHandlerCount(page)).toBe(0)
    await expectObjectUrlsClean(page, 3)

    await triggerTelegramBack(page)
    await expect(page.locator('.pswp')).toHaveCount(0)
    await expect.poll(() => telegramBackHandlerCount(page)).toBe(0)
    await expect.poll(() => page.evaluate(() => Boolean(window.history.state?.privatePhotoViewer))).toBe(false)

    await opener.click()
    await expect(page.locator('.pswp')).toBeVisible()
    await expect.poll(() => telegramBackHandlerCount(page)).toBe(1)
    await expect.poll(async () => (await objectUrlSnapshot(page)).created.length).toBe(5)
    await page.goBack()
    await expect(page.locator('.pswp')).toHaveCount(0)
    await expect(opener).toBeFocused()
    expect(await page.evaluate(() => window.scrollY)).toBe(beforeScroll)
    await expect.poll(() => telegramBackHandlerCount(page)).toBe(0)
    await expectObjectUrlsClean(page, 5)

    await opener.click()
    await expect(page.locator('.pswp')).toBeVisible()
    await expect.poll(() => telegramBackHandlerCount(page)).toBe(1)
    await expect.poll(async () => (await objectUrlSnapshot(page)).created.length).toBe(7)
    await page.getByRole('button', { name: 'Семья', exact: true }).evaluate((button) => (button as HTMLButtonElement).click())
    await expect(page.locator('.pswp')).toHaveCount(0)
    await expect.poll(() => telegramBackHandlerCount(page)).toBe(0)
    await expectObjectUrlsClean(page, 7)
  })

  test('streams voice and legacy video only after play, seeks with Range/206, and pauses on hide', async ({ page }) => {
    await openFeed(page)
    const responses: Array<{ range: string | null; status: number; url: string }> = []
    page.on('response', (response) => {
      if (!response.url().includes('/media/') || !response.url().includes('variant=playback')) return
      responses.push({
        range: response.request().headers()['range'] ?? null,
        status: response.status(),
        url: response.url(),
      })
    })

    await page.waitForTimeout(500)
    expect(responses).toEqual([])

    const voiceCard = page.locator('[data-memory-id]').filter({ hasText: 'Голос E2E' })
    const voice = voiceCard.locator('audio')
    await expect(voice).toHaveAttribute('src', /^\/api\//)
    await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true)
    await voiceCard.getByRole('button', { name: 'Слушать' }).click()
    await expect.poll(() => responses.some((response) => response.range && response.status === 206)).toBe(true)
    await expect.poll(() => voice.evaluate((element) => !(element as HTMLAudioElement).paused)).toBe(true)

    await page.evaluate(() => {
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => true })
      document.dispatchEvent(new Event('visibilitychange'))
    })
    await expect.poll(() => voice.evaluate((element) => (element as HTMLAudioElement).paused)).toBe(true)
    await page.evaluate(() => {
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => false })
      document.dispatchEvent(new Event('visibilitychange'))
    })
    await expect.poll(() => voice.evaluate((element) => (element as HTMLAudioElement).paused)).toBe(true)

    const videoCard = page.locator('[data-memory-id]').filter({ hasText: 'Legacy video E2E' })
    await videoCard.getByRole('button', { name: 'Смотреть' }).click()
    await expect.poll(() => responses.filter((response) => response.range && response.status === 206).length).toBeGreaterThan(1)
    await videoCard.getByLabel('Позиция видео').fill('2')
    await expect.poll(() => responses.every((response) => response.status === 206)).toBe(true)
  })

  test('opens Telegram-only video through the guarded opaque hand-off', async ({ page }) => {
    await openFeed(page)
    const card = page.locator('[data-memory-id]').filter({ hasText: 'Telegram video E2E' })
    await expect(card.locator('[data-slot="telegram-video-play-control"]')).toHaveCSS('z-index', '10')
    await card.getByRole('button', { name: 'Смотреть видео в Telegram' }).click()
    await expect.poll(() => page.evaluate(() => (window as typeof window & { __openedTelegramLink?: string }).__openedTelegramLink)).toMatch(/^https:\/\/t\.me\/OurMemoriesDevBot\?start=watch_[A-Za-z0-9_-]{32}$/)
    const deepLink = await page.evaluate(() => (window as typeof window & { __openedTelegramLink?: string }).__openedTelegramLink)
    expect(deepLink).not.toContain('synthetic-file-id')
  })

  test('captures memory actions against the canonical sheet at mobile width', async ({ browser, page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await prisma.familyMember.update({
      where: { familyId_userId: { familyId: fixture.familyId, userId: fixture.userId } },
      data: { role: 'full' },
    })
    await page.reload()
    await openFeed(page)
    const card = page.locator('#root [data-memoly-feed] [data-memory-id]').filter({ hasText: 'Фотоальбом E2E' }).first()
    await card.scrollIntoViewIfNeeded()
    await card.getByRole('button', { name: 'Действия с воспоминанием' }).click()
    await expect(page.getByRole('dialog')).toBeVisible()
    await expect(page.locator('[data-slot="memoly-bottom-sheet-handle"]')).toHaveCount(1)
    await expect(page.locator('[data-slot="drawer-handle"]')).toHaveCount(0)
    await expect(page.locator('.memoly-memory-action')).toHaveCount(3)
    for (const label of ['Подробнее', 'Открыть публикацию целиком', 'Редактировать', 'Изменить подпись или дату', 'Удалить воспоминание', 'Удалить из семейной ленты']) {
      await expect(page.locator('.memoly-memory-actions')).toContainText(label)
    }
    await expect(page.locator('.memoly-memory-actions > [data-slot="drawer-title"]')).toHaveClass(/sr-only/)
    await page.screenshot({ path: resolve('e2e/.artifacts/memory-actions-after-390.png'), animations: 'disabled' })

    const canonical = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 })
    const referenceUrl = pathToFileURL(resolve('../docs/memoly-final-functional-state-pack.html')).href
    await canonical.goto(`${referenceUrl}#memoryActions`)
    await expect(canonical.locator('#memoryActions .ml-sheet-row')).toHaveCount(2)
    await expect(canonical.locator('#memoryActions .state-action-row')).toHaveCount(1)
    await canonical.screenshot({ path: resolve('e2e/.artifacts/memory-actions-canonical-390.png'), animations: 'disabled' })
    const sheetGeometry = await Promise.all([
      page.locator('[data-memoly-bottom-sheet="true"]'),
      canonical.locator('#memoryActions .ml-sheet-panel'),
    ].map((sheet) => sheet.evaluate((panel) => {
      const rect = panel.getBoundingClientRect()
      const row = panel.querySelector('.memoly-memory-action, .ml-sheet-row')?.getBoundingClientRect()
      const handle = panel.querySelector('[data-slot="memoly-bottom-sheet-handle"], .ml-sheet-handle')?.getBoundingClientRect()
      return { top: rect.top, height: rect.height, rowTop: row?.top, rowHeight: row?.height, handleTop: handle?.top, handleHeight: handle?.height }
    })))
    for (const key of ['top', 'height', 'rowTop', 'rowHeight', 'handleTop', 'handleHeight'] as const) {
      expect(Math.abs((sheetGeometry[0]![key] ?? 0) - (sheetGeometry[1]![key] ?? 0))).toBeLessThanOrEqual(3)
    }
    const initialTheme = await page.locator('html').getAttribute('data-memoly-theme')
    for (const theme of ['mint', 'rose', 'sky', 'lavender', 'apricot', 'sand']) {
      await page.locator('html').evaluate((html, value) => html.setAttribute('data-memoly-theme', value), theme)
      await page.screenshot({ path: resolve(`e2e/.artifacts/memory-actions-${theme}-390.png`), animations: 'disabled' })
      await canonical.locator(`#theme${theme[0]!.toUpperCase()}${theme.slice(1)}`).evaluate((input: HTMLInputElement) => { input.checked = true; input.dispatchEvent(new Event('change', { bubbles: true })) })
      await canonical.screenshot({ path: resolve(`e2e/.artifacts/memory-actions-canonical-${theme}-390.png`), animations: 'disabled' })
    }
    await canonical.close()
    if (initialTheme) await page.locator('html').evaluate((html, value) => html.setAttribute('data-memoly-theme', value), initialTheme)
    await triggerTelegramBack(page)
    await expect(card.getByRole('button', { name: 'Действия с воспоминанием' })).toBeFocused()
    await prisma.familyMember.update({
      where: { familyId_userId: { familyId: fixture.familyId, userId: fixture.userId } },
      data: { role: 'viewer' },
    })
  })

  test('keeps the exact memory in delete spotlight through cancel, failure, and success', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await prisma.familyMember.update({
      where: { familyId_userId: { familyId: fixture.familyId, userId: fixture.userId } },
      data: { role: 'full' },
    })
    await page.reload()
    await openFeed(page)
    const card = page.locator('#root [data-memoly-feed] [data-memory-id]').filter({ hasText: 'Заметка E2E 42' })
    for (let pageIndex = 0; pageIndex < 4 && await card.count() === 0; pageIndex += 1) {
      await page.evaluate(() => window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' }))
      await page.waitForTimeout(250)
    }
    await card.scrollIntoViewIfNeeded()
    const selectedId = await card.getAttribute('data-memory-id')
    expect(selectedId).toBeTruthy()
    await card.getByRole('button', { name: 'Действия с воспоминанием' }).click()
    await page.getByRole('button', { name: 'Удалить воспоминание' }).click()
    const spotlight = page.getByRole('alertdialog')
    await expect(spotlight).toContainText('Удалить воспоминание?')
    await expect(page.locator(`[data-memory-id="${selectedId}"]`)).toHaveCount(1)
    await expect(card).toBeVisible()
    await page.screenshot({ path: resolve('e2e/.artifacts/full-ui-delete-390.png'), animations: 'disabled' })
    await page.evaluate(() => (window as typeof window & { __triggerTelegramBack?: () => void }).__triggerTelegramBack?.())
    await expect(card).toBeVisible()
    await card.getByRole('button', { name: 'Действия с воспоминанием' }).click()
    await page.getByRole('button', { name: 'Удалить воспоминание' }).click()
    await page.getByRole('button', { name: 'Отмена' }).click()
    await expect(card).toBeVisible()
    await expect(card.getByRole('button', { name: 'Действия с воспоминанием' })).toBeFocused()

    await page.route('**/api/v1/families/*/memories/*', (route) => {
      if (route.request().method() !== 'DELETE') return route.continue()
      return route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ error: { code: 'UNAVAILABLE', message: 'Synthetic delete failure' } }),
      })
    })
    await card.getByRole('button', { name: 'Действия с воспоминанием' }).click()
    await page.getByRole('button', { name: 'Удалить воспоминание' }).click()
    await page.getByRole('button', { name: 'Удалить' }).click()
    await expect(card).toBeVisible()
    await expect(page.locator(`[data-memory-id="${selectedId}"]`)).toHaveCount(1)
    await expect(spotlight.getByRole('alert')).toContainText('Не удалось удалить воспоминание. Попробуйте ещё раз.')
    await page.unroute('**/api/v1/families/*/memories/*')

    await page.getByRole('button', { name: 'Удалить' }).click()
    await expect(card).toHaveCount(0)
    await prisma.familyMember.update({
      where: { familyId_userId: { familyId: fixture.familyId, userId: fixture.userId } },
      data: { role: 'viewer' },
    })
  })

  test('captures loading, empty, error, and retry states at 390px', async ({ page }) => {
    let mode: 'empty' | 'error' = 'empty'
    let releaseLoading!: () => void
    const loading = new Promise<void>((resolveLoading) => { releaseLoading = resolveLoading })
    let loadingReleased = false
    await page.route('**/api/v1/families/*/memories**', async (route) => {
      if (route.request().method() !== 'GET') return route.continue()
      if (!loadingReleased) await loading
      if (mode === 'error') return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: { code: 'UNAVAILABLE', message: 'Synthetic visual failure' } }) })
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ items: [], nextCursor: null }) })
    })
    await page.setViewportSize({ width: 390, height: 844 })
    await page.reload()
    await page.getByRole('button', { name: 'Лента' }).click()
    await expect(page.locator('[data-slot="feed-skeleton"]')).toBeVisible()
    await page.screenshot({ path: resolve('e2e/.artifacts/agent-b-react-loading-390.png'), animations: 'disabled' })
    loadingReleased = true
    releaseLoading()
    await expect(page.locator('[data-slot="feed-empty"]')).toBeVisible()
    await page.screenshot({ path: resolve('e2e/.artifacts/agent-b-react-empty-390.png'), animations: 'disabled' })
    mode = 'error'
    await page.reload()
    await page.getByRole('button', { name: 'Лента' }).click()
    await expect(page.locator('[data-slot="inline-error"]')).toBeVisible()
    await page.screenshot({ path: resolve('e2e/.artifacts/agent-b-react-error-390.png'), animations: 'disabled' })
    mode = 'empty'
    await page.getByRole('button', { name: 'Повторить' }).click()
    await expect(page.locator('[data-slot="feed-empty"]')).toBeVisible()
  })

  test('compares the canonical photo card and filter geometry with deterministic visual data', async ({ page }) => {
    const canonical = readFileSync(resolve('../docs/memoly-final-functional-state-pack.html'))
    expect(createHash('sha256').update(canonical).digest('hex')).toBe('180f8c9b6e60369513cffd5eb9dbb3cb3397649407df996dcf907ab0fa38c5b4')
    const imageBase64 = canonical.toString('utf8').match(/class="media photo" src="data:image\/jpeg;base64,([^"]+)"/)?.[1]
    expect(imageBase64).toBeTruthy()
    const image = Buffer.from(imageBase64!, 'base64')
    const key = `media-display/${randomUUID()}-canonical.jpg`
    fixture.objectKeys.push(key)
    await store(key, image, 'image/jpeg')
    const asset = await createAsset({ familyId: fixture.familyId, userId: fixture.ownerUserId, kind: 'photo', variant: 'display', key, bytes: image, mime: 'image/jpeg', width: 790, height: 450 })
    await prisma.user.update({ where: { id: fixture.ownerUserId }, data: { displayName: 'Мама' } })
    await prisma.child.update({ where: { id: fixture.childId }, data: { displayName: 'София', birthDate: new Date('2024-05-25T00:00:00.000Z') } })
    const body = 'Моё солнышко утром ☀️\nКак же ты любишь своего зайку 🤍'
    const memory = await createMemoryWithMedia({ familyId: fixture.familyId, childId: fixture.childId, userId: fixture.ownerUserId, kind: 'photo', body, occurredAt: new Date(Date.now() + 30_000), assets: [asset] })
    await page.route('**/api/v1/families/*/memories**', async (route) => {
      if (route.request().method() !== 'GET') return route.continue()
      const response = await route.fetch()
      const payload = await response.json() as { items: E2EMemoryFixture[]; nextCursor: string | null }
      payload.items = payload.items.filter((item) => item.id === memory.id).map((item) => ({ ...item, occurredAt: '2026-09-25T07:24:00.000Z' }))
      payload.nextCursor = null
      await route.fulfill({ response, body: JSON.stringify(payload) })
    })
    await page.clock.setFixedTime(new Date('2026-09-25T07:30:00.000Z'))
    await page.reload()
    await page.locator('[data-slot="family-hub"] .family-hub-card').click()
    await expect(page.locator('[data-memoly-feed="true"]')).toBeVisible()
    await expect(page.locator(`[data-memory-id="${memory.id}"]`)).toBeVisible()
    await expect(page.locator(`[data-memory-id="${memory.id}"] .memory-child-tag`)).toHaveCount(0)
    const likeButton = page.locator(`[data-memory-id="${memory.id}"] button[aria-label="Поставить сердечко"]`)
    await expect(likeButton).toBeVisible()
    await expect(likeButton).toHaveAttribute('aria-pressed', 'false')

    const geometry: Record<string, unknown> = {}
    const capture = async (name: string) => {
      await page.evaluate(() => document.fonts.ready)
      await page.locator(`[data-memory-id="${memory.id}"] img`).first().evaluate((image: HTMLImageElement) => image.decode())
      await expect(page.locator('.filters-wrap .filter')).toHaveCount(5)
      const metrics = await page.evaluate(() => {
        const measure = (selector: string) => {
          const element = document.querySelector<HTMLElement>(selector)!
          const rect = element.getBoundingClientRect()
          const css = getComputedStyle(element)
          return { x: rect.x, y: rect.y, w: rect.width, h: rect.height, marginTop: css.marginTop, marginBottom: css.marginBottom, padding: css.padding, gap: css.gap, overflowX: css.overflowX, scrollWidth: element.scrollWidth, clientWidth: element.clientWidth }
        }
        return { header: measure('[data-child-header-mode="feed"]'), app: measure('[data-slot="feed-scroll"]'), filtersWrap: measure('.filters-wrap'), filters: measure('.filters'), chips: [...document.querySelectorAll<HTMLElement>('.filters .filter')].map((item) => ({ text: item.textContent?.trim(), x: item.getBoundingClientRect().x, w: item.getBoundingClientRect().width, h: item.getBoundingClientRect().height })), date: measure('.date-heading'), card: measure('.memory-card'), cardHeader: measure('.memory-card .memory-header'), media: measure('.memory-card .media-well'), caption: measure('.memory-card .caption') }
      })
      geometry[name] = metrics
      await page.screenshot({ path: resolve(`e2e/.artifacts/agent-b-react-comparable-${name}.png`), fullPage: true, animations: 'disabled' })
      await page.locator(`[data-memory-id="${memory.id}"]`).screenshot({ path: resolve(`e2e/.artifacts/agent-b-react-card-${name}.png`), animations: 'disabled' })
    }
    for (const [width, height] of [[320, 568], [390, 844], [430, 932], [480, 844]]) {
      await page.setViewportSize({ width, height })
      await capture(String(width))
    }
    await page.setViewportSize({ width: 390, height: 844 })
    for (const theme of ['mint', 'rose', 'sky', 'lavender', 'apricot', 'sand']) {
      await selectTheme(page, theme)
      await page.getByRole('button', { name: 'Лента' }).click()
      await expect(page.locator(`[data-memory-id="${memory.id}"]`)).toBeVisible()
      await capture(`${theme}-390`)
    }
    await likeButton.click()
    const activeLikeButton = page.locator(`[data-memory-id="${memory.id}"] button[aria-label="Убрать сердечко"]`)
    await expect(activeLikeButton).toHaveAttribute('aria-pressed', 'true')
    await expect(activeLikeButton).toContainText('1')
    await activeLikeButton.click()
    const inactiveLikeButton = page.locator(`[data-memory-id="${memory.id}"] button[aria-label="Поставить сердечко"]`)
    await expect(inactiveLikeButton).toHaveAttribute('aria-pressed', 'false')
    await expect(inactiveLikeButton.locator('[data-slot="typography"]')).toHaveCount(0)
    writeFileSync(resolve('e2e/.artifacts/agent-b-react-metrics.json'), JSON.stringify(geometry, null, 2))
  })

  test('B6 real observer and seen API take seven unread to five without moving cards or another user', async ({ page, browser }) => {
    const secondSubject = String(900_000_000 + Math.floor(Math.random() * 90_000_000))
    const secondUser = await prisma.user.create({ data: { displayName: 'Другой зритель E2E' } })
    const errorPhoto = await prisma.memory.findFirstOrThrow({ where: { familyId: fixture.familyId, body: 'Одиночное фото E2E' } })
    const sevenIds = Array.from({ length: 7 }, () => randomUUID())
    const oldDate = Date.now() - 500 * 24 * 60 * 60_000
    const body = (index: number) => `Непросмотренная заметка ${index + 1}\n${Array.from({ length: 28 }, (_, line) => `Строка ${line + 1} семейного воспоминания`).join('\n')}`
    let secondContext: Awaited<ReturnType<typeof browser.newContext>> | null = null
    let sameAccountContext: Awaited<ReturnType<typeof browser.newContext>> | null = null
    try {
      await prisma.pilotAdmission.create({ data: { provider: 'telegram', subject: secondSubject } })
      await prisma.externalIdentity.create({ data: { userId: secondUser.id, provider: 'telegram', subject: secondSubject } })
      await prisma.familyMember.create({ data: { familyId: fixture.familyId, userId: secondUser.id, role: 'viewer', unreadBaselineOrdinal: 0n } })
      await prisma.$transaction(async (tx) => {
        await tx.family.update({ where: { id: fixture.familyId }, data: { unreadTrackingActivatedAt: new Date(), publicationOrdinal: 0n } })
        await tx.familyMember.update({ where: { familyId_userId: { familyId: fixture.familyId, userId: fixture.userId } }, data: { unreadBaselineOrdinal: 0n } })
        for (const [index, id] of sevenIds.entries()) {
          await tx.family.update({ where: { id: fixture.familyId }, data: { publicationOrdinal: BigInt(index + 1) } })
          await tx.memory.create({ data: {
            id, familyId: fixture.familyId, childId: fixture.childId, authorId: fixture.ownerUserId,
            kind: 'note', body: body(index), occurredAt: new Date(oldDate - index * 60_000),
            firstPublishedOrdinal: BigInt(index + 1),
          } })
        }
      })

      await page.route('**/media/*/content?variant=display', (route) => route.fulfill({ status: 503, contentType: 'application/json', body: '{}' }))
      await page.setViewportSize({ width: 390, height: 650 })
      await page.reload()
      await expect(page.locator('.family-hub-card')).toHaveAttribute('aria-label', /7 непросмотренных воспоминаний/)
      secondContext = await browser.newContext({ viewport: { width: 390, height: 650 } })
      const secondPage = await secondContext.newPage()
      await installTelegramHost(secondPage, signedInitData(Number(secondSubject), 'Другой зритель E2E'))
      await secondPage.goto('/')
      await expect(secondPage.locator('.family-hub-card')).toHaveAttribute('aria-label', /7 непросмотренных воспоминаний/)

      await page.bringToFront()
      await page.locator('.family-hub-card').click()
      await expect(page.locator('[data-memoly-feed="true"]')).toBeVisible()
      await page.getByRole('button', { name: 'Непросмотренные · 7' }).click()
      await expect(page.locator('#root [data-memory-id]')).toHaveCount(7)
      await page.screenshot({ path: resolve('e2e/.artifacts/b6-unread-seven.png'), animations: 'disabled' })

      const first = page.locator(`[data-memory-id="${sevenIds[0]}"]`)
      await first.locator('[data-seen-main]').evaluate((element) => {
        const rect = element.getBoundingClientRect()
        window.scrollTo({ top: window.scrollY + rect.top - 80, behavior: 'instant' })
      })
      await first.getByRole('button', { name: 'Действия с воспоминанием' }).click()
      await expect(page.locator('[data-memoly-bottom-sheet="true"]')).toBeVisible()
      await page.waitForTimeout(1_200)
      expect(await prisma.memorySeen.count({ where: { familyId: fixture.familyId, userId: fixture.userId, memoryId: sevenIds[0] } })).toBe(0)
      await page.keyboard.press('Escape')
      await expect(page.locator('[data-memoly-bottom-sheet="true"]')).toHaveCount(0)

      for (let index = 0; index < 2; index += 1) {
        const content = page.locator(`[data-memory-id="${sevenIds[index]}"] [data-seen-main]`)
        await content.evaluate((element) => {
          const rect = element.getBoundingClientRect()
          window.scrollTo({ top: window.scrollY + rect.top - 80, behavior: 'instant' })
        })
        await expect.poll(() => prisma.memorySeen.count({ where: { familyId: fixture.familyId, userId: fixture.userId, memoryId: { in: sevenIds } } })).toBe(index + 1)
      }
      const anchor = page.locator(`[data-memory-id="${sevenIds[1]}"]`)
      const anchorTop = await anchor.evaluate((element) => element.getBoundingClientRect().top)
      await expect(page.getByRole('button', { name: 'Непросмотренные · 5' })).toBeVisible()
      expect(await page.locator('#root [data-memory-id]').count()).toBe(7)
      expect(Math.abs((await anchor.evaluate((element) => element.getBoundingClientRect().top)) - anchorTop)).toBeLessThanOrEqual(2)
      await page.screenshot({ path: resolve('e2e/.artifacts/b6-unread-five-stable.png'), animations: 'disabled' })

      await page.locator(`[data-memory-id="${sevenIds[2]}"] [data-seen-main]`).evaluate((element) => {
        const rect = element.getBoundingClientRect()
        window.scrollTo({ top: window.scrollY + rect.top - 80, behavior: 'instant' })
      })
      await page.evaluate(() => {
        Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' })
        document.dispatchEvent(new Event('visibilitychange'))
      })
      await page.waitForTimeout(1_200)
      expect(await prisma.memorySeen.count({ where: { familyId: fixture.familyId, userId: fixture.userId, memoryId: sevenIds[2] } })).toBe(0)
      await page.evaluate(() => {
        window.scrollTo({ top: 0, behavior: 'instant' })
        Reflect.deleteProperty(document, 'visibilityState')
        document.dispatchEvent(new Event('visibilitychange'))
      })

      await page.getByRole('button', { name: '‹ Все семьи' }).click()
      await expect(page.locator('.family-hub-card')).toHaveAttribute('aria-label', /5 непросмотренных воспоминаний/)
      await expect(secondPage.locator('.family-hub-card')).toHaveAttribute('aria-label', /7 непросмотренных воспоминаний/)
      sameAccountContext = await browser.newContext({ viewport: { width: 390, height: 650 } })
      const sameAccountPage = await sameAccountContext.newPage()
      await installTelegramHost(sameAccountPage, signedInitData(Number(subject), 'Лента E2E'))
      await sameAccountPage.goto('/')
      await expect(sameAccountPage.locator('.family-hub-card')).toHaveAttribute('aria-label', /5 непросмотренных воспоминаний/)

      await page.locator('.family-hub-card').click()
      const failedPhotoCard = page.locator(`[data-memory-id="${errorPhoto.id}"]`)
      await failedPhotoCard.scrollIntoViewIfNeeded()
      await expect(failedPhotoCard.getByLabel('Загрузка фотографии')).toBeVisible()
      await page.waitForTimeout(1_200)
      expect(await prisma.memorySeen.count({ where: { familyId: fixture.familyId, userId: fixture.userId, memoryId: errorPhoto.id } })).toBe(0)

      const membership = await prisma.familyMember.findUniqueOrThrow({ where: { familyId_userId: { familyId: fixture.familyId, userId: fixture.userId } } })
      await prisma.memorySeen.createMany({ data: sevenIds.map((memoryId) => ({ familyId: fixture.familyId, userId: fixture.userId, membershipEpoch: membership.membershipEpoch, memoryId })), skipDuplicates: true })
      await page.getByRole('button', { name: /Непросмотренные/ }).click()
      await page.getByRole('button', { name: 'Обновить список' }).click()
      await expect(page.getByText('Все новые воспоминания просмотрены')).toBeVisible()
      await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')))
      await expect(page.getByRole('button', { name: 'Непросмотренные · 0' })).toBeVisible()
      await page.setViewportSize({ width: 390, height: 844 })
      await page.screenshot({ path: resolve('e2e/.artifacts/b6-unread-empty.png'), animations: 'disabled' })
      await page.getByRole('button', { name: 'Все воспоминания' }).click()
      await page.getByRole('button', { name: 'Непросмотренные · 0' }).click()
      await expect(page.getByText('Все новые воспоминания просмотрены')).toBeVisible()
    } finally {
      await sameAccountContext?.close()
      await secondContext?.close()
      await prisma.memory.deleteMany({ where: { id: { in: sevenIds } } })
      await prisma.family.update({ where: { id: fixture.familyId }, data: { unreadTrackingActivatedAt: null, publicationOrdinal: 0n } })
      await prisma.familyMember.update({ where: { familyId_userId: { familyId: fixture.familyId, userId: fixture.userId } }, data: { unreadBaselineOrdinal: null } })
      await prisma.familyMember.deleteMany({ where: { familyId: fixture.familyId, userId: secondUser.id } })
      await prisma.externalIdentity.deleteMany({ where: { userId: secondUser.id } })
      await prisma.user.delete({ where: { id: secondUser.id } })
      await prisma.pilotAdmission.deleteMany({ where: { provider: 'telegram', subject: secondSubject } })
    }
  })

  test('closes access and pauses playback after membership revoke', async ({ page }) => {
    await openFeed(page)
    const voiceCard = page.locator('[data-memory-id]').filter({ hasText: 'Голос E2E' })
    const voice = voiceCard.locator('audio')
    await voiceCard.getByRole('button', { name: 'Слушать' }).click()
    await expect.poll(() => voice.evaluate((element) => !(element as HTMLAudioElement).paused)).toBe(true)
    const voiceHandle = await voice.elementHandle()
    expect(voiceHandle).not.toBeNull()

    await prisma.familyMember.update({
      where: { familyId_userId: { familyId: fixture.familyId, userId: fixture.userId } },
      data: { revokedAt: new Date() },
    })
    await page.getByRole('button', { name: 'Фото', exact: true }).click()

    await expect(page.getByText('Доступ к этой семье закрыт.')).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Мои семьи' })).toBeVisible()
    await expect.poll(() => voiceHandle!.evaluate((element) => (element as HTMLAudioElement).paused)).toBe(true)
    await expect(page.locator('[data-memory-id]')).toHaveCount(0)
  })
})

async function seedFeed() {
  const objectKeys: string[] = []
  const prior = await prisma.externalIdentity.findUnique({
    where: { provider_subject: { provider: 'telegram', subject } },
    select: { userId: true },
  })
  if (prior) {
    const priorFamilies = await prisma.familyMember.findMany({ where: { userId: prior.userId }, select: { familyId: true, family: { select: { ownerUserId: true } } } })
    await prisma.family.deleteMany({ where: { id: { in: priorFamilies.map(({ familyId }) => familyId) } } })
    await prisma.user.delete({ where: { id: prior.userId } })
    const orphanedOwners = priorFamilies.map(({ family }) => family.ownerUserId).filter((userId) => userId !== prior.userId)
    if (orphanedOwners.length > 0) await prisma.user.deleteMany({ where: { id: { in: orphanedOwners } } })
  }
  const user = await prisma.user.create({ data: { displayName: 'Зритель E2E' } })
  const ownerUser = await prisma.user.create({ data: { displayName: 'Мама E2E' } })
  await prisma.externalIdentity.create({ data: { userId: user.id, provider: 'telegram', subject } })
  const familyId = randomUUID()
  const childId = randomUUID()
  await prisma.$transaction(async (tx) => {
    await tx.family.create({ data: { id: familyId, ownerUserId: ownerUser.id, name: 'Семья E2E', timezone: 'Europe/Moscow' } })
    await tx.familyMember.create({ data: { familyId, userId: ownerUser.id, role: 'full' } })
    await tx.familyMember.create({ data: { familyId, userId: user.id, role: 'viewer' } })
    await tx.child.create({ data: { id: childId, familyId, displayName: 'Лиза', birthDate: new Date('2024-02-29T00:00:00.000Z'), sex: 'girl' } })
  })

  const baseTime = Date.now() - 60_000
  await prisma.memory.createMany({
    data: Array.from({ length: 43 }, (_, index) => ({
      familyId,
      childId,
      authorId: ownerUser.id,
      kind: 'note' as const,
      body: `Заметка E2E ${index}`,
      occurredAt: new Date(baseTime - (index + 4) * 60_000),
    })),
  })

  const photoAssets = await Promise.all([0, 1].map(async (index) => {
    const key = `media-display/${randomUUID()}-${index}.png`
    objectKeys.push(key)
    await store(key, pngImage.buffer, 'image/png')
    return createAsset({ familyId, userId: ownerUser.id, kind: 'photo', variant: 'display', key, bytes: pngImage.buffer, mime: 'image/png', width: 1, height: 1 })
  }))
  await createMemoryWithMedia({ familyId, childId, userId: ownerUser.id, kind: 'photo', body: 'Фотоальбом E2E', occurredAt: new Date(baseTime), assets: photoAssets })

  const singlePhotoKey = `media-display/${randomUUID()}-single.png`
  objectKeys.push(singlePhotoKey)
  await store(singlePhotoKey, pngImage.buffer, 'image/png')
  const singlePhotoAsset = await createAsset({ familyId, userId: ownerUser.id, kind: 'photo', variant: 'display', key: singlePhotoKey, bytes: pngImage.buffer, mime: 'image/png', width: 1, height: 1 })
  await createMemoryWithMedia({ familyId, childId, userId: ownerUser.id, kind: 'photo', body: 'Одиночное фото E2E', occurredAt: new Date(baseTime - 30_000), assets: [singlePhotoAsset] })

  const voiceBytes = generatedMedia(['-f', 'lavfi', '-i', 'sine=frequency=440:duration=8', '-c:a', 'aac', '-b:a', '128k', '-movflags', 'frag_keyframe+empty_moov', '-f', 'ipod', 'pipe:1'])
  const voiceKey = `media-playback/${randomUUID()}.m4a`
  objectKeys.push(voiceKey)
  await store(voiceKey, voiceBytes, 'audio/mp4')
  const voiceAsset = await createAsset({
    familyId, userId: ownerUser.id, kind: 'voice', variant: 'playback', key: voiceKey, bytes: voiceBytes, mime: 'audio/mp4', durationMs: 8_000,
    waveform: Array.from({ length: 48 }, (_, index) => ((index % 12) + 1) / 12),
  })
  await createMemoryWithMedia({ familyId, childId, userId: ownerUser.id, kind: 'voice', body: 'Голос E2E', occurredAt: new Date(baseTime - 60_000), assets: [voiceAsset] })

  const videoBytes = generatedMedia(['-f', 'lavfi', '-i', 'color=c=pink:s=320x180:d=8', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-movflags', 'frag_keyframe+empty_moov', '-f', 'mp4', 'pipe:1'])
  const videoKey = `media-playback/${randomUUID()}.mp4`
  objectKeys.push(videoKey)
  await store(videoKey, videoBytes, 'video/mp4')
  const videoAsset = await createAsset({ familyId, userId: ownerUser.id, kind: 'video', variant: 'playback', key: videoKey, bytes: videoBytes, mime: 'video/mp4', width: 320, height: 180, durationMs: 8_000 })
  await createMemoryWithMedia({ familyId, childId, userId: ownerUser.id, kind: 'video', body: 'Legacy video E2E', occurredAt: new Date(baseTime - 120_000), assets: [videoAsset] })

  const telegramMemory = await prisma.memory.create({ data: { familyId, childId, authorId: ownerUser.id, kind: 'video', body: 'Telegram video E2E', occurredAt: new Date(baseTime - 180_000) } })
  const thumbnailKey = `media-display/${randomUUID()}-telegram-poster.png`
  objectKeys.push(thumbnailKey)
  await store(thumbnailKey, pngImage.buffer, 'image/png')
  const thumbnail = await createAsset({ familyId, userId: ownerUser.id, kind: 'photo', variant: 'display', key: thumbnailKey, bytes: pngImage.buffer, mime: 'image/png', width: 1, height: 1 })
  const botId = BigInt(`777${subject}`)
  const inbox = await prisma.telegramInbox.create({ data: { botId, updateId: 1n, eventKind: 'content', encryptedPayload: Buffer.from([1]), encryptionIv: Buffer.alloc(12, 2), encryptionAuthTag: Buffer.alloc(16, 3), processedAt: new Date() } })
  const source = await prisma.telegramSource.create({ data: { inboxId: inbox.id, botId, chatId: BigInt(subject), messageId: 1n, senderSubject: subject, userId: user.id, familyId, childId, kind: 'video', status: 'published', plannedMemoryId: telegramMemory.id, memoryId: telegramMemory.id } })
  await prisma.telegramVideoReference.create({ data: { sourceId: source.id, memoryId: telegramMemory.id, familyId, thumbnailMediaId: thumbnail.id, fileIdCiphertext: Buffer.from('synthetic-file-id'), encryptionIv: Buffer.alloc(12, 4), encryptionAuthTag: Buffer.alloc(16, 5), fileUniqueId: 'synthetic-unique-id', width: 320, height: 180, durationMs: 8_000 } })

  return { familyId, childId, userId: user.id, ownerUserId: ownerUser.id, botId, objectKeys, memoryCount: 48 }
}

async function createAsset(input: { familyId: string; userId: string; kind: 'photo' | 'video' | 'voice'; variant: 'display' | 'playback'; key: string; bytes: Buffer; mime: string; width?: number; height?: number; durationMs?: number; waveform?: number[] }) {
  return prisma.mediaAsset.create({ data: {
    familyId: input.familyId,
    uploaderId: input.userId,
    sourceKind: 'upload',
    purpose: 'memory',
    mediaKind: input.kind,
    originalKey: `media-originals/${randomUUID()}`,
    declaredMime: input.kind === 'photo' ? input.mime : input.kind === 'video' ? 'video/mp4' : 'audio/ogg',
    verifiedMime: input.kind === 'photo' ? input.mime : input.kind === 'video' ? 'video/mp4' : 'audio/ogg',
    sha256: randomUUID().replaceAll('-', '').repeat(2),
    byteSize: BigInt(input.bytes.byteLength),
    width: input.width,
    height: input.height,
    durationMs: input.durationMs,
    waveform: input.waveform,
    originalStatus: 'stored',
    renditionStatus: 'ready',
    variants: { create: { variant: input.variant, objectKey: input.key, sha256: randomUUID().replaceAll('-', '').repeat(2), byteSize: BigInt(input.bytes.byteLength), mime: input.mime, width: input.width, height: input.height, durationMs: input.durationMs } },
  } })
}

async function createMemoryWithMedia(input: { familyId: string; childId: string; userId: string; kind: 'photo' | 'video' | 'voice'; body: string; occurredAt: Date; assets: Array<{ id: string }> }) {
  return prisma.memory.create({ data: {
    familyId: input.familyId,
    childId: input.childId,
    authorId: input.userId,
    kind: input.kind,
    body: input.body,
    occurredAt: input.occurredAt,
    media: { create: input.assets.map((asset, position) => ({ mediaId: asset.id, position })) },
  } })
}

async function store(key: string, bytes: Buffer, contentType: string) {
  await storage.writeObject({ key, body: new Blob([bytes]).stream(), contentLength: bytes.byteLength, contentType })
}

function generatedMedia(args: string[]) {
  const result = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', ...args], { encoding: 'buffer', maxBuffer: 20_000_000 })
  if (result.status !== 0) throw new Error(`ffmpeg fixture failed: ${result.stderr.toString()}`)
  return result.stdout
}

function signedInitData(id: number, name: string) {
  const fields = new URLSearchParams({
    auth_date: String(Math.floor(Date.now() / 1_000)),
    query_id: randomUUID(),
    user: JSON.stringify({ id, first_name: name }),
  })
  const dataCheckString = [...fields.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([key, value]) => `${key}=${value}`).join('\n')
  const secret = createHmac('sha256', 'WebAppData').update('123456:web-e2e-synthetic-token').digest()
  fields.set('hash', createHmac('sha256', secret).update(dataCheckString).digest('hex'))
  return fields.toString()
}

async function installTelegramHost(page: Page, initData: string, insets: { bottom?: number; top?: number } = {}) {
  await page.route(/telegram\.org\/js\/telegram-web-app\.js(?:\?.*)?$/, (route) => route.fulfill({ status: 200, contentType: 'application/javascript', body: '' }))
  await page.addInitScript(({ bottomInset, initData: value, topInset }) => {
    const backHandlers = new Set<() => void>()
    const testWindow = window as typeof window & {
      __openedTelegramLink?: string
      __telegramBackHandlerCount?: () => number
      __triggerTelegramBack?: () => void
    }
    testWindow.__telegramBackHandlerCount = () => backHandlers.size
    testWindow.__triggerTelegramBack = () => { backHandlers.forEach((handler) => handler()) }
    Object.defineProperty(window, 'Telegram', { configurable: true, value: { WebApp: {
      initData: value,
      version: '8.0',
      platform: 'tdesktop',
      safeAreaInset: { bottom: bottomInset, top: topInset },
      contentSafeAreaInset: { bottom: bottomInset, top: topInset },
      BackButton: {
        show() {},
        hide() {},
        onClick(handler: () => void) { backHandlers.add(handler) },
        offClick(handler: () => void) { backHandlers.delete(handler) },
      },
      ready() {},
      openTelegramLink(url: string) { testWindow.__openedTelegramLink = url },
    } } })
  }, { bottomInset: insets.bottom ?? 0, initData, topInset: insets.top ?? 0 })
}

async function installMaxHost(page: Page, initData: string) {
  await page.addInitScript(({ initData: signedData }) => {
    const testWindow = window as typeof window & { __openedMaxLink?: string }
    const webApp = {
      initData: signedData,
      version: '1.0',
      ready() {},
      openLink(url: string) { testWindow.__openedMaxLink = url },
    }
    Object.defineProperty(window, 'WebApp', { configurable: false, get: () => webApp })
  }, { initData })
}

async function installMaxAuthRoute(page: Page) {
  // Keep the existing Telegram-backed E2E identity while exercising the MAX client boundary;
  // no MAX backend or provider is enabled by this browser-only test.
  await page.route('**/api/v1/auth/max', async (route) => {
    const response = await route.fetch({
      headers: { 'content-type': 'application/json' },
      method: 'POST',
      postData: route.request().postData() ?? undefined,
      url: `${backendUrl}/api/v1/auth/telegram`,
    })
    await route.fulfill({ response })
  })
}

async function installObjectUrlTracker(page: Page) {
  await page.evaluate(() => {
    const tracked = { created: [] as string[], revoked: [] as string[] }
    const createObjectUrl = URL.createObjectURL.bind(URL)
    const revokeObjectUrl = URL.revokeObjectURL.bind(URL)
    const testWindow = window as typeof window & { __photoObjectUrls?: typeof tracked }
    testWindow.__photoObjectUrls = tracked
    URL.createObjectURL = (blob) => {
      const url = createObjectUrl(blob)
      tracked.created.push(url)
      return url
    }
    URL.revokeObjectURL = (url) => {
      if (tracked.created.includes(url)) tracked.revoked.push(url)
      revokeObjectUrl(url)
    }
  })
}

function objectUrlSnapshot(page: Page) {
  return page.evaluate(() => {
    const tracked = (window as typeof window & {
      __photoObjectUrls?: { created: string[]; revoked: string[] }
    }).__photoObjectUrls
    if (!tracked) throw new Error('Object URL tracker is not installed')
    return { created: [...tracked.created], revoked: [...tracked.revoked] }
  })
}

async function expectObjectUrlsClean(page: Page, expectedCount: number) {
  await expect.poll(async () => (await objectUrlSnapshot(page)).revoked.length).toBe(expectedCount)
  const snapshot = await objectUrlSnapshot(page)
  expect(snapshot.created).toHaveLength(expectedCount)
  expect(snapshot.revoked).toHaveLength(expectedCount)
  expect(new Set(snapshot.created).size).toBe(expectedCount)
  expect(new Set(snapshot.revoked).size).toBe(expectedCount)
  expect([...snapshot.revoked].sort()).toEqual([...snapshot.created].sort())
}

function telegramBackHandlerCount(page: Page) {
  return page.evaluate(() => {
    const count = (window as typeof window & { __telegramBackHandlerCount?: () => number }).__telegramBackHandlerCount
    if (!count) throw new Error('Telegram BackButton harness is not installed')
    return count()
  })
}

function triggerTelegramBack(page: Page) {
  return page.evaluate(() => {
    const trigger = (window as typeof window & { __triggerTelegramBack?: () => void }).__triggerTelegramBack
    if (!trigger) throw new Error('Telegram BackButton harness is not installed')
    trigger()
  })
}

async function openFeed(page: Page) {
  await page.locator('[data-slot="family-hub"] .family-hub-card').click()
  await expect(page.locator('[data-memoly-feed="true"]')).toBeVisible()
  await expect(page.locator('[data-slot="memoly-filter-rail"]')).toBeVisible()
  await expect(page.locator('[data-memory-kind="photo"]').first()).toBeVisible()
  await expect(page.getByRole('navigation', { name: 'Основная навигация' })).toBeVisible()
  await expect(page.getByText('Фотоальбом E2E')).toBeVisible()
}

async function selectTheme(page: Page, theme: string) {
  await page.getByRole('button', { name: 'Семья', exact: true }).click()
  await page.getByRole('button', { name: 'Настройки' }).click()
  await page.getByRole('button', { name: 'Оформление' }).click()
  const saved = page.waitForResponse((response) => response.url().endsWith('/api/users/me') && response.request().method() === 'PATCH')
  await page.locator(`[data-theme-choice="${theme}"]`).click()
  await saved
  await expect(page.locator('html')).toHaveAttribute('data-memoly-theme', theme)
  await page.getByRole('button', { name: 'Назад' }).click()
  await page.evaluate(() => (window as typeof window & { __triggerTelegramBack?: () => void }).__triggerTelegramBack?.())
}
