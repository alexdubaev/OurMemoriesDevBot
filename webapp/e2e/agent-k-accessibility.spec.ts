import axe from 'axe-core'
import { createHmac, randomUUID } from 'node:crypto'

import { createPrisma } from '../../backend/src/db'
import { pngImage } from './helpers/images'
import { expect, test } from './helpers/test'

const subject = 81000061
const themes = ['mint', 'rose', 'sky', 'lavender', 'apricot', 'sand'] as const

function signedInitData() {
  const fields = new URLSearchParams({
    auth_date: String(Math.floor(Date.now() / 1_000)),
    query_id: randomUUID(),
    user: JSON.stringify({ id: subject, first_name: 'Agent K QA' }),
  })
  const dataCheckString = [...fields.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${value}`)
    .join('\n')
  const secret = createHmac('sha256', 'WebAppData').update('123456:web-e2e-synthetic-token').digest()
  fields.set('hash', createHmac('sha256', secret).update(dataCheckString).digest('hex'))
  return fields.toString()
}

test('Agent K scans production Feed, Family, Member, Add, Settings and form states in six themes', async ({ page }) => {
  // This single journey keeps one admitted family while axe scans 42 rendered states.
  test.setTimeout(180_000)
  const prisma = createPrisma(process.env.TEST_DATABASE_URL!)
  try {
    await prisma.pilotAdmission.createMany({
      data: [{ provider: 'telegram', subject: String(subject) }],
      skipDuplicates: true,
    })
  } finally {
    await prisma.$disconnect()
  }

  const initData = signedInitData()
  await page.route(/telegram\.org\/js\/telegram-web-app\.js(?:\?.*)?$/, (route) => route.fulfill({ status: 200, contentType: 'application/javascript', body: '' }))
  await page.addInitScript((value) => {
    Object.defineProperty(window, 'Telegram', {
      configurable: true,
      value: {
        WebApp: {
          initData: value,
          version: '8.0',
          platform: 'tdesktop',
          safeAreaInset: { top: 24, bottom: 18 },
          contentSafeAreaInset: { top: 24, bottom: 18 },
          BackButton: { show() {}, hide() {}, onClick() {}, offClick() {} },
          ready() {},
        },
      },
    })
  }, initData)
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/')
  await page.getByRole('button', { name: 'Создать семью' }).click()
  await page.locator('#child-avatar').setInputFiles(pngImage)
  await page.getByRole('button', { name: 'Использовать это фото' }).click()
  await page.locator('#child-name').fill('Лиза')
  await page.locator('#child-birth-date').fill('2024-02-29')
  await page.getByRole('button', { name: 'Девочка' }).click()
  await page.getByRole('button', { name: 'Создать семейную ленту' }).click()
  await page.getByRole('button', { name: 'Семья' }).click()
  await expect(page.locator('[data-slot="family-presentation"]')).toBeVisible()

  for (const theme of themes) {
    await page.evaluate((value) => localStorage.setItem('memoly-theme', value), theme)
    await page.reload()
    await expect(page.locator('html')).toHaveAttribute('data-memoly-theme', theme)
    await page.getByRole('button', { name: 'Семья' }).click()
    await expect(page.locator('[data-slot="family-presentation"]')).toBeVisible()
    await scan(theme, 'Family')

    await page.getByRole('button', { name: /Открыть профиль ребёнка:/ }).click()
    await expect(page.locator('[data-slot="child-profile"]')).toBeVisible()
    await scan(theme, 'Member')
    await page.getByRole('button', { name: 'Назад к семье' }).click()

    await page.getByRole('button', { name: 'Лента' }).click()
    await expect(page.getByRole('button', { name: 'Добавить' })).toBeVisible()
    await scan(theme, 'Feed')
    await page.getByRole('button', { name: 'Добавить' }).click()
    await expect(page.locator('[data-slot="memoly-add-sheet-panel"]')).toBeVisible()
    await scan(theme, 'Add')
    await page.keyboard.press('Escape')
    await expect(page.locator('[data-slot="memoly-add-sheet-panel"]')).toHaveCount(0)
    await expect(page).not.toHaveURL('about:blank')

    await page.getByRole('button', { name: 'Семья' }).click()
    await page.getByRole('button', { name: 'Настройки' }).click()
    await expect(page.locator('[data-slot="memoly-settings-sheet"]')).toBeVisible()
    await scan(theme, 'Settings')
    await page.getByRole('button', { name: 'Оформление' }).click()
    await expect(page.locator('[data-theme-choice]')).toHaveCount(6)
    await scan(theme, 'Theme')
    await page.getByRole('button', { name: 'Назад' }).click()
    await page.getByRole('button', { name: /Настройки семьи/ }).click()
    await expect(page.getByRole('textbox', { name: 'Название семьи' })).toBeVisible()
    await scan(theme, 'Family form')
  }

  async function scan(theme: typeof themes[number], state: string) {
    await page.addScriptTag({ content: axe.source })
    const findings = await page.evaluate(async () => {
      const engine = (window as typeof window & { axe: typeof axe }).axe
      const results = await engine.run(document)
      return results.violations.map((violation) => ({
        id: violation.id,
        impact: violation.impact,
        nodes: violation.nodes.map((node) => ({ target: node.target, summary: node.failureSummary })),
      }))
    })
    console.log(JSON.stringify({ source: 'production', theme, state, findings }))
    expect(findings.filter((finding) => finding.id === 'meta-viewport')).toHaveLength(0)
    expect(findings.filter((finding) => finding.id !== 'color-contrast')).toHaveLength(0)
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0)
  }
})
