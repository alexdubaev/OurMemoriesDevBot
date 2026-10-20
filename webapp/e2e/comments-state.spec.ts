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
    await expect(page.locator('.comments-item').first()).toBeVisible()
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
    await expect(page.locator('.comments-item').first()).toBeVisible()
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

test('edit conflicts refresh the list and preserve a draft only while the comment remains readable', async ({ page }) => {
  await page.goto('/e2e/comments-state.harness.html')
  await page.getByRole('button', { name: 'Open comments' }).click()
  await expect(page.locator('.comments-item')).toHaveCount(20)
  await page.locator('.comments-item').first().getByRole('button', { name: 'Изменить' }).click()
  const editor = page.getByRole('textbox', { name: 'Изменить комментарий' })
  await editor.fill('My draft after conflict')
  await page.evaluate(() => { window.__commentsState.patchMode = 'version-conflict' })
  await page.getByRole('button', { name: 'Сохранить' }).click()
  await expect(page.getByText(/Черновик сохранён/)).toBeVisible()
  await expect(editor).toHaveValue('My draft after conflict')
  await expect(page.getByText('Server updated comment')).toBeVisible()
  await page.getByRole('button', { name: 'Сохранить' }).click()
  await expect(page.getByText('My draft after conflict')).toBeVisible()

  await page.locator('.comments-item').first().getByRole('button', { name: 'Изменить' }).click()
  const deletedEditor = page.getByRole('textbox', { name: 'Изменить комментарий' })
  await deletedEditor.fill('Draft for deleted comment')
  await page.evaluate(() => { window.__commentsState.patchMode = 'deleted-conflict' })
  await page.getByRole('button', { name: 'Сохранить' }).click()
  await expect(page.locator('.comments-item')).toHaveCount(0)
  await expect(page.getByRole('textbox', { name: 'Изменить комментарий' })).toHaveCount(0)
})

test('403 mutation rechecks read access and only closes when the list is also forbidden', async ({ page }) => {
  await page.goto('/e2e/comments-state.harness.html')
  await page.getByRole('button', { name: 'Open comments' }).click()
  await expect(page.locator('.comments-item')).toHaveCount(20)
  await page.locator('.comments-item').first().getByRole('button', { name: 'Изменить' }).click()
  await page.getByRole('textbox', { name: 'Изменить комментарий' }).fill('Keep my readable draft')
  await page.evaluate(() => { window.__commentsState.patchMode = 'forbidden-readable' })
  await page.getByRole('button', { name: 'Сохранить' }).click()
  await expect(page.getByRole('dialog', { name: 'Комментарии' })).toBeVisible()
  await expect(page.getByRole('textbox', { name: 'Изменить комментарий' })).toHaveValue('Keep my readable draft')

  await page.evaluate(() => { window.__commentsState.patchMode = 'forbidden-denied' })
  await page.getByRole('button', { name: 'Сохранить' }).click()
  await expect(page.getByRole('dialog', { name: 'Комментарии' })).toHaveCount(0)
  const snapshot = await page.evaluate(() => JSON.stringify(window.__commentsState.snapshot()))
  expect(snapshot).not.toContain('Existing comment')
})

test('delete version conflict closes the old confirmation before offering a fresh one', async ({ page }) => {
  await page.goto('/e2e/comments-state.harness.html')
  await page.getByRole('button', { name: 'Open comments' }).click()
  const item = page.locator('.comments-item').first()
  await item.getByRole('button', { name: 'Удалить' }).click()
  await expect(page.getByRole('dialog', { name: 'Удалить комментарий?' })).toBeVisible()
  await page.evaluate(() => { window.__commentsState.patchMode = 'delete-version-conflict' })
  await page.getByRole('dialog', { name: 'Удалить комментарий?' }).getByRole('button', { name: 'Удалить' }).click()
  await expect(page.getByRole('dialog', { name: 'Удалить комментарий?' })).toHaveCount(0)
  await expect(page.getByRole('alert')).toContainText('подтвердите удаление ещё раз')
  await expect(page.locator('.comments-item').first()).toContainText('Server updated comment')
  await page.locator('.comments-item').first().getByRole('button', { name: 'Удалить' }).click()
  await expect(page.getByRole('dialog', { name: 'Удалить комментарий?' })).toBeVisible()
  await page.getByRole('dialog', { name: 'Удалить комментарий?' }).getByRole('button', { name: 'Удалить' }).click()
  await expect(page.locator('.comments-item')).toHaveCount(19)
})

test('pagination preserves the visible scroll anchor and dirty Back can continue or discard once', async ({ page }) => {
  await page.goto('/e2e/comments-state.harness.html')
  const startingUrl = page.url()
  await page.getByRole('button', { name: 'Open comments' }).click()
  const list = page.locator('.comments-list')
  await expect(page.locator('.comments-item')).toHaveCount(20)
  await list.evaluate((node) => { node.scrollTop = 80 })
  const before = await list.evaluate((node) => ({ height: node.scrollHeight, top: node.scrollTop }))
  await page.getByRole('button', { name: 'Показать более ранние' }).click()
  await expect(page.locator('.comments-item')).toHaveCount(40)
  const after = await list.evaluate((node) => ({ height: node.scrollHeight, top: node.scrollTop }))
  expect(after.top).toBeGreaterThanOrEqual(before.top + Math.max(0, after.height - before.height) - 2)

  await page.getByRole('textbox', { name: 'Написать комментарий' }).fill('Unsaved back draft')
  await page.goBack()
  await expect(page.getByRole('dialog', { name: 'Черновик не сохранён' })).toBeVisible()
  await page.getByRole('button', { name: 'Продолжить писать' }).click()
  await expect(page.getByRole('dialog', { name: 'Комментарии' })).toBeVisible()
  await expect(page.getByRole('textbox', { name: 'Написать комментарий' })).toHaveValue('Unsaved back draft')
  expect(page.url()).toBe(startingUrl)
  await page.goBack()
  await expect(page.getByRole('dialog', { name: 'Черновик не сохранён' })).toBeVisible()
  await page.getByRole('button', { name: 'Закрыть без сохранения' }).click()
  await expect(page.getByRole('dialog', { name: 'Комментарии' })).toHaveCount(0)
  expect(page.url()).toBe(startingUrl)
  await page.getByRole('button', { name: 'Open comments' }).click()
  await expect(page.getByRole('textbox', { name: 'Написать комментарий' })).toHaveValue('')
})
