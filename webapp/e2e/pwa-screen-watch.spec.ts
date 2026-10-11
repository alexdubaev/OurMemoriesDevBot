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
