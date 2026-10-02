import { test, expect } from '@playwright/test'
import { mkdirSync, readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { catalog } from '../../src/dev/ui-v2/states/catalog'
import { themes } from '../../src/dev/ui-v2/tokens/design-tokens'
import type { Page } from '@playwright/test'
const screenshots = fileURLToPath(new URL('../../../docs/design/ui-v2/screenshots/', import.meta.url))
const noApi = new Map<Page, string[]>()
test.beforeEach(async ({ page }) => {
  const calls: string[] = []
  noApi.set(page, calls)
  page.on('request', request => { if (/\/api(?:\/|\?|$)/.test(new URL(request.url()).pathname)) calls.push(request.url()) })
  await page.route('**/api/**', route => route.abort())
})
test.afterEach(async ({ page }) => { expect(noApi.get(page), 'UI Lab attempted production API').toEqual([]) })
async function open(page: Page, id: string, width = 390, role = 'owner', theme = 'mint') {
  await page.setViewportSize({ width, height: 844 })
  await page.goto('/__fixtures/ui-v2?' + new URLSearchParams({ entry: id, role, theme, width: String(width), preview: '1' }))
  await expect(page.locator('.lab-preview')).toHaveAttribute('data-entry', id)
  await expect.poll(() => page.locator('img').evaluateAll(imgs => imgs.every(img => img.complete && img.naturalWidth > 0)), { message: id + ' image decode' }).toBe(true)
}
async function noOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  expect(await page.locator('.v2-scroll').evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true)
}
test('all catalog entries mount without exceptions or broken assets', async ({ page }) => {
  test.setTimeout(180_000)
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  expect(catalog.length).toBeGreaterThan(235)
  for (const entry of catalog) {
    await open(page, entry.id, 390, entry.screen === 'family' && entry.state.startsWith('leave') ? 'full' : 'owner')
    const surface = page.locator('.v2-screen')
    await expect(surface).toBeVisible()
    await noOverflow(page)
    expect((await surface.innerText()).trim().length, entry.id).toBeGreaterThan(12)
    await expect(page.locator('vite-error-overlay')).toHaveCount(0)
    await expect.poll(() => page.locator('img').evaluateAll(imgs => imgs.every(img => img.complete && img.naturalWidth > 0)), { message: entry.id + ' assets' }).toBe(true)
  }
  expect(errors).toEqual([])
})
test('catalog controls, state switching, six themes and viewport presets', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 1000 })
  await page.goto('/__fixtures/ui-v2')
  await expect(page.getByRole('heading', { name: 'MEMOLY UI V2 LAB' })).toBeVisible()
  await expect(page.locator('.lab-catalog details')).toHaveCount(12)
  await expect(page.locator('.lab-catalog button')).toHaveCount(catalog.length)
  await page.getByLabel('SCREEN', { exact: true }).selectOption('feed')
  await page.getByLabel('STATE', { exact: true }).selectOption('feed:note')
  await expect(page.locator('.v2-note')).toContainText('обнять дерево')
  for (const theme of Object.keys(themes)) {
    await page.getByLabel('THEME', { exact: true }).selectOption(theme)
    await expect(page.locator('.v2-root')).toHaveAttribute('data-theme', theme)
    expect(await page.locator('.v2-root').evaluate(el => getComputedStyle(el).getPropertyValue('--v2-accent').trim())).toBe(themes[theme as keyof typeof themes].accent)
  }
  for (const width of [320, 360, 390, 430]) {
    await page.getByLabel('VIEWPORT', { exact: true }).selectOption(String(width))
    expect(Math.round(await page.locator('.lab-preview').evaluate(el => el.getBoundingClientRect().width))).toBe(width)
  }
  for (const role of ['owner', 'full', 'viewer']) {
    await page.getByLabel('ROLE', { exact: true }).selectOption(role)
    await expect(page.locator('.v2-root')).toHaveAttribute('data-role', role)
  }
})
test('feed family hub, child and participant navigation uses local state', async ({ page }) => {
  await open(page, 'feed:photo')
  await page.getByRole('button', { name: 'Семья', exact: true }).click()
  await expect(page.locator('[data-entry="family:owner"]')).toBeVisible()
  await page.getByRole('button', { name: 'Профиль ребёнка: Лилия' }).click()
  await expect(page.getByRole('heading', { name: 'Лилия', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Назад', exact: true }).click()
  await page.getByRole('button', { name: /Бабушка/ }).click()
  await expect(page.getByRole('heading', { name: 'Профиль участника' })).toBeVisible()
  await page.getByRole('button', { name: 'Назад', exact: true }).click()
  await page.getByRole('button', { name: 'Все семьи' }).click()
  await expect(page.locator('[data-entry="families:multiple"]')).toBeVisible()
})
test('shared FamilyHero geometry matches feed/family for all themes', async ({ page }) => {
  for (const theme of Object.keys(themes)) {
    await open(page, 'feed:photo', 390, 'owner', theme)
    const feed = await page.locator('[data-component="FamilyHero"]').boundingBox()
    await page.getByRole('button', { name: 'Семья', exact: true }).click()
    const family = await page.locator('[data-component="FamilyHero"]').boundingBox()
    expect(family).toEqual(feed)
  }
})
test('viewer carousel closes back to the same memory and restores focus', async ({ page }) => {
  await open(page, 'feed:mixed')
  await page.getByRole('button', { name: 'Следующее медиа' }).click()
  await expect(page.getByLabel('Медиа 2 из 3')).toBeVisible()
  await page.getByRole('button', { name: 'Смотреть видео' }).click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await page.getByRole('button', { name: 'Далее', exact: true }).click()
  await expect(page.getByRole('dialog')).toContainText('3 / 3')
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Смотреть видео' })).toBeFocused()
})
test('long press, reaction replacement and removal obey one active reaction', async ({ page }) => {
  await open(page, 'feed:photo')
  const react = page.getByRole('button', { name: 'Выбрать реакцию' })
  await react.hover()
  await page.mouse.down()
  await page.waitForTimeout(500)
  await page.mouse.up()
  await expect(page.getByRole('dialog')).toBeVisible()
  await page.getByRole('button', { name: 'Реакция 😂', exact: true }).click()
  await expect(page.getByRole('button', { name: /Реакция 😂, 1/ })).toHaveAttribute('aria-pressed', 'true')
  await react.click()
  await page.getByRole('button', { name: 'Реакция 👏', exact: true }).click()
  await expect(page.getByRole('button', { name: /Реакция 👏, 1/ })).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByRole('button', { name: /Реакция 😂,/ })).toHaveCount(0)
  await page.getByRole('button', { name: /Реакция 👏, 1/ }).click()
  await expect(page.getByRole('button', { name: /Реакция 👏,/ })).toHaveCount(0)
})
test('Add note publish and cancel confirmation', async ({ page }) => {
  await open(page, 'feed:photo')
  await page.getByRole('button', { name: 'Добавить воспоминание' }).click()
  await page.getByRole('button', { name: /Заметка Слова/ }).click()
  await page.getByLabel('Текст воспоминания').fill('Сегодня Лилия сказала: «Дом — это где обнимают».')
  await page.getByRole('button', { name: 'Опубликовать' }).click()
  await expect(page.getByRole('heading', { name: 'Момент теперь в альбоме' })).toBeVisible()
  await page.getByRole('button', { name: 'Смотреть в ленте' }).click()
  await expect(page.locator('.v2-note').first()).toContainText('Дом — это где обнимают')
  await page.getByRole('button', { name: 'Добавить воспоминание' }).click()
  await page.getByRole('button', { name: /Заметка Слова/ }).click()
  await page.getByRole('button', { name: 'Отмена', exact: true }).click()
  await expect(page.getByRole('dialog')).toContainText('Выйти без сохранения')
  await page.getByRole('button', { name: 'Продолжить редактирование' }).click()
  await expect(page.getByLabel('Текст воспоминания')).toBeVisible()
})
test('viewer role cannot add/edit/delete, full can invite, owner manages child', async ({ page }) => {
  await open(page, 'feed:photo', 390, 'viewer')
  await expect(page.getByRole('button', { name: 'Добавление доступно участникам с полным доступом' })).toBeDisabled()
  await page.getByRole('button', { name: 'Действия с воспоминанием' }).click()
  await expect(page.getByRole('button', { name: 'Удалить', exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Редактировать', exact: true })).toHaveCount(0)
  await page.keyboard.press('Escape')
  await open(page, 'family:full', 390, 'full')
  await expect(page.getByRole('button', { name: 'Пригласить близкого' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Настройки семьи', exact: true })).toHaveCount(0)
  await open(page, 'child:complete', 390, 'owner')
  await expect(page.getByRole('button', { name: 'Редактировать профиль' })).toBeVisible()
  await open(page, 'child:complete', 390, 'viewer')
  await expect(page.getByRole('button', { name: 'Редактировать профиль' })).toHaveCount(0)
})
test('invite has explicit Join and no private photo before joining; copy/share local only', async ({ page }) => {
  await open(page, 'invite:valid')
  await expect(page.locator('img[src*="/src/dev/ui-v2/assets/"]')).toHaveCount(0)
  await page.getByRole('button', { name: 'Присоединиться', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Теперь вы в семье' })).toBeVisible()
  await open(page, 'invite-create:relative')
  await page.getByLabel('Как вы называете близкого').fill('Дедушка')
  await page.getByRole('button', { name: 'Создать приглашение' }).click()
  await page.getByRole('button', { name: 'Копировать ссылку' }).click()
  await expect(page.getByText('Ссылка скопирована', { exact: true }).first()).toBeVisible()
  await page.getByRole('button', { name: 'Поделиться приглашением' }).click()
  await expect(page.getByText('Приглашение готово к отправке').first()).toBeVisible()
})
test('keyboard focus trap, accessible button names, touch targets, text selection and reduced motion', async ({ page }) => {
  await open(page, 'feed:photo')
  await page.getByRole('button', { name: 'Добавить воспоминание' }).click()
  const dialog = page.getByRole('dialog')
  await page.keyboard.press('Tab')
  await expect(dialog.getByRole('button', { name: 'Закрыть', exact: true })).toBeFocused()
  await page.keyboard.press('Shift+Tab')
  expect(await dialog.evaluate(el => el.contains(document.activeElement))).toBe(true)
  const sizes = await dialog.getByRole('button').evaluateAll(nodes => nodes.map(node => { const r = node.getBoundingClientRect(); return { name: node.getAttribute('aria-label') ?? node.textContent, width:r.width,height:r.height } }))
  expect(sizes.every(s => Boolean(s.name?.trim()) && s.width >= 44 && s.height >= 44)).toBe(true)
  await page.keyboard.press('Escape')
  await open(page, 'feed:note')
  expect(await page.locator('.v2-note').evaluate(el => getComputedStyle(el).userSelect)).not.toBe('none')
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.getByRole('button', { name: 'Добавить воспоминание' }).click()
  expect(await page.getByRole('dialog').evaluate(el => getComputedStyle(el).animationName)).toBe('none')
})
for (const width of [320, 360, 390, 430, 768]) {
  test(`responsive ${width}: feed/family/composer and screenshot evidence`, async ({ page }) => {
    mkdirSync(screenshots, { recursive: true })
    for (const [id, role] of [['feed:mixed','owner'], ['family:owner','owner'], ['composer:mixed','owner']]) {
      await open(page, id, width, role)
      await noOverflow(page)
      await page.screenshot({ path: screenshots + '/' + id.replace(':','-') + '-' + width + '.png', animations: 'disabled' })
    }
  })
}
test('390 screenshot matrix and all required state presentations', async ({ page }) => {
  mkdirSync(screenshots, { recursive: true })
  for (const [id, role] of [['first-run:welcome-continue','owner'],['families:multiple','owner'],['feed:photo','owner'],['feed:note','owner'],['feed:voice','owner'],['feed:max-video','owner'],['family:viewer','viewer'],['invite:valid','viewer'],['overlay:add','owner'],['composer:note','owner'],['feed:empty','owner']]) {
    await open(page,id,390,role)
    await page.screenshot({ path: screenshots + '/' + id.replace(':','-') + '-390.png', animations: 'disabled' })
  }
})
test('source isolation, tokens export, media budgets and production output excludes Lab', async () => {
  const app = fileURLToPath(new URL('../..', import.meta.url))
  const source = app + '/src/dev/ui-v2'
  const files: string[] = []
  function walk(folder: string) { for (const item of readdirSync(folder,{withFileTypes:true})) { if (item.isDirectory()) walk(folder+'/'+item.name); else files.push(folder+'/'+item.name) } }
  walk(source)
  const text = files.filter(f => /\.(ts|tsx)$/.test(f)).map(f => readFileSync(f,'utf8')).join('\n')
  expect(text).not.toMatch(/(?:fetch\s*\(|XMLHttpRequest|navigator\.share|navigator\.clipboard|from ['"]@\/|from ['"].*features\/|from ['"].*platform\/)/)
  const manifest = JSON.parse(readFileSync(source+'/assets/manifest.json','utf8'))
  expect(manifest).toHaveLength(3)
  expect(manifest.every((m: {bytes:number}) => m.bytes <= 180_000)).toBe(true)
  expect(JSON.parse(readFileSync(source+'/tokens/design-tokens.json','utf8')).themes).toHaveProperty('mint')
  const output: string[] = []
  function walkDist(folder: string) { for (const item of readdirSync(folder,{withFileTypes:true})) { if (item.isDirectory()) walkDist(folder+'/'+item.name); else output.push(folder+'/'+item.name) } }
  walkDist(app+'/dist')
  expect(output.some(path => /ui-v2|portrait.*\.webp|painting.*\.webp/.test(path.slice((app + '/dist').length)))).toBe(false)
  const runtime = output.filter(f => /\.(html|js|css)$/.test(f)).map(f => readFileSync(f,'utf8')).join('\n')
  expect(runtime).not.toMatch(/MEMOLY UI V2 LAB|memoly-ui-v2-dev-entry|UI v2 Lab is development-only|v2-family-hero/)
})
test('participant selection and local profile/role save update the selected person', async ({ page }) => {
  await open(page, 'family:owner')
  await page.getByRole('button', { name: /Дедушка Просмотр/ }).click()
  await expect(page.getByRole('heading', { name: 'Дедушка', exact: true })).toBeVisible()
  await page.getByLabel('Имя в семье').fill('Дедушка Саша')
  await page.getByRole('combobox', { name: 'Доступ', exact: true }).selectOption('full')
  await page.getByRole('button', { name: 'Сохранить изменения' }).click()
  await page.getByRole('button', { name: 'Назад', exact: true }).click()
  await expect(page.getByRole('button', { name: /Дедушка Саша Полный доступ/ })).toBeVisible()
  await expect(page.getByRole('button', { name: /Мама Владелец/ })).toBeVisible()
})
test('edits target the selected memory and deleting all memories reaches empty', async ({ page }) => {
  await open(page, 'feed:all')
  const note = page.locator('[data-memory="note"]')
  await note.getByRole('button', { name: 'Действия с воспоминанием' }).click()
  await page.getByRole('button', { name: 'Редактировать', exact: true }).click()
  await expect(page.getByLabel('Подпись')).toContainText('обнять дерево')
  await page.getByLabel('Подпись').fill('Новый текст семейной истории')
  await page.getByRole('button', { name: 'Сохранить изменения' }).click()
  await page.getByRole('button', { name: 'Смотреть в ленте' }).click()
  await expect(page.locator('[data-memory="note"]')).toContainText('Новый текст семейной истории')
  for (let i = 0; i < 5; i++) {
    await page.getByRole('button', { name: 'Действия с воспоминанием' }).first().click()
    await page.getByRole('button', { name: 'Удалить', exact: true }).click()
    await page.getByRole('dialog').getByRole('button', { name: 'Удалить', exact: true }).click()
  }
  await expect(page.getByRole('heading', { name: 'Первый момент — за вами' })).toBeVisible()
})
test('primary button contrast across all themes', async ({ page }) => {
  function luminance(hex: string) { const values = hex.replace('#','').match(/../g)!.map(value => parseInt(value,16)/255).map(v => v <= .04045 ? v/12.92 : ((v+.055)/1.055)**2.4); return values[0]*.2126+values[1]*.7152+values[2]*.0722 }
  for (const [key, value] of Object.entries(themes)) {
    expect((1.05)/(luminance(value.accent)+.05), key).toBeGreaterThanOrEqual(4.5)
    await open(page,'first-run:welcome-continue',390,'owner',key)
    expect(await page.getByRole('button', { name:'Продолжить', exact:true }).evaluate(el => getComputedStyle(el).color)).toBe('rgb(255, 255, 255)')
  }
})
test('saved child identity and birthday agree across profile and hero', async ({ page }) => {
  await open(page, 'setup:edit')
  await page.getByLabel('Имя ребёнка').fill('Аня')
  await page.getByLabel('Дата рождения').fill('2022-09-12')
  await page.getByRole('button', { name: 'Сохранить профиль', exact: true }).click()
  await page.getByRole('button', { name: 'Открыть профиль', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Аня', exact: true })).toBeVisible()
  await expect(page.getByText('12 сентября 2022', { exact: true })).toBeVisible()
  await expect(page.getByText('4 года', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Назад', exact: true }).click()
  await expect(page.locator('.v2-family-hero')).toContainText('Аня')
  await expect(page.locator('.v2-family-hero')).toContainText('4 года')
})
test('focus stays inside dialog across overlay transitions and returns to original trigger', async ({ page }) => {
  await open(page, 'feed:photo')
  const trigger = page.getByRole('button', { name: 'Действия с воспоминанием' })
  await trigger.click()
  await page.getByRole('button', { name: 'Удалить', exact: true }).click()
  await expect(page.getByRole('dialog')).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(trigger).toBeFocused()
  const add = page.getByRole('button', { name: 'Добавить воспоминание' })
  await add.click()
  await page.getByRole('button', { name: /^Голос или видео/ }).click()
  await expect(page.getByRole('dialog')).toBeFocused()
  await page.getByRole('button', { name: /^Отправить голос боту/ }).click()
  await expect(page.getByRole('dialog')).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(add).toBeFocused()
})
test('invite retry renders pending before simulated success', async ({ page }) => {
  await open(page, 'invite:error', 390, 'viewer')
  await expect(page.getByText('Не удалось присоединиться. Проверьте соединение и повторите.', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Присоединиться', exact: true }).click()
  await expect(page.getByText('Присоединяемся к семье…', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Присоединиться', exact: true })).toBeDisabled()
  await expect(page.getByRole('heading', { name: 'Теперь вы в семье' })).toBeVisible()
})
