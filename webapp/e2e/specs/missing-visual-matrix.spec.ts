import type { Browser, Page } from '@playwright/test'
import { createHash, createHmac, randomInt, randomUUID } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { resolve } from 'node:path'

import { createPrisma } from '../../../backend/src/db'
import { expect, test } from '../helpers/test'

const databaseUrl = process.env.TEST_DATABASE_URL!
const backendUrl = process.env.E2E_BACKEND_URL!
const artifactRoot = resolve('e2e/.artifacts/agent-l-missing-visual-matrix')
const referenceUrl = pathToFileURL(resolve('../docs/memoly-final-functional-state-pack.html')).href
const canonicalPath = resolve('../docs/memoly-final-functional-state-pack.html')
const canonicalSha = '180f8c9b6e60369513cffd5eb9dbb3cb3397649407df996dcf907ab0fa38c5b4'
const themes = ['mint', 'rose', 'sky', 'lavender', 'apricot', 'sand'] as const
const widths = [320, 390, 430, 480] as const
const prisma = createPrisma(databaseUrl)

type Theme = (typeof themes)[number]
type MatrixState = {
  name: string
  canonicalId: string
  reactSelector: string
  canonicalSelector: string
  compareRootWidth?: boolean
  visualOutcome?: 'comparable' | 'functional-delta' | 'blocked'
  visualNote?: string
  geometry?: GeometryCheck[]
  geometryOrder?: { react: string[]; canonical: string[] }
  openReact: (page: Page) => Promise<void>
  assertReact: (page: Page) => Promise<void>
}
type GeometryCheck = {
  name: string
  reactSelector: string
  canonicalSelector: string
  tolerance: { x: number; y: number; width: number; height: number }
  required?: Partial<Record<'react' | 'canonical', boolean>>
  expectedAspectRatio?: number
  compare?: Partial<Record<keyof GeometryCheck['tolerance'], boolean>>
}
type GeometryBox = Box & {
  right: number
  bottom: number
  visible: boolean
  aspectRatio: number
  viewport: { width: number; height: number }
}
type Fixture = { familyId: string; childId: string; userId: string; memoryId: string; subject: string }

let fixture: Fixture | undefined
let subject: string
let videoFixture: { name: string; mimeType: string; buffer: Buffer }

test.describe.configure({ mode: 'serial', timeout: 180_000 })

test.describe('Agent L missing visual matrix', () => {
  test.beforeAll(async () => {
    mkdirSync(artifactRoot, { recursive: true })
    assertCanonicalIntegrity()
    fixture = await seedVisualFixture()
    videoFixture = {
      name: 'synthetic-video.mp4',
      mimeType: 'video/mp4',
      buffer: generatedVideo(),
    }
  })

  test.afterAll(async () => {
    if (!fixture) {
      await prisma.$disconnect()
      return
    }
    await cleanupVisualFixture(fixture)
    assertCanonicalIntegrity()
    await prisma.$disconnect()
  })

  test.beforeEach(async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.addInitScript(() => {
      if (!localStorage.getItem('memoly-theme')) localStorage.setItem('memoly-theme', 'mint')
      Object.defineProperty(navigator, 'serviceWorker', { configurable: true, get: () => undefined })
    })
    const isMaxComposer = testInfo.title.includes('Video Composer')
    if (isMaxComposer) {
      await installMaxHost(page, signedInitData(Number(subject), 'Видео L E2E', 'max-video-upload-acceptance'))
      await installMaxAuthRoute(page)
    } else {
      await installTelegramHost(page, signedInitData(Number(subject), 'Матрица L E2E'))
    }
    await page.clock.setFixedTime(new Date('2026-09-20T06:00:00.000Z'))
    await page.goto('/')
    if (isMaxComposer) await expect(page.locator('.memoly-video-v2')).toBeVisible()
    else await expect(page.getByRole('button', { name: 'Лента' })).toBeVisible()
    await stabilize(page)
  })

  test('Photo Composer covers photoEmpty across widths and themes', async ({ browser, page }) => {
    const empty: MatrixState = {
      name: 'photo-empty', canonicalId: 'photoEmpty',
      reactSelector: '[data-add-screen="photo"]', canonicalSelector: '#photoEmpty .composer-screen',
      geometry: photoGeometry('photoEmpty', '.memoly-add-photo-picker', '.photo-picker', '.memoly-add-caption', '.form-block'),
      openReact: openPhotoEmpty, assertReact: async (target) => expect(target.locator('[data-add-screen="photo"]')).toBeVisible(),
    }
    await captureMatrix(browser, page, empty)
  })

  test('Photo Composer covers photoSelected across widths and themes', async ({ browser, page }) => {
    const selected: MatrixState = {
      name: 'photo-selected', canonicalId: 'photoSelected',
      reactSelector: '[data-add-screen="photo"]', canonicalSelector: '#photoSelected .composer-screen',
      geometry: photoGeometry('photoSelected', '.memoly-add-photo-grid', '.selected-grid', '.memoly-add-caption', '.form-block'),
      visualOutcome: 'functional-delta',
      visualNote: 'FUNCTIONAL DELTA: the canonical selected-photo shell includes a child picker below the date, while this real one-child React fixture has no picker. The button geometry is captured and compared for x/width/height; its absolute y is reported in metrics without assertion because the missing canonical picker shifts it.',
      openReact: async (target) => {
        await openPhotoEmpty(target)
        await target.locator('#photo-composer-files').setInputFiles([1, 2, 3, 4].map((index) => ({ name: `synthetic-photo-${index}.png`, mimeType: 'image/png', buffer: generatedPhoto(index) })))
        await target.locator('#photo-composer-caption').fill('Наше солнышко утром ☀️')
        await expect(target.locator('.memoly-add-photo-grid')).toBeVisible()
        await expect(target.getByRole('img', { name: /Выбранное фото/ })).toHaveCount(4)
        await expect.poll(async () => target.getByRole('img', { name: /Выбранное фото/ }).evaluateAll((images) => images.every((image) => (image as HTMLImageElement).naturalWidth > 0))).toBe(true)
      },
      assertReact: async (target) => {
        await expect(target.locator('.memoly-add-photo-grid')).toBeVisible()
        await expect(target.locator('#photo-composer-caption')).toHaveValue('Наше солнышко утром ☀️')
        await expect(target.getByRole('img', { name: /Выбранное фото/ })).toHaveCount(4)
        await expect.poll(async () => target.getByRole('img', { name: /Выбранное фото/ }).evaluateAll((images) => images.every((image) => (image as HTMLImageElement).naturalWidth > 0))).toBe(true)
      },
    }
    await captureMatrix(browser, page, selected)
  })

  test('Note Composer covers noteEmpty across widths and themes', async ({ browser, page }) => {
    const empty: MatrixState = {
      name: 'note-empty', canonicalId: 'noteEmpty',
      reactSelector: '[data-add-screen="note"]', canonicalSelector: '#noteEmpty .composer-screen',
      geometry: noteGeometry('noteEmpty', '.note-editor'),
      openReact: openNoteEmpty, assertReact: async (target) => expect(target.locator('#memory-composer-body')).toBeVisible(),
    }
    await captureMatrix(browser, page, empty)
  })

  test('Note Composer covers noteFilled across widths and themes', async ({ browser, page }) => {
    const filled: MatrixState = {
      name: 'note-filled', canonicalId: 'noteFilled',
      reactSelector: '[data-add-screen="note"]', canonicalSelector: '#noteFilled .composer-screen',
      geometry: noteGeometry('noteFilled', '.note-editor'),
      visualOutcome: 'functional-delta',
      visualNote: 'FUNCTIONAL DELTA: the canonical filled-note shell includes a child picker below the date, while this real one-child React fixture has no picker. The button geometry is captured and compared for x/width/height; its absolute y is reported in metrics without assertion because the missing canonical picker shifts it.',
      openReact: async (target) => { await openNoteEmpty(target); await target.locator('#memory-composer-body').fill('Сегодня у Софии был удивительный день! Мы гуляли в парке, кормили уток и потом пили какао. Она столько смеялась и рассказывала свои истории. Такое простое, но такое счастливое время 💛'); await expect(target.locator('#memory-composer-body')).toHaveValue(/Сегодня у Софии был удивительный день/) },
      assertReact: async (target) => expect(target.locator('#memory-composer-body')).toHaveValue('Сегодня у Софии был удивительный день! Мы гуляли в парке, кормили уток и потом пили какао. Она столько смеялась и рассказывала свои истории. Такое простое, но такое счастливое время 💛'),
    }
    await captureMatrix(browser, page, filled)
  })

  test('Voice handoff covers the supported mediaChoice entry across widths and themes', async ({ browser, page }) => {
    const state: MatrixState = {
      name: 'voice-handoff', canonicalId: 'mediaChoice',
      reactSelector: '[data-slot="memoly-voice-video-sheet"]', canonicalSelector: '#mediaChoice .composer-screen',
      compareRootWidth: false,
      visualOutcome: 'blocked',
      visualNote: 'Known visual BLOCKED: the production voice handoff is a behavioral entry point, while the canonical mediaChoice sheet has a different structural shell. Assertions cover the supported handoff contract only.',
      openReact: openVoiceHandoff,
      assertReact: async (target) => {
        await expect(target.locator('[data-slot="memoly-voice-video-sheet"]')).toBeVisible()
        await expect(target.getByText('Голосовые — через бот', { exact: true })).toBeVisible()
        await expect(target.getByRole('link', { name: 'Открыть бота' })).toHaveAttribute('href', 'https://t.me/OurMemoriesDevBot')
      },
    }
    await captureMatrix(browser, page, state)
  })

  test('Video Composer covers the real selected-video state across widths and themes', async ({ browser, page }) => {
    const state: MatrixState = {
      name: 'video-composer-selected', canonicalId: 'maxVideoComposerIdle',
      reactSelector: '.memoly-video-v2', canonicalSelector: '#maxVideoComposerIdle .composer-screen',
      openReact: async (target) => {
        await expect(target.locator('.memoly-video-v2')).toBeVisible()
        await target.locator('#max-video-file').setInputFiles(videoFixture)
        await target.locator('#max-video-caption').fill('Первый день у моря 🌊')
        await expect(target.locator('.memoly-video-v2-preview video')).toBeVisible()
      },
      assertReact: async (target) => {
        await expect(target.locator('.memoly-video-v2-preview video')).toBeVisible()
        await expect(target.locator('#max-video-caption')).toHaveValue('Первый день у моря 🌊')
        await expect(target.getByRole('button', { name: 'Сохранить' })).toBeVisible()
      },
      visualOutcome: 'functional-delta',
      visualNote: 'FUNCTIONAL DELTA: the real selected-file MAX React state has no exact canonical counterpart. The closest canonical shell is #maxVideoComposerIdle; the selected-file behavior remains exercised with the real React fixture.',
    }
    await captureMatrix(browser, page, state)
  })

  test('Video Viewer loading is a real MAX playback-session loading state', async ({ browser, page }) => {
    const viewerFixture = await installMaxViewerFixture(page, 'loading')
    await page.reload()
    await expect(page.getByRole('button', { name: 'Лента' })).toBeVisible()
    const state: MatrixState = {
      name: 'video-viewer-loading', canonicalId: 'maxVideoLoading',
      reactSelector: '.memoly-detail-surface [data-video-viewer-state="loading"]', canonicalSelector: '#maxVideoLoading .composer-screen',
      compareRootWidth: false,
      visualOutcome: 'blocked',
      visualNote: 'Known visual BLOCKED: the real playback-session loading state is rendered inside a MemoryDetail sheet while #maxVideoLoading is a dedicated canonical page. Frame, status, action, containment, the React 16:9 frame invariant, and exact React/canonical geometry deltas are captured; absolute frame-size parity remains blocked by that structural difference.',
      geometry: videoViewerGeometry('maxVideoLoading', '.memoly-video-viewer-v2-status', '.state-status-line'),
      geometryOrder: { react: ['frame', 'status', 'open'], canonical: ['frame', 'status', 'open'] },
      openReact: async (target) => { await openVideoMemoryDetail(target); await expect(target.locator('.memoly-detail-surface [data-video-viewer-state="loading"]')).toBeVisible() },
      assertReact: async (target) => { await expect(target.locator('.memoly-detail-surface').getByRole('status')).toContainText('Загружаем видео…') },
    }
    await captureMatrix(browser, page, state)
    viewerFixture.release()
  })

  test('Video Viewer error is a real MAX playback-session error state', async ({ browser, page }) => {
    const viewerFixture = await installMaxViewerFixture(page, 'error')
    await page.reload()
    await expect(page.getByRole('button', { name: 'Лента' })).toBeVisible()
    const state: MatrixState = {
      name: 'video-viewer-error', canonicalId: 'maxVideoError',
      reactSelector: '.memoly-detail-surface [data-video-viewer-state="error"]', canonicalSelector: '#maxVideoError .composer-screen',
      compareRootWidth: false,
      visualOutcome: 'blocked',
      visualNote: 'Known visual BLOCKED: the real playback-session error state is rendered inside a MemoryDetail sheet while #maxVideoError is a dedicated canonical page. The React 16:9 frame invariant and real retry handler are exercised; canonical #maxVideoError has no retry control, so that missing control and absolute frame-size difference are reported as explicit structural/functional deltas.',
      geometry: videoViewerGeometry('maxVideoError', '.memoly-video-viewer-v2-error', '.state-error-box', true),
      geometryOrder: { react: ['frame', 'status', 'retry', 'open'], canonical: ['frame', 'status', 'open'] },
      openReact: async (target) => { await openVideoMemoryDetail(target); await expect(target.locator('.memoly-detail-surface [data-video-viewer-state="error"]')).toBeVisible() },
      assertReact: async (target) => {
        await expect(target.locator('.memoly-detail-surface').getByRole('alert')).toContainText('Не удалось загрузить видео')
        await expect(target.locator('.memoly-detail-surface').getByRole('button', { name: 'Повторить' })).toBeVisible()
      },
    }
    await captureMatrix(browser, page, state)
    const requestsBeforeRetry = viewerFixture.playbackRequestCount()
    const retryRequest = page.waitForRequest((request) => request.url().includes('/media/playback-session'))
    await page.locator('.memoly-detail-surface').getByRole('button', { name: 'Повторить' }).click()
    await retryRequest
    await expect(page.locator('.memoly-detail-surface').getByRole('alert')).toContainText('Не удалось загрузить видео')
    expect(viewerFixture.playbackRequestCount()).toBeGreaterThan(requestsBeforeRetry)
  })
})

async function captureMatrix(browser: Browser, page: Page, state: MatrixState) {
  await state.openReact(page)
  await state.assertReact(page)
  await blurFocusedControl(page)
  const metrics: Record<string, unknown> = {}
  for (const width of widths) {
    await page.setViewportSize({ width, height: 844 })
    await stabilize(page)
    await state.assertReact(page)
    await blurFocusedControl(page)
    const key = `${width}`
    const reactPath = resolve(artifactRoot, `${state.name}-react-${key}.png`)
    const canonicalPathForWidth = resolve(artifactRoot, `${state.name}-canonical-${key}.png`)
    await page.screenshot({ path: reactPath, fullPage: false, animations: 'disabled' })
    const canonical = await browser.newPage({ viewport: { width, height: 844 }, deviceScaleFactor: 1 })
    await prepareCanonical(canonical, state.canonicalId, 'mint')
    await canonical.screenshot({ path: canonicalPathForWidth, fullPage: false, animations: 'disabled' })
    const reactGeometry = state.geometry ? await measureGeometry(page, state.geometry, 'react') : undefined
    const canonicalGeometry = state.geometry ? await measureGeometry(canonical, state.geometry, 'canonical') : undefined
    metrics[key] = {
      react: await measure(page, state.reactSelector),
      canonical: await measure(canonical, state.canonicalSelector),
      geometry: state.geometry ? { react: reactGeometry, canonical: canonicalGeometry } : undefined,
      geometryDeltas: state.geometry ? geometryDeltas(state.geometry, reactGeometry!, canonicalGeometry!) : undefined,
      screenshots: { react: reactPath, canonical: canonicalPathForWidth },
    }
    await canonical.close()
  }

  for (const theme of themes) {
    await applyReactTheme(page, theme)
    await state.assertReact(page)
    await blurFocusedControl(page)
    await page.setViewportSize({ width: 390, height: 844 })
    await stabilize(page)
    const reactPath = resolve(artifactRoot, `${state.name}-react-${theme}-390.png`)
    const canonicalPathForTheme = resolve(artifactRoot, `${state.name}-canonical-${theme}-390.png`)
    await page.screenshot({ path: reactPath, fullPage: false, animations: 'disabled' })
    const canonical = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 })
    await prepareCanonical(canonical, state.canonicalId, theme)
    await canonical.screenshot({ path: canonicalPathForTheme, fullPage: false, animations: 'disabled' })
    const reactGeometry = state.geometry ? await measureGeometry(page, state.geometry, 'react') : undefined
    const canonicalGeometry = state.geometry ? await measureGeometry(canonical, state.geometry, 'canonical') : undefined
    metrics[`${theme}-390`] = {
      react: await measure(page, state.reactSelector),
      canonical: await measure(canonical, state.canonicalSelector),
      geometry: state.geometry ? { react: reactGeometry, canonical: canonicalGeometry } : undefined,
      geometryDeltas: state.geometry ? geometryDeltas(state.geometry, reactGeometry!, canonicalGeometry!) : undefined,
      screenshots: { react: reactPath, canonical: canonicalPathForTheme },
    }
    await canonical.close()
  }

  writeFileSync(resolve(artifactRoot, `${state.name}-metrics.json`), JSON.stringify({
    visualOutcome: state.visualOutcome ?? 'comparable',
    visualNote: state.visualNote,
    measurements: metrics,
  }, null, 2))
  for (const [key, value] of Object.entries(metrics)) {
    const entry = value as {
      react: { viewport: { width: number }; root: { width: number }; scrollWidth: number }
      canonical: { root: { width: number }; scrollWidth: number }
      geometry?: { react: Record<string, GeometryBox | null>; canonical: Record<string, GeometryBox | null> }
      geometryDeltas?: Record<string, { present: { react: boolean; canonical: boolean }; delta: { x: number | null; y: number | null; width: number | null; height: number | null; aspectRatio: number | null } }>
    }
    expect(entry.react.scrollWidth, `${state.name}/${key} React overflow`).toBeLessThanOrEqual(entry.react.viewport.width + 1)
    expect(entry.canonical.scrollWidth, `${state.name}/${key} canonical overflow`).toBeLessThanOrEqual(entry.react.viewport.width + 1)
    if (state.compareRootWidth !== false) {
      expect(Math.abs(entry.react.root.width - entry.canonical.root.width), `${state.name}/${key} root width delta`).toBeLessThanOrEqual(24)
    }
    for (const check of state.geometry ?? []) {
      const reactBox = entry.geometry?.react[check.name]
      const canonicalBox = entry.geometry?.canonical[check.name]
      const reactRequired = check.required?.react !== false
      const canonicalRequired = check.required?.canonical !== false
      if (!reactRequired) expect(reactBox, `${state.name}/${key}/${check.name} React optional geometry`).toBeNull()
      if (!canonicalRequired) expect(canonicalBox, `${state.name}/${key}/${check.name} canonical optional geometry`).toBeNull()
      if (reactRequired) expect(reactBox, `${state.name}/${key}/${check.name} React geometry`).toBeDefined()
      if (canonicalRequired) expect(canonicalBox, `${state.name}/${key}/${check.name} canonical geometry`).toBeDefined()
      if (!reactBox || !canonicalBox) continue
      if (check.expectedAspectRatio !== undefined) {
        expect(Math.abs(reactBox.aspectRatio - check.expectedAspectRatio), `${state.name}/${key}/${check.name} React aspect ratio`).toBeLessThanOrEqual(0.02)
      }
      for (const [side, box] of [['React', reactBox], ['canonical', canonicalBox] as const]) {
        expect(box.visible, `${state.name}/${key}/${check.name} ${side} visibility`).toBe(true)
        expect(box.width, `${state.name}/${key}/${check.name} ${side} width`).toBeGreaterThan(0)
        expect(box.height, `${state.name}/${key}/${check.name} ${side} height`).toBeGreaterThan(0)
        expect(box.x, `${state.name}/${key}/${check.name} ${side} left clipping`).toBeGreaterThanOrEqual(-1)
        expect(box.y, `${state.name}/${key}/${check.name} ${side} top clipping`).toBeGreaterThanOrEqual(-1)
        expect(box.right, `${state.name}/${key}/${check.name} ${side} right clipping`).toBeLessThanOrEqual(box.viewport.width + 1)
        expect(box.bottom, `${state.name}/${key}/${check.name} ${side} bottom clipping`).toBeLessThanOrEqual(box.viewport.height + 1)
        const root = side === 'React' ? entry.react.root : entry.canonical.root
        expect(box.x, `${state.name}/${key}/${check.name} ${side} root containment`).toBeGreaterThanOrEqual(root.x - 1)
        expect(box.y, `${state.name}/${key}/${check.name} ${side} root containment`).toBeGreaterThanOrEqual(root.y - 1)
        expect(box.right, `${state.name}/${key}/${check.name} ${side} root containment`).toBeLessThanOrEqual(root.x + root.width + 1)
        expect(box.bottom, `${state.name}/${key}/${check.name} ${side} root containment`).toBeLessThanOrEqual(root.y + root.height + 1)
      }
      if (check.compare?.x !== false) expect(Math.abs(reactBox.x - canonicalBox.x), `${state.name}/${key}/${check.name} x delta`).toBeLessThanOrEqual(check.tolerance.x)
      if (check.compare?.y !== false) expect(Math.abs(reactBox.y - canonicalBox.y), `${state.name}/${key}/${check.name} y delta`).toBeLessThanOrEqual(check.tolerance.y)
      if (check.compare?.width !== false) expect(Math.abs(reactBox.width - canonicalBox.width), `${state.name}/${key}/${check.name} width delta`).toBeLessThanOrEqual(check.tolerance.width)
      if (check.compare?.height !== false) expect(Math.abs(reactBox.height - canonicalBox.height), `${state.name}/${key}/${check.name} height delta`).toBeLessThanOrEqual(check.tolerance.height)
    }
    for (const side of ['react', 'canonical'] as const) {
      const order = state.geometryOrder?.[side]
      if (!order) continue
      for (let index = 1; index < order.length; index += 1) {
        const previous = entry.geometry?.[side][order[index - 1]!]
        const current = entry.geometry?.[side][order[index]!]
        if (!previous || !current) continue
        expect(previous.bottom, `${state.name}/${key}/${side} order ${order[index - 1]} before ${order[index]}`).toBeLessThanOrEqual(current.y + 1)
      }
    }
  }
}

type Box = { x: number; y: number; width: number; height: number }

async function measureGeometry(page: Page, checks: GeometryCheck[], side: 'react' | 'canonical') {
  return page.evaluate(({ checks: geometryChecks, side: geometrySide }) => Object.fromEntries(geometryChecks.map((check) => {
    const selector = geometrySide === 'react' ? check.reactSelector : check.canonicalSelector
    const target = document.querySelector<HTMLElement>(selector)
    if (!target) return [check.name, null]
    const rect = target.getBoundingClientRect()
    const styles = getComputedStyle(target)
    return [check.name, {
      x: rect.x, y: rect.y, width: rect.width, height: rect.height,
      right: rect.right, bottom: rect.bottom,
      visible: rect.width > 0 && rect.height > 0 && styles.display !== 'none' && styles.visibility !== 'hidden',
      aspectRatio: rect.height > 0 ? rect.width / rect.height : 0,
      viewport: { width: window.innerWidth, height: window.innerHeight },
    }]
  })), { checks, side })
}

function geometryDeltas(checks: GeometryCheck[], react: Record<string, GeometryBox | null>, canonical: Record<string, GeometryBox | null>) {
  return Object.fromEntries(checks.map((check) => {
    const reactBox = react[check.name]
    const canonicalBox = canonical[check.name]
    return [check.name, {
      present: { react: Boolean(reactBox), canonical: Boolean(canonicalBox) },
      delta: reactBox && canonicalBox
        ? {
            x: reactBox.x - canonicalBox.x,
            y: reactBox.y - canonicalBox.y,
            width: reactBox.width - canonicalBox.width,
            height: reactBox.height - canonicalBox.height,
            aspectRatio: reactBox.aspectRatio - canonicalBox.aspectRatio,
          }
        : { x: null, y: null, width: null, height: null, aspectRatio: null },
    }]
  }))
}

function videoViewerGeometry(canonicalId: string, statusReactSelector: string, statusCanonicalSelector: string, includeRetry = false): GeometryCheck[] {
  return [
    { name: 'frame', reactSelector: '.memoly-detail-surface [data-slot="max-video-frame"]', canonicalSelector: `#${canonicalId} .max-preview-frame`, tolerance: { x: 48, y: 96, width: 48, height: 48 }, expectedAspectRatio: 16 / 9, compare: { x: false, y: false, width: false, height: false } },
    { name: 'status', reactSelector: `.memoly-detail-surface ${statusReactSelector}`, canonicalSelector: `#${canonicalId} ${statusCanonicalSelector}`, tolerance: { x: 64, y: 112, width: 64, height: 32 }, compare: { x: false, y: false, width: false, height: false } },
    ...(includeRetry ? [{ name: 'retry', reactSelector: '.memoly-detail-surface .memoly-video-viewer-v2-retry', canonicalSelector: `#${canonicalId} .state-retry`, tolerance: { x: 64, y: 112, width: 64, height: 32 }, required: { canonical: false }, compare: { x: false, y: false } } satisfies GeometryCheck] : []),
    { name: 'open', reactSelector: '.memoly-detail-surface .memoly-video-viewer-v2-open', canonicalSelector: `#${canonicalId} .state-button`, tolerance: { x: 64, y: 112, width: 64, height: 32 }, compare: { x: false, y: false } },
  ]
}

function composerTolerance(overrides: Partial<GeometryCheck['tolerance']> = {}) {
  // These bounds come from the measured canonical and production shells after the local photo
  // CSS correction. The narrow canonical picker is 30px shorter at 320px; other controls stay
  // within 12px in height and 4px in position or width.
  return { x: 4, y: 4, width: 4, height: 4, ...overrides }
}

function photoGeometry(canonicalId: string, pickerReactSelector: string, pickerCanonicalSelector: string, captionReactSelector: string, captionCanonicalSelector: string): GeometryCheck[] {
  return [
    { name: 'header', reactSelector: '[data-add-screen="photo"] .memoly-add-topbar', canonicalSelector: `#${canonicalId} .composer-topbar`, tolerance: composerTolerance({ height: 4 }) },
    { name: 'picker', reactSelector: `[data-add-screen="photo"] ${pickerReactSelector}`, canonicalSelector: `#${canonicalId} ${pickerCanonicalSelector}`, tolerance: composerTolerance({ height: 32 }) },
    { name: 'caption', reactSelector: `[data-add-screen="photo"] ${captionReactSelector}`, canonicalSelector: `#${canonicalId} ${captionCanonicalSelector}`, tolerance: composerTolerance({ y: 32, height: 12 }) },
    { name: 'date', reactSelector: '[data-add-screen="photo"] .memoly-add-date', canonicalSelector: `#${canonicalId} .date-row`, tolerance: composerTolerance({ y: 44, height: 4 }) },
    { name: 'button', reactSelector: '[data-add-screen="photo"] .memoly-add-publish', canonicalSelector: `#${canonicalId} .composer-primary`, tolerance: composerTolerance({ y: 44, height: 10 }), compare: canonicalId === 'photoSelected' ? { y: false } : undefined },
  ]
}

function noteGeometry(canonicalId: string, editorSelector: string): GeometryCheck[] {
  return [
    { name: 'header', reactSelector: '[data-add-screen="note"] .memoly-add-topbar', canonicalSelector: `#${canonicalId} .composer-topbar`, tolerance: composerTolerance({ height: 4 }) },
    { name: 'editor', reactSelector: `[data-add-screen="note"] ${editorSelector === '.note-editor' ? '.memoly-add-note-field' : editorSelector}`, canonicalSelector: `#${canonicalId} ${editorSelector}`, tolerance: composerTolerance({ height: 56 }) },
    { name: 'date', reactSelector: '[data-add-screen="note"] .memoly-add-date', canonicalSelector: `#${canonicalId} .note-date`, tolerance: composerTolerance({ y: 56, height: 4 }) },
    { name: 'button', reactSelector: '[data-add-screen="note"] .memoly-add-publish', canonicalSelector: `#${canonicalId} .note-primary`, tolerance: composerTolerance({ y: 56, height: 10 }), compare: canonicalId === 'noteFilled' ? { y: false } : undefined },
  ]
}

async function blurFocusedControl(page: Page) {
  await page.evaluate(() => {
    const focused = document.activeElement
    if (focused instanceof HTMLElement) focused.blur()
  })
}

async function applyReactTheme(page: Page, theme: Theme) {
  await page.evaluate((value) => {
    window.localStorage.setItem('memoly-theme', value)
    document.documentElement.dataset.memolyTheme = value
    document.querySelector<HTMLElement>('[data-slot="memoly-theme-root"]')?.setAttribute('data-memoly-theme', value)
  }, theme)
  await expect(page.locator('html')).toHaveAttribute('data-memoly-theme', theme)
}

async function prepareCanonical(page: Page, stateId: string, theme: Theme) {
  await page.goto(`${referenceUrl}#${stateId}`)
  await page.addStyleTag({ content: '*,:before,:after{animation:none!important;transition:none!important;caret-color:transparent!important}' })
  await page.evaluate(() => document.fonts.ready)
  const themeInput = page.locator(`#theme${theme[0]!.toUpperCase()}${theme.slice(1)}`)
  if (await themeInput.count()) await themeInput.evaluate((input: HTMLInputElement) => { input.checked = true; input.dispatchEvent(new Event('change', { bubbles: true })) })
  await page.evaluate(() => window.scrollTo(0, 0))
  await expect(page.locator(`#${stateId}`)).toBeVisible()
}

async function stabilize(page: Page) {
  await page.addStyleTag({ content: '*,:before,:after{animation:none!important;transition:none!important;caret-color:transparent!important}' })
  await page.evaluate(() => document.fonts.ready)
  await page.evaluate(() => window.scrollTo(0, 0))
  expect(await page.evaluate(() => window.devicePixelRatio)).toBe(1)
}

async function measure(page: Page, selector: string) {
  return page.evaluate((targetSelector) => {
    const target = document.querySelector<HTMLElement>(targetSelector)
    if (!target) throw new Error(`Missing visual matrix selector: ${targetSelector}`)
    const rect = target.getBoundingClientRect()
    return {
      viewport: { width: window.innerWidth, height: window.innerHeight },
      scrollWidth: document.documentElement.scrollWidth,
      scrollHeight: document.documentElement.scrollHeight,
      root: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
      clientWidth: target.clientWidth,
      elementScrollWidth: target.scrollWidth,
      text: target.innerText.slice(0, 500),
    }
  }, selector)
}

async function openAddSheet(page: Page) {
  await page.getByRole('button', { name: 'Добавить' }).click()
  await expect(page.locator('[data-slot="memoly-add-sheet-panel"]')).toBeVisible()
}

async function openPhotoEmpty(page: Page) {
  await openAddSheet(page)
  await page.getByRole('button', { name: 'Добавить фото' }).click()
  await expect(page.locator('[data-add-screen="photo"]')).toBeVisible()
}

async function openNoteEmpty(page: Page) {
  await openAddSheet(page)
  await page.getByRole('button', { name: 'Добавить заметку' }).click()
  await expect(page.locator('[data-add-screen="note"]')).toBeVisible()
}

async function openVoiceHandoff(page: Page) {
  await openAddSheet(page)
  await page.getByRole('button', { name: 'Добавить голос или видео' }).click()
  await expect(page.locator('[data-slot="memoly-voice-video-sheet"]')).toBeVisible()
}

async function openVideoMemoryDetail(page: Page) {
  const card = page.locator(`[data-memory-id="${fixture.memoryId}"]`)
  await expect(card).toBeVisible()
  await card.getByRole('button', { name: 'Действия с воспоминанием' }).click()
  await page.getByRole('button', { name: 'Подробнее' }).click()
  await expect(page.locator('.memoly-detail-surface')).toBeVisible()
}

async function installMaxViewerFixture(page: Page, mode: 'loading' | 'error') {
  await page.addInitScript(() => Object.defineProperty(navigator, 'serviceWorker', { configurable: true, get: () => undefined }))
  await page.route('**/api/v1/families/*/memories**', async (route) => {
    const requestUrl = new URL(route.request().url())
    if (requestUrl.searchParams.has('cursor')) return route.continue()
    const response = await route.fetch()
    const payload = await response.json() as { items: Array<Record<string, unknown>>; nextCursor: string | null }
    const first = payload.items[0]
    if (!first) return route.fulfill({ response, body: JSON.stringify(payload) })
    payload.items = [{
      ...first,
      id: fixture.memoryId,
      kind: 'video',
      body: 'MAX visual fixture',
      attachments: [{
        id: randomUUID(), source: 'max', kind: 'video', width: 320, height: 180, durationMs: 18_000,
        playbackPath: `/api/v1/families/${fixture.familyId}/media/max-videos/${randomUUID()}/content`,
      }],
    }]
    await route.fulfill({ response, body: JSON.stringify(payload) })
  })
  let release: (() => void) | null = null
  let playbackRequests = 0
  const pending = new Promise<void>((resolvePending) => { release = resolvePending })
  await page.route('**/api/v1/families/*/media/playback-session', async (route) => {
    playbackRequests += 1
    if (mode === 'loading') {
      await pending
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) })
      return
    }
    await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: { code: 'SYNTHETIC_MAX_PLAYBACK_FAILURE' } }) })
  })
  return { release: () => release?.(), playbackRequestCount: () => playbackRequests }
}

async function seedVisualFixture(): Promise<Fixture> {
  subject = await allocateSyntheticSubject()
  const familyId = randomUUID()
  const childId = randomUUID()
  let userId: string | undefined
  try {
    await prisma.pilotAdmission.create({ data: { provider: 'telegram', subject } })
    const user = await prisma.user.create({ data: { displayName: 'Матрица L E2E' } })
    userId = user.id
    await prisma.externalIdentity.create({ data: { userId: user.id, provider: 'telegram', subject } })
    await prisma.$transaction(async (tx) => {
      await tx.family.create({ data: { id: familyId, ownerUserId: user.id, name: 'Синтетическая семья L', timezone: 'Europe/Moscow' } })
      await tx.familyMember.create({ data: { familyId, userId: user.id, role: 'full' } })
    })
    await prisma.child.create({ data: { id: childId, familyId, displayName: 'Лиза', birthDate: new Date('2024-02-29T00:00:00.000Z'), sex: 'girl' } })
    const memory = await prisma.memory.create({ data: { familyId, childId, authorId: user.id, kind: 'note', body: 'MAX visual seed', occurredAt: new Date('2026-09-20T06:00:00.000Z') } })
    return { familyId, childId, userId: user.id, memoryId: memory.id, subject }
  } catch (error) {
    await cleanupVisualFixture({ familyId, userId, subject })
    throw error
  }
}

async function allocateSyntheticSubject() {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const candidate = String(9_000_000_000 + randomInt(1_000_000_000))
    const [identity, admission] = await prisma.$transaction([
      prisma.externalIdentity.findUnique({ where: { provider_subject: { provider: 'telegram', subject: candidate } }, select: { id: true } }),
      prisma.pilotAdmission.findUnique({ where: { provider_subject: { provider: 'telegram', subject: candidate } }, select: { id: true } }),
    ])
    if (!identity && !admission) return candidate
  }
  throw new Error('Unable to allocate a unique synthetic Telegram subject for the visual matrix')
}

async function cleanupVisualFixture(candidate: Partial<Fixture>) {
  if (candidate.familyId) await prisma.family.deleteMany({ where: { id: candidate.familyId } })
  if (candidate.userId) {
    await prisma.externalIdentity.deleteMany({ where: { userId: candidate.userId } })
    await prisma.authSession.deleteMany({ where: { userId: candidate.userId } })
    await prisma.user.deleteMany({ where: { id: candidate.userId } })
  }
  if (candidate.subject) await prisma.pilotAdmission.deleteMany({ where: { provider: 'telegram', subject: candidate.subject } })
}

function assertCanonicalIntegrity() {
  const contents = readFileSync(canonicalPath)
  expect(createHash('sha256').update(contents).digest('hex')).toBe(canonicalSha)
  expect(contents.byteLength).toBe(13_528_494)
}

function generatedVideo() {
  const result = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=orange:s=320x180:d=2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-movflags', 'frag_keyframe+empty_moov', '-f', 'mp4', 'pipe:1'], { encoding: 'buffer', maxBuffer: 10_000_000 })
  if (result.status !== 0) throw new Error(`synthetic video fixture failed: ${result.stderr.toString()}`)
  return result.stdout
}

function generatedPhoto(index: number) {
  const colors = ['#f28b82', '#81c995', '#8ab4f8', '#fdd663']
  const result = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', `color=c=${colors[(index - 1) % colors.length]}:s=32x24:d=0.1`, '-frames:v', '1', '-f', 'image2', 'pipe:1'], { encoding: 'buffer', maxBuffer: 1_000_000 })
  if (result.status !== 0) throw new Error(`synthetic photo fixture failed: ${result.stderr.toString()}`)
  return result.stdout
}

function signedInitData(id: number, name: string, startParam?: string) {
  const fields = new URLSearchParams({ auth_date: String(Math.floor(Date.now() / 1_000)), query_id: randomUUID(), user: JSON.stringify({ id, first_name: name }) })
  if (startParam) fields.set('start_param', startParam)
  const dataCheckString = [...fields.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([key, value]) => `${key}=${value}`).join('\n')
  const secret = createHmac('sha256', 'WebAppData').update('123456:web-e2e-synthetic-token').digest()
  fields.set('hash', createHmac('sha256', secret).update(dataCheckString).digest('hex'))
  return fields.toString()
}

async function installTelegramHost(page: Page, initData: string) {
  await page.route(/telegram\.org\/js\/telegram-web-app\.js(?:\?.*)?$/, (route) => route.fulfill({ status: 200, contentType: 'application/javascript', body: '' }))
  await page.addInitScript((value) => {
    const backHandlers = new Set<() => void>()
    Object.defineProperty(window, 'Telegram', { configurable: true, value: { WebApp: {
      initData: value, version: '8.0', platform: 'tdesktop', safeAreaInset: { top: 0, bottom: 0 }, contentSafeAreaInset: { top: 0, bottom: 0 },
      BackButton: { show() {}, hide() {}, onClick(handler: () => void) { backHandlers.add(handler) }, offClick(handler: () => void) { backHandlers.delete(handler) } }, ready() {},
    } } })
  }, initData)
}

async function installMaxHost(page: Page, initData: string) {
  await page.addInitScript((value) => {
    Object.defineProperty(window, 'WebApp', { configurable: false, get: () => ({ initData: value, version: '1.0', platform: 'desktop', ready() {}, openLink() {} }) })
  }, initData)
}

async function installMaxAuthRoute(page: Page) {
  await page.route('**/api/v1/auth/max', async (route) => {
    const response = await route.fetch({ method: 'POST', url: `${backendUrl}/api/v1/auth/telegram`, postData: route.request().postData() ?? undefined, headers: { 'content-type': 'application/json' } })
    await route.fulfill({ response })
  })
}
