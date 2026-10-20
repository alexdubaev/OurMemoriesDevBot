import { expect, test } from '@playwright/test'

type Metrics = {
  calls: Array<{ path: string; method: string; ids?: number }>
  gates: Array<{ kind: string; path: string; body?: string; aborted: boolean }>
  holdNext: 'list' | 'create' | null
  configure: (action: string) => void
  release: (kind: 'list' | 'create') => void
  snapshot: () => { keys: unknown[][]; data: unknown[]; open: boolean; scope: { accountId: string; familyId: string; membershipEpoch: number; memoryId: string }; summaries: number }
}
declare global { interface Window { __commentsState: Metrics } }

test('summary batching and closed-panel query boundary', async ({ page }) => {
  await page.goto('/e2e/comments-state.harness.html')
  await expect.poll(() => page.evaluate(() => window.__commentsState.calls.filter((call) => call.path.endsWith('/comments/summaries')).length)).toBe(2)
  const counts = await page.evaluate(() => window.__commentsState.calls.filter((call) => call.path.endsWith('/comments/summaries')).map((call) => call.ids))
  expect(counts).toEqual([50, 10])
  expect(await page.evaluate(() => window.__commentsState.calls.some((call) => call.path.includes('/comments?')))).toBe(false)
  await page.getByRole('button', { name: 'Open comments' }).click()
  await expect(page.getByText('Existing comment')).toBeVisible()
})

for (const context of ['account', 'family', 'epoch', 'logout', 'revoke'] as const) {
  test(`late list response cannot restore comments after ${context} changes`, async ({ page }) => {
    await page.goto('/e2e/comments-state.harness.html')
    await page.getByRole('button', { name: 'Open comments' }).click()
    await expect(page.getByText('Existing comment')).toBeVisible()
    await page.evaluate(() => { window.__commentsState.holdNext = 'list' })
    await page.getByRole('button', { name: 'Обновить' }).click()
    await expect.poll(() => page.evaluate(() => window.__commentsState.gates.filter((gate) => gate.kind === 'list').length)).toBe(1)
    await page.evaluate((action) => window.__commentsState.configure(action), context)
    await expect(page.getByRole('dialog', { name: 'Комментарии' })).toHaveCount(0)
    await page.evaluate(() => window.__commentsState.release('list'))
    await expect.poll(() => page.evaluate(() => window.__commentsState.snapshot().keys.some((key) => key[0] === 'session' && key[1] === 'comments' && key[2] === '11111111-1111-4111-8111-111111111111'))).toBe(false)
    const snapshot = await page.evaluate(() => JSON.stringify(window.__commentsState.snapshot()))
    expect(snapshot).not.toContain('Existing comment')
  })

  test(`late create response cannot restore private body or draft after ${context} changes`, async ({ page }) => {
    await page.goto('/e2e/comments-state.harness.html')
    await page.getByRole('button', { name: 'Open comments' }).click()
    await expect(page.getByText('Existing comment')).toBeVisible()
    await page.evaluate(() => { window.__commentsState.holdNext = 'create' })
    const privateBody = `private ${context} body`
    await page.getByRole('textbox', { name: 'Написать комментарий' }).fill(privateBody)
    await page.getByRole('button', { name: 'Отправить' }).click()
    await expect.poll(() => page.evaluate(() => window.__commentsState.gates.filter((gate) => gate.kind === 'create').length)).toBe(1)
    await page.evaluate((action) => window.__commentsState.configure(action), context)
    await expect(page.getByRole('dialog', { name: 'Комментарии' })).toHaveCount(0)
    const aborted = await page.evaluate(() => window.__commentsState.gates.find((gate) => gate.kind === 'create')?.aborted)
    expect(aborted).toBe(true)
    await page.evaluate(() => window.__commentsState.release('create'))
    await page.getByRole('button', { name: 'Open comments' }).click().catch(() => undefined)
    await expect.poll(() => page.evaluate(() => window.__commentsState.snapshot().keys.some((key) => key[0] === 'session' && key[1] === 'comments' && key[2] === '11111111-1111-4111-8111-111111111111'))).toBe(false)
    const snapshot = await page.evaluate(() => JSON.stringify(window.__commentsState.snapshot()))
    expect(snapshot).not.toContain(privateBody)
    expect(snapshot).not.toContain('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee')
    await expect(page.getByText(privateBody)).toHaveCount(0)
  })
}
