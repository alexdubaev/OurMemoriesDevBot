import { expect, test } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

const evidenceDir = fileURLToPath(new URL('./.artifacts/memoly-v4-evidence/', import.meta.url))

function contrastRatio(foreground: string, background: string) {
  const luminance = (color: string) => {
    const channels = color.match(/[\d.]+/g)?.slice(0, 3).map(Number)
    if (!channels || channels.length !== 3) throw new Error(`Expected an RGB color, got ${color}`)
    const [r, g, b] = channels.map((channel) => {
      const normalized = channel / 255
      return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4
    })
    return 0.2126 * r + 0.7152 * g + 0.0722 * b
  }
  const [high, low] = [luminance(foreground), luminance(background)].sort((a, b) => b - a)
  return (high + 0.05) / (low + 0.05)
}

test('actual feed shell matches canonical responsive geometry and captures computed evidence', async ({ page }, testInfo) => {
  await page.clock.install({ time: new Date('2026-10-17T12:00:00.000Z') })
  const records = []
  for (const viewport of [{ width: 390, height: 844 }, { width: 320, height: 844 }, { width: 430, height: 932 }]) {
    await page.setViewportSize(viewport)
    await page.goto('/e2e/memoly-v4.harness.html')
    const header = page.locator('.ui-v2-child-header')
    const media = page.locator('.memory-card').first().locator('.memoly-mixed-viewport')
    const nav = page.locator('nav[data-bottom-navigation-appearance="memoly"]')
    await expect(header).toBeVisible()
    await expect(media).toBeVisible()
    await expect(page.locator('.memory-card').first().locator('.ml-media-button').first()).toBeVisible()
    await expect(nav).toBeVisible()
    await expect(page.getByRole('button', { name: 'Настройки' })).toBeVisible()
    const geometry = await page.evaluate(() => {
      const rect = (selector: string) => {
        const el = document.querySelector<HTMLElement>(selector)
        if (!el) return null
        const r = el.getBoundingClientRect(); const s = getComputedStyle(el)
        return { x: r.x, y: r.y, width: r.width, height: r.height, font: s.fontFamily, fontSize: s.fontSize, color: s.color, background: s.backgroundColor }
      }
      const media = document.querySelector('.memory-card .memoly-mixed-viewport')!
      const card = document.querySelector('.memory-card')!
      const nav = document.querySelector('nav[data-bottom-navigation-appearance="memoly"]')!
      const identity = document.querySelector('.ui-v2-child-identity-button')!.getBoundingClientRect()
      const gear = document.querySelector('.ui-v2-settings')!.getBoundingClientRect()
      const controls = card.querySelector<HTMLElement>('.memoly-mixed-controls')!.getBoundingClientRect()
      const mediaButton = media.querySelector<HTMLElement>('.ml-media-button')!
      const reactionLabel = card.querySelector<HTMLElement>('.ui-v2-reaction-button > span')!
      const activeNavLabel = nav.querySelector<HTMLElement>('[data-nav-position="home"][data-v2-active="true"] > span')!
      const activeNav = nav.querySelector<HTMLElement>('[data-nav-position="home"][data-v2-active="true"]')!
      const addCircle = nav.querySelector<HTMLElement>('.memoly-nav-add-circle')!
      const addIcon = addCircle.querySelector<HTMLElement>('[data-slot="webp-icon"]')!
      const addLabel = nav.querySelector<HTMLElement>('[data-nav-position="add"] > [data-slot="typography"]')!
      const homeIcon = activeNav.querySelector<HTMLElement>('[data-slot="webp-icon"]')!
      const childNameText = document.querySelector<HTMLElement>('.ui-v2-child-name-text')!
      const box = (r: DOMRect) => ({ x: r.x, y: r.y, width: r.width, height: r.height })
      const navHitTargets = [...nav.querySelectorAll<HTMLElement>('[data-nav-position]')].map((element) => ({ position: element.dataset.navPosition, ...box(element.getBoundingClientRect()) }))
      if (!mediaButton) throw new Error('Missing media button')
      if (!reactionLabel) throw new Error('Missing reaction label')
      if (!activeNavLabel) throw new Error('Missing active navigation label')
      const navStyle = getComputedStyle(nav)
      const navPanelStyle = getComputedStyle(nav.firstElementChild!)
      return { viewport: { width: innerWidth, height: innerHeight }, header: rect('.ui-v2-child-header'), firstMedia: rect('.memory-card .memoly-mixed-viewport'), navigation: rect('nav[data-bottom-navigation-appearance="memoly"]'), navHitTargets, navBackground: navStyle.backgroundColor, appCanvas: getComputedStyle(document.querySelector('.memoly-app-root')!).backgroundColor, navPanelBackground: navPanelStyle.backgroundColor, navDivider: { width: navStyle.borderTopWidth, style: navStyle.borderTopStyle, color: navStyle.borderTopColor }, navPanelDivider: { width: navPanelStyle.borderTopWidth, style: navPanelStyle.borderTopStyle }, controls: box(controls), mediaBackground: getComputedStyle(mediaButton).backgroundColor, reactionFontSize: getComputedStyle(reactionLabel).fontSize, activeNavFontWeight: getComputedStyle(activeNavLabel).fontWeight, activeIndicator: { width: getComputedStyle(activeNav, '::before').width, height: getComputedStyle(activeNav, '::before').height, content: getComputedStyle(activeNav, '::before').content }, navGlyphSize: box(homeIcon.getBoundingClientRect()), addCircleColor: getComputedStyle(addCircle).color, addCircleBackground: getComputedStyle(addCircle).backgroundColor, addIconColor: getComputedStyle(addIcon).backgroundColor, addGlyphSize: box(addIcon.getBoundingClientRect()), addLabelSize: getComputedStyle(addLabel).fontSize, childNameText: { fontSize: getComputedStyle(childNameText).fontSize, lineHeight: getComputedStyle(childNameText).lineHeight, weight: getComputedStyle(childNameText).fontWeight, letterSpacing: getComputedStyle(childNameText).letterSpacing }, sheetRadius: getComputedStyle(document.documentElement).getPropertyValue('--ui-v2-radius-sheet').trim(), identity: box(identity), gear: box(gear), theme: document.documentElement.dataset.memolyTheme, role: 'full', insets: { top: 0, bottom: 0 } }
    })
    records.push(geometry)
    expect(geometry.navigation!.height).toBe(50)
    expect(geometry.navHitTargets.every((target) => target.width >= 44 && target.height >= 44)).toBe(true)
    if (viewport.width === 390) {
      const h = geometry.header!, m = geometry.firstMedia!, n = geometry.navigation!
      expect(h.x).toBe(0); expect(h.y).toBe(0); expect(h.width).toBe(390); expect(h.height).toBe(96)
      expect(m.x).toBe(16); expect(m.width).toBe(358); expect(m.height).toBeCloseTo(216.19, 0); expect(m.y).toBeGreaterThanOrEqual(175); expect(m.y).toBeLessThanOrEqual(176)
      expect(n.x).toBe(0); expect(n.y).toBe(794); expect(n.height).toBe(50)
      expect(geometry.navBackground).toBe(geometry.navPanelBackground)
      expect(geometry.navDivider).toMatchObject({ width: '1px', style: 'solid' })
      expect(geometry.navPanelDivider.width).toBe('0px')
      expect(geometry.navPanelBackground).toBe('rgb(255, 254, 250)')
      expect(geometry.controls.height).toBe(24)
      expect(geometry.mediaBackground).toBe('rgb(233, 237, 230)')
      expect(geometry.reactionFontSize).toBe('11px')
      expect(geometry.activeNavFontWeight).toBe('700')
      expect(geometry.activeIndicator).toMatchObject({ width: '22px', height: '2px', content: '""' })
      expect(geometry.navGlyphSize).toMatchObject({ width: 20, height: 20 })
      expect(geometry.addCircleColor).toBe('rgb(255, 255, 255)')
      expect(contrastRatio(geometry.addCircleColor, geometry.addCircleBackground)).toBeGreaterThanOrEqual(4.5)
      expect(geometry.addIconColor).toBe('rgb(255, 255, 255)')
      expect(geometry.addGlyphSize).toMatchObject({ width: 20, height: 20 })
      expect(geometry.addLabelSize).toBe('10px')
      expect(geometry.childNameText).toMatchObject({ fontSize: '20px', lineHeight: '22px', weight: '680', letterSpacing: '-0.6px' })
      expect(geometry.sheetRadius).toBe('19px')
      expect(geometry.identity.x + geometry.identity.width).toBeLessThanOrEqual(geometry.gear.x)
      expect(geometry.gear.width).toBe(44)
    }
    if (viewport.width === 320) { expect(geometry.firstMedia!.x).toBe(14); expect(geometry.firstMedia!.width).toBe(292); expect(geometry.childNameText).toMatchObject({ fontSize: '19px', lineHeight: '20.9px', weight: '680', letterSpacing: '-0.6px' }) }
    if (viewport.width === 430) { expect(geometry.firstMedia!.x).toBe(16); expect(geometry.firstMedia!.width).toBe(398) }
    await page.screenshot({ path: testInfo.outputPath(`feed-${viewport.width}.png`), fullPage: true })
    if (viewport.width === 390) {
      await page.getByRole('button', { name: 'Настройки' }).click()
      await expect(page.locator('.ml-settings-sheet[data-view="menu"]')).toBeVisible()
    }
  }
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/e2e/memoly-v4.harness.html?top=12&bottom=20')
  await expect(page.locator('.ui-v2-child-header-frame')).toBeVisible()
  await expect(page.locator('nav[data-bottom-navigation-appearance="memoly"]')).toBeVisible()
  await expect(page.locator('.memory-card .memoly-mixed-viewport').first()).toBeVisible()
  const insetGeometry = await page.evaluate(() => {
    const rect = (selector: string) => { const r = document.querySelector(selector)!.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height } }
    return { header: rect('.ui-v2-child-header'), media: rect('.memory-card .memoly-mixed-viewport'), nav: rect('nav[data-bottom-navigation-appearance="memoly"]') }
  })
  expect(insetGeometry.header.y).toBe(12)
  expect(insetGeometry.media.y).toBe(187)
  expect(insetGeometry.nav).toMatchObject({ y: 774, height: 70 })
  for (const [hostBottom, expectedNav] of [[0, 70], [12, 70], [34, 84]] as const) {
    await page.goto(`/e2e/memoly-v4.harness.html?bottom=${hostBottom}`)
    await expect(page.locator('nav[data-bottom-navigation-appearance="memoly"]')).toBeVisible()
    await page.addStyleTag({ content: '.memoly-app-root { --ui-v2-browser-safe-area-bottom: 20px !important; }' })
    const safeGeometry = await page.evaluate(() => {
      const nav = document.querySelector('nav[data-bottom-navigation-appearance="memoly"]')!
      const app = document.querySelector('[data-memoly-feed] .app')!
      const navDividerWidth = Number.parseFloat(getComputedStyle(nav).borderTopWidth)
      const gridHeight = nav.firstElementChild!.getBoundingClientRect().height
      return { navHeight: nav.getBoundingClientRect().height, panelHeight: gridHeight + navDividerWidth, gridHeight, navBackground: getComputedStyle(nav).backgroundColor, navPanelBackground: getComputedStyle(nav.firstElementChild!).backgroundColor, navDividerWidth, navPanelDividerWidth: getComputedStyle(nav.firstElementChild!).borderTopWidth, appPaddingBottom: Number.parseFloat(getComputedStyle(app).paddingBottom) }
    })
    expect(safeGeometry.navHeight).toBe(expectedNav)
    expect(safeGeometry.panelHeight).toBe(50)
    expect(safeGeometry.gridHeight).toBe(49)
    expect(safeGeometry.navBackground).toBe(safeGeometry.navPanelBackground)
    expect(safeGeometry.navDividerWidth).toBe(1)
    expect(safeGeometry.navPanelDividerWidth).toBe('0px')
    expect(safeGeometry.appPaddingBottom).toBe(78 + Math.max(hostBottom, 20))
  }
  for (const [width, height] of [[320, 844], [390, 844], [430, 932]] as const) {
    await page.setViewportSize({ width, height })
    await page.goto('/e2e/memoly-v4.harness.html?bottom=34')
    await page.addStyleTag({ content: '.memoly-app-root { --ui-v2-browser-safe-area-bottom: 20px !important; }' })
    const safeNav = await page.locator('nav[data-bottom-navigation-appearance="memoly"]').evaluate((nav) => {
      const r = nav.getBoundingClientRect(); const panel = nav.firstElementChild!.getBoundingClientRect()
      return { x: r.x, y: r.y, width: r.width, height: r.height, panelHeight: panel.height + Number.parseFloat(getComputedStyle(nav).borderTopWidth), gridHeight: panel.height }
    })
    expect(safeNav).toMatchObject({ x: 0, y: height - 84, width, height: 84, panelHeight: 50 })
    expect(safeNav.gridHeight).toBe(49)
  }
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/e2e/memoly-v4.harness.html?bottom=34')
  await page.addStyleTag({ content: '.memoly-app-root { --ui-v2-browser-safe-area-bottom: 20px !important; }' })
  await page.locator('.memory-card').last().scrollIntoViewIfNeeded()
  const lastCardClearance = await page.evaluate(() => {
    const card = document.querySelectorAll<HTMLElement>('.memory-card').item(5).getBoundingClientRect()
    const nav = document.querySelector('nav[data-bottom-navigation-appearance="memoly"]')!.getBoundingClientRect()
    return { cardBottom: card.bottom, navTop: nav.top }
  })
  expect(lastCardClearance.cardBottom).toBeLessThanOrEqual(lastCardClearance.navTop - 28 + 1)
  await mkdir(evidenceDir, { recursive: true })
  const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: fileURLToPath(new URL('../..', import.meta.url)), encoding: 'utf8' }).trim()
  const status = execFileSync('git', ['status', '--short'], { cwd: fileURLToPath(new URL('../..', import.meta.url)), encoding: 'utf8' })
  await writeFile(`${evidenceDir}/feed-geometry.json`, JSON.stringify({ sourceHead: head, workingTreeDirty: Boolean(status.trim()), browsers: 'Playwright Chromium', records }, null, 2))
})

test('publication attribution renders the shared channel avatar, glyph fallback, cropped member avatar, and legacy author fallback for viewers', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/e2e/memoly-v4.harness.html?attribution&role=viewer')
  await expect(page.locator('[data-nav-viewer="true"]')).toBeVisible()
  const cards = page.locator('.memory-card')
  await expect(cards).toHaveCount(6)

  const channelCard = cards.nth(0)
  await expect(channelCard.locator('.author-name')).toHaveText('Канал прогулок')
  const channelAvatar = channelCard.locator('.publication-channel-avatar img')
  await expect(channelAvatar).toBeVisible()
  await expect.poll(() => channelAvatar.evaluate((element) => {
    const image = element as HTMLImageElement
    return image.complete && image.naturalWidth > 0
  })).toBe(true)
  expect(await channelAvatar.getAttribute('style')).toBeNull()
  const channelAvatarPath = '/api/v1/families/11111111-1111-4111-8111-111111111111/media/max-channels/1234567890123456789/avatar'
  const fallbackChannel = cards.nth(3)
  const channelGlyph = fallbackChannel.locator('.publication-channel-avatar img')
  await expect(channelGlyph).toHaveAttribute('src', /channel-default@2x\.webp$/)
  await expect.poll(() => channelGlyph.evaluate((element) => {
    const image = element as HTMLImageElement
    return image.complete && image.naturalWidth > 0
  })).toBe(true)
  const userCard = cards.nth(1)
  await expect(userCard.locator('.author-name')).toHaveText('Мама семьи')
  const userAvatar = userCard.locator('.author-avatar img')
  await expect(userAvatar).toBeVisible()
  await expect.poll(() => userAvatar.evaluate((element) => {
    const image = element as HTMLImageElement
    return image.complete && image.naturalWidth > 0
  })).toBe(true)
  await expect.poll(() => userAvatar.evaluate((image) =>
    Number.parseFloat(getComputedStyle(image).width) > image.parentElement!.clientWidth)).toBe(true)
  const requests = await page.evaluate(() => (window as typeof window & { __memolyV4RawRequests?: string[] }).__memolyV4RawRequests ?? [])
  expect(requests.filter((path) => path === channelAvatarPath)).toHaveLength(1)
  await expect(cards.nth(2).locator('.author-name')).toHaveText('Профильный папа')
  await channelCard.locator('[data-carousel-position="1"] button').click()
  const mixedViewer = page.locator('[data-mixed-viewer]')
  await expect(mixedViewer).toBeVisible()
  await expect(mixedViewer.locator('.memoly-viewer-author span').first()).toHaveText('Канал прогулок')
  await page.keyboard.press('ArrowRight')
  await expect(mixedViewer.locator('.memoly-mixed-viewer-bar span').last()).toHaveText('2 / 3')
  await page.keyboard.press('ArrowLeft')
  await expect(mixedViewer.locator('.memoly-mixed-viewer-bar span').last()).toHaveText('1 / 3')
  await mixedViewer.getByRole('button', { name: 'Закрыть просмотр' }).click()
  await expect(mixedViewer).toHaveCount(0)
  await expect(channelCard).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('publication-attribution.png'), fullPage: false })
})

test('family presentation keeps canonical geometry, role variants, long names and settings artwork', async ({ page }, testInfo) => {
  for (const query of ['?family=1&role=owner&members=2', '?family=1&role=full&members=10', '?family=1&role=viewer&members=2']) {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto(`/e2e/memoly-v4.harness.html${query}`)
    await expect(page.locator('.family-screen')).toBeVisible()
    await expect(page.locator('.ui-v2-family-toolbar')).toBeVisible()
    await expect(page.getByText('Подключён')).toBeVisible()
    const familyNav = page.locator('nav[data-bottom-navigation-appearance="memoly"]')
    expect((await familyNav.boundingBox())?.height).toBe(50)
    const familyTargets = await familyNav.locator('[data-nav-position]').evaluateAll((items) => items.map((item) => { const r = item.getBoundingClientRect(); return { width: r.width, height: r.height } }))
    expect(familyTargets.every((target) => target.width >= 44 && target.height >= 44)).toBe(true)
    await expect(page.locator('.family-member-row')).toHaveCount(query.includes('members=10') ? 10 : 2)
    const canWrite = !query.includes('role=viewer')
    await expect(page.locator('.family-invite-btn')).toHaveCount(canWrite ? 1 : 0)
    await expect(page.locator('[data-nav-position="viewer"]')).toHaveCount(canWrite ? 0 : 1)
    if (canWrite) await expect(familyNav.getByRole('button', { name: 'Добавить' })).toBeVisible()
    else await expect(familyNav.getByRole('img', { name: 'Режим просмотра' })).toBeVisible()
    if (query.includes('role=full')) {
      await expect(page.getByText('Полный доступ').first()).toBeVisible()
      await expect(page.locator('.family-leave-action')).toBeVisible()
    }
    if (query.includes('role=owner')) {
      const indicators = await page.evaluate(() => ({
        home: getComputedStyle(document.querySelector<HTMLElement>('[data-nav-position="home"]')!, '::before').display,
        family: getComputedStyle(document.querySelector<HTMLElement>('[data-nav-position="family"]')!, '::before').display,
      }))
      expect(indicators).toEqual({ home: 'none', family: 'block' })
      const geometry = await page.evaluate(() => {
        const rect = (selector: string) => { const r = document.querySelector(selector)!.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height } }
        return { toolbar: rect('.ui-v2-family-toolbar'), profile: rect('.ui-v2-family-child-profile'), heading: rect('.family-section-head'), firstMember: rect('.family-member-row'), invite: rect('.family-invite-btn'), archive: rect('.family-max-channel-row') }
      })
      expect(geometry.toolbar).toMatchObject({ x: 16, y: 0, width: 358, height: 58 })
      expect(geometry.profile).toMatchObject({ x: 16, y: 70, width: 358, height: 96 })
      expect(geometry.heading).toMatchObject({ x: 16, y: 191, width: 358, height: 21 })
      expect(geometry.firstMember).toMatchObject({ x: 16, y: 221, width: 358, height: 71 })
      expect(geometry.invite).toMatchObject({ x: 16, y: 379, width: 358, height: 46 })
      expect(geometry.archive).toMatchObject({ x: 16, y: 487, width: 358, height: 69 })
      expect(await page.locator('.ui-v2-family-profile-link').evaluate((element) => getComputedStyle(element).fontSize)).toBe('11px')
      await page.screenshot({ path: testInfo.outputPath('family-owner-390.png'), fullPage: true })
      await page.locator('.ui-v2-settings').click()
      await page.getByRole('button', { name: /Оформление/ }).first().click()
      await expect(page.locator('.ml-theme-artwork[src="/assets/theme-header/lavender.webp"]')).toBeVisible()
    }
  }
  await page.setViewportSize({ width: 320, height: 844 })
  await page.goto('/e2e/memoly-v4.harness.html?family=1&role=owner&members=2')
  await expect(page.locator('.family-screen')).toBeVisible()
  const narrow = await page.locator('.ui-v2-family-toolbar').boundingBox()
  expect(narrow).toMatchObject({ x: 14, y: 0, width: 292, height: 58 })
  await page.screenshot({ path: testInfo.outputPath('family-owner-320.png'), fullPage: true })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/e2e/memoly-v4.harness.html?family=1&role=owner&members=2&top=12')
  await expect(page.locator('.family-screen')).toBeVisible()
  const insetFamilyHeader = await page.locator('.ui-v2-family-toolbar').boundingBox()
  const insetFamilyProfile = await page.locator('.ui-v2-family-child-profile').boundingBox()
  expect(insetFamilyHeader?.y).toBe(12)
  expect(insetFamilyProfile?.y).toBe(82)
  await page.addStyleTag({ content: '.memoly-app-root { --ui-v2-browser-safe-area-bottom: 20px !important; }' })
  expect(await page.locator('.family-screen').evaluate((element) => Number.parseFloat(getComputedStyle(element).paddingBottom))).toBe(70)
})

test('pagination controls remain 24px targets and 200% text has no horizontal overflow', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/e2e/memoly-v4.harness.html')
  const album = page.locator('.memory-card').nth(3)
  await album.scrollIntoViewIfNeeded()
  await expect(album.locator('[data-carousel-dot]')).toHaveCount(3)
  const target = await album.locator('[data-carousel-dot]').first().boundingBox()
  expect(target?.height).toBeGreaterThanOrEqual(24)
  const initialNameSize = await page.locator('.ui-v2-child-name').evaluate((element) => Number.parseFloat(getComputedStyle(element).fontSize))
  await page.addStyleTag({ content: 'html { font-size: 200% !important; }' })
  const scaledNameSize = await page.locator('.ui-v2-child-name').evaluate((element) => Number.parseFloat(getComputedStyle(element).fontSize))
  expect(scaledNameSize).toBeGreaterThanOrEqual(initialNameSize * 1.9)
  const navFit = await page.locator('nav[data-bottom-navigation-appearance="memoly"]').evaluate((nav) => {
    const row = nav.querySelector<HTMLElement>('[data-nav-position="home"]')!
    const label = row.querySelector<HTMLElement>(':scope > span')!
    const rowRect = row.getBoundingClientRect(); const labelRect = label.getBoundingClientRect()
      return { navHeight: nav.getBoundingClientRect().height, rowHeight: rowRect.height, rowScrollHeight: row.scrollHeight, labelBottom: labelRect.bottom, rowBottom: rowRect.bottom }
  })
  expect(navFit.labelBottom).toBeLessThanOrEqual(navFit.rowBottom)
  expect(navFit.navHeight).toBeGreaterThanOrEqual(68)
  expect(navFit.rowScrollHeight).toBeLessThanOrEqual(navFit.rowHeight)
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
  await page.goto('/e2e/memoly-v4.harness.html?top=12&bottom=20')
  await expect(page.locator('.ui-v2-child-header')).toBeVisible()
  const insetNav = await page.locator('nav[data-bottom-navigation-appearance="memoly"]').boundingBox()
  expect(insetNav).toMatchObject({ y: 774, height: 70 })
})

test('bottom navigation visuals follow the effective inset while preserving hit-area geometry', async ({ page }) => {
  const insetCases = [
    { host: 0, browser: 0, effective: 0 },
    { host: 1, browser: 0, effective: 1 },
    { host: 2, browser: 0, effective: 2 },
    { host: 3, browser: 0, effective: 3 },
    { host: 34, browser: 0, effective: 34 },
    { host: 0, browser: 1, effective: 1 },
    { host: 0, browser: 2, effective: 2 },
    { host: 0, browser: 3, effective: 3 },
    { host: 0, browser: 34, effective: 34 },
    { host: 3, browser: 1, effective: 3 },
    { host: 1, browser: 3, effective: 3 },
    { host: 34, browser: 3, effective: 34 },
    { host: 3, browser: 34, effective: 34 },
  ]
  const views = [
    { name: 'feed', query: '' },
    { name: 'family', query: '&family=1&role=owner&members=2' },
    { name: 'viewer', query: '&family=1&role=viewer&members=2' },
  ]

  for (const width of [320, 390, 430]) {
    const height = width === 430 ? 932 : 844
    await page.setViewportSize({ width, height })
    for (const view of views) {
      for (const inset of insetCases) {
        const coreInset = (inset.host === 0 && inset.browser === 0) || (inset.host === 34 && inset.browser === 0)
        if (view.name === 'viewer' && (width !== 390 || !coreInset)) continue
        if (view.name === 'family' && !coreInset) continue
        if (view.name === 'feed' && width !== 390 && !coreInset) continue
        await page.goto(`/e2e/memoly-v4.harness.html?bottom=${inset.host}${view.query}`)
        await page.addStyleTag({ content: `.memoly-app-root { --ui-v2-browser-safe-area-bottom: ${inset.browser}px !important; }` })
        const geometry = await page.locator('nav[data-bottom-navigation-appearance="memoly"]').evaluate((nav) => {
          const box = (element: Element) => {
            const rect = element.getBoundingClientRect()
            return { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
          }
          const positions = [...nav.querySelectorAll<HTMLElement>('[data-nav-position]')]
          const visualElements = positions.flatMap((position) => [...position.children].flatMap((child) => {
            const nodes: HTMLElement[] = []
            if (child instanceof HTMLElement && child.matches('[data-slot="webp-icon"], [data-slot="typography"], .memoly-nav-add-circle')) nodes.push(child)
            if (child instanceof HTMLElement && child.matches('.memoly-nav-add-circle')) {
              const icon = child.querySelector<HTMLElement>('[data-slot="webp-icon"]')
              if (icon) nodes.push(icon)
            }
            return nodes.map((element) => ({
              element,
              position: position.dataset.navPosition,
              slot: element.classList.contains('memoly-nav-add-circle') ? 'circle' : element.dataset.slot === 'webp-icon' && element.parentElement?.classList.contains('memoly-nav-add-circle') ? 'add-icon' : element.dataset.slot,
            }))
          }))
          const collect = () => ({
            nav: box(nav),
            panel: box(nav.firstElementChild!),
            paddingBottom: getComputedStyle(nav).paddingBottom,
            divider: { width: getComputedStyle(nav).borderTopWidth, style: getComputedStyle(nav).borderTopStyle, color: getComputedStyle(nav).borderTopColor },
            buttons: positions.map((position) => ({
              position: position.dataset.navPosition,
              box: box(position),
              indicator: (() => {
                const style = getComputedStyle(position, '::before')
                return { display: style.display, top: style.top, width: style.width, height: style.height, content: style.content }
              })(),
            })),
            visuals: visualElements.map((visual) => ({ position: visual.position, slot: visual.slot, box: box(visual.element), fontSize: getComputedStyle(visual.element).fontSize, lineHeight: getComputedStyle(visual.element).lineHeight })),
          })
          const savedStyles = visualElements.map(({ element }) => ({ element, top: element.style.getPropertyValue('top'), priority: element.style.getPropertyPriority('top') }))
          for (const { element } of visualElements) element.style.setProperty('top', '0px', 'important')
          const baseline = collect()
          for (const saved of savedStyles) {
            if (saved.top) saved.element.style.setProperty('top', saved.top, saved.priority)
            else saved.element.style.removeProperty('top')
          }
          return { baseline, aligned: collect(), viewportHeight: innerHeight }
        })

        expect(geometry.aligned.nav.height).toBe(50 + inset.effective)
        expect(geometry.aligned.panel.height).toBe(49)
        expect(geometry.aligned.nav).toEqual(geometry.baseline.nav)
        expect(geometry.aligned.panel).toEqual(geometry.baseline.panel)
        expect(geometry.aligned.paddingBottom).toBe(geometry.baseline.paddingBottom)
        expect(geometry.aligned.divider).toEqual(geometry.baseline.divider)
        expect(geometry.aligned.buttons).toEqual(geometry.baseline.buttons)
        expect(geometry.aligned.buttons.every((button) => button.box.width >= 44 && button.box.height >= 44)).toBe(true)

        const expectedOffset = Math.min(5, 2 + inset.effective)
        expect(geometry.aligned.visuals).toHaveLength(geometry.baseline.visuals.length)
        for (let index = 0; index < geometry.aligned.visuals.length; index += 1) {
          const before = geometry.baseline.visuals[index]
          const after = geometry.aligned.visuals[index]
          expect(after.position).toBe(before.position)
          expect(after.slot).toBe(before.slot)
          expect(after.box.x).toBe(before.box.x)
          expect(after.box.width).toBe(before.box.width)
          expect(after.box.height).toBe(before.box.height)
          expect(after.box.y - before.box.y).toBe(expectedOffset)
          expect(after.fontSize).toBe(before.fontSize)
          expect(after.lineHeight).toBe(before.lineHeight)
          if (after.slot === 'typography') expect(after.box.y + after.box.height).toBeLessThanOrEqual(geometry.viewportHeight)
        }
      }
    }
  }
})

test('PhotoSwipe photo-only viewer reuses its loaded slide URLs for caption and thumbnail navigation', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/e2e/memoly-v4.harness.html')
  const album = page.locator('.memory-card').nth(3)
  await album.scrollIntoViewIfNeeded()
  await album.getByRole('button', { name: 'Открыть фото' }).click()
  const thumbnails = page.locator('.pswp__memoly-thumbnail')
  await expect(thumbnails).toHaveCount(3)
  await expect(page.locator('.pswp__memoly-caption')).toHaveText('Фотографии из парка')
  await expect.poll(() => thumbnails.locator('img').evaluateAll((images) => images.every((image) => image instanceof HTMLImageElement && image.complete && image.naturalWidth > 0 && image.src.startsWith('blob:')))).toBe(true)
  const requestsBeforeNavigation = await page.evaluate(() => (window as typeof window & { __memolyV4RawRequests?: string[] }).__memolyV4RawRequests?.filter((url) => /000000000004|000000000005|000000000006/.test(url)) ?? [])
  await thumbnails.nth(1).click()
  await expect(thumbnails.nth(1)).toHaveAttribute('aria-pressed', 'true')
  await expect(page.locator('.pswp__counter')).toContainText('2')
  await expect.poll(() => page.evaluate(() => (window as typeof window & { __memolyV4RawRequests?: string[] }).__memolyV4RawRequests?.filter((url) => /000000000004|000000000005|000000000006/.test(url)) ?? [])).toHaveLength(requestsBeforeNavigation.length + 1)
  const indexedRequests = await page.evaluate(() => (window as typeof window & { __memolyV4RawRequests?: string[] }).__memolyV4RawRequests?.filter((url) => /000000000004|000000000005|000000000006/.test(url)) ?? [])
  expect(indexedRequests.at(-1)).toMatch(/000000000006$/)
})

test('photo loading failure and retry keep the reserved media and next-card geometry stable', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/e2e/memoly-v4.harness.html')
  const card = page.locator('.memory-card').first()
  await card.scrollIntoViewIfNeeded()
  const photo = card.getByRole('button', { name: 'Открыть фото' }).first()
  await expect(photo).toHaveAttribute('data-seen-ready', 'true')
  await page.evaluate(() => Object.assign(window, { __memolyV4PhotoRawControl: { target: '/aaa00000-0000-4000-8000-000000000001', holdNext: true, started: false, failOnRelease: true } }))
  const geometry = async () => page.evaluate(() => {
    const media = document.querySelector('.memory-card .memoly-mixed-viewport')!.getBoundingClientRect()
    const next = document.querySelectorAll<HTMLElement>('.memory-card')[1]!.getBoundingClientRect()
    return { media: { x: media.x, y: media.y, width: media.width, height: media.height }, nextY: next.y }
  })
  const before = await geometry()
  await photo.click()
  await expect.poll(() => page.evaluate(() => (window as typeof window & { __memolyV4PhotoRawControl?: { started: boolean } }).__memolyV4PhotoRawControl?.started)).toBe(true)
  expect(await geometry()).toEqual(before)
  await page.evaluate(() => (window as typeof window & { __memolyV4PhotoRawControl: { release?: () => void } }).__memolyV4PhotoRawControl.release?.())
  await expect(page.getByRole('alert')).toHaveText('Не удалось открыть фото. Попробуйте ещё раз.')
  expect(await geometry()).toEqual(before)
  await photo.click()
  await expect(page.locator('.pswp__memoly-caption')).toHaveText('Нашли маленький мир посреди большого города. Алиса изучала всё с таким интересом 🦕🤍')
  expect(await geometry()).toEqual(before)
})

test('family overview opens the existing child profile presentation', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/e2e/memoly-v4.harness.html?family=1')
  await page.addStyleTag({ content: '.memoly-app-root { --ui-v2-browser-safe-area-bottom: 20px !important; }' })
  expect(await page.locator('.family-screen').evaluate((element) => Number.parseFloat(getComputedStyle(element).paddingBottom))).toBe(70)
  await page.getByRole('button', { name: /Открыть профиль ребёнка/ }).click()
  await expect(page.locator('.child-profile')).toBeVisible()
  expect(await page.locator('.family-screen.child-screen').evaluate((element) => Number.parseFloat(getComputedStyle(element).paddingBottom))).toBe(120)
  await expect(page.getByText('Алиса')).toBeVisible()
})

test('family harness reaches the real child editor and avatar cropper then returns to profile', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/e2e/memoly-v4.harness.html?family=1')
  await page.getByRole('button', { name: /Открыть профиль ребёнка/ }).click()
  await page.getByRole('button', { name: 'Редактировать профиль' }).click()
  await expect(page.locator('[data-slot="child-profile-editor"]')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Изменить кадрирование' })).toBeVisible()
  await page.getByRole('button', { name: 'Изменить кадрирование' }).click()
  const cropper = page.getByRole('dialog', { name: 'Редактирование фотографии' })
  await expect(cropper).toBeVisible()
  await expect(cropper.getByRole('slider', { name: 'Масштаб' })).toBeEnabled()
  const primaryCrop = await cropper.getByRole('button', { name: 'Готово' }).evaluate((element) => {
    const style = getComputedStyle(element)
    return { color: style.color, background: style.backgroundColor, radius: style.borderRadius, height: element.getBoundingClientRect().height }
  })
  expect(primaryCrop).toMatchObject({ color: 'rgb(255, 255, 255)', background: 'rgb(65, 109, 88)', radius: '10px', height: 48 })
  expect(contrastRatio(primaryCrop.color, primaryCrop.background)).toBeGreaterThanOrEqual(4.5)
  expect(await cropper.getByRole('button', { name: 'Сбросить' }).evaluate((element) => element.getBoundingClientRect().height)).toBe(44)
  await cropper.getByRole('button', { name: 'Отмена' }).click()
  await page.getByRole('button', { name: 'Назад к профилю ребёнка' }).click()
  await expect(page.locator('.child-profile')).toBeVisible()
  await page.locator('summary[aria-label="Дополнительные действия профиля ребёнка"]').click()
  await page.getByRole('button', { name: 'Сменить фото' }).click()
  await expect(page.getByRole('heading', { name: 'Сменить фото ребёнка' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Изменить кадрирование' })).toBeVisible()
  await page.getByRole('button', { name: 'Отмена' }).click()
  await expect(page.locator('.child-profile')).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('family-child-profile-restored.png'), fullPage: true })
})
