import { expect, test } from '@playwright/test'

type Metrics = {
  calls: Array<{ path: string; method: string; ids?: number }>
  gates: Array<{ kind: string; path: string; body?: string; aborted: boolean }>
  holdNext: 'list' | 'create' | null
  patchMode: 'none' | 'forbidden-readable' | 'forbidden-denied' | 'version-conflict' | 'deleted-conflict' | 'delete-version-conflict'
  configure: (action: string) => void
  release: (kind: 'list' | 'create') => void
  snapshot: () => { keys: Array<readonly unknown[]>; data: unknown[]; entries: Array<{ key: readonly unknown[]; data: unknown }>; open: boolean; scope: { accountId: string; familyId: string; membershipEpoch: number; memoryId: string }; summaries: number }
}
declare global { interface Window { __commentsState: Metrics } }

test('summary batching and closed-panel query boundary', async ({ page }) => {
  await page.goto('/e2e/comments-state.harness.html')
  await expect.poll(() => page.evaluate(() => window.__commentsState.calls.filter((call) => call.path.endsWith('/comment-summaries')).length)).toBe(2)
  const counts = await page.evaluate(() => window.__commentsState.calls.filter((call) => call.path.endsWith('/comment-summaries')).map((call) => call.ids))
  expect(counts).toEqual([50, 10])
  expect(await page.evaluate(() => window.__commentsState.calls.some((call) => call.path.includes('/comments?')))).toBe(false)
  const opener = page.getByRole('button', { name: 'Open comments' })
  const closer = page.getByRole('button', { name: 'Закрыть комментарии' })
  for (let i = 0; i < 60; i += 1) {
    const priorListCalls = await page.evaluate(() => window.__commentsState.calls.filter((call) => call.path.includes('/comments?')).length)
    await opener.click()
    await expect(page.locator('.comments-item').first()).toBeVisible()
    await expect.poll(() => page.evaluate(() => window.__commentsState.calls.filter((call) => call.path.includes('/comments?')).length)).toBe(priorListCalls + 1)
    await closer.click()
    await expect(page.getByRole('dialog', { name: 'Комментарии' })).toHaveCount(0)
    const closedListCalls = await page.evaluate(() => window.__commentsState.calls.filter((call) => call.path.includes('/comments?')).length)
    await page.evaluate(() => window.dispatchEvent(new Event('focus')))
    await expect.poll(() => page.evaluate(() => window.__commentsState.calls.filter((call) => call.path.includes('/comments?')).length)).toBe(closedListCalls)
  }
})

for (const context of ['account', 'family', 'epoch', 'logout', 'revoke'] as const) {
  test(`late list response cannot restore comments after ${context} changes`, async ({ page }) => {
    await page.goto('/e2e/comments-state.harness.html')
    const oldScope = { accountId: 'account-a', familyId: '11111111-1111-4111-8111-111111111111', membershipEpoch: 1 }
    await page.getByRole('button', { name: 'Open comments' }).click()
    await expect(page.locator('.comments-item').first()).toBeVisible()
    await page.evaluate(() => { window.__commentsState.holdNext = 'list' })
    await page.getByRole('button', { name: 'Обновить' }).click()
    await expect.poll(() => page.evaluate(() => window.__commentsState.gates.filter((gate) => gate.kind === 'list').length)).toBe(1)
    await page.evaluate((action) => window.__commentsState.configure(action), context)
    await expect(page.getByRole('dialog', { name: 'Комментарии' })).toHaveCount(0)
    expect(await page.evaluate(() => window.__commentsState.gates.find((gate) => gate.kind === 'list')?.aborted)).toBe(true)
    await page.evaluate(() => window.__commentsState.release('list'))
    await expect.poll(() => page.evaluate((expected) => window.__commentsState.snapshot().entries.some(({ key, data }) => key[0] === 'session' && key[1] === 'comments' && key[2] === expected.familyId && key[3] === expected.accountId && key[4] === expected.membershipEpoch && key[5] === 'list' && data !== undefined), oldScope)).toBe(false)
    const oldEntries = await page.evaluate((expected) => window.__commentsState.snapshot().entries.filter(({ key }) => key[0] === 'session' && key[1] === 'comments' && key[2] === expected.familyId && key[3] === expected.accountId && key[4] === expected.membershipEpoch), oldScope)
    expect(JSON.stringify(oldEntries)).not.toContain('late-old-context-private')
    await expect(page.getByText('late-old-context-private')).toHaveCount(0)
  })

  test(`late create response cannot restore private body or draft after ${context} changes`, async ({ page }) => {
    await page.goto('/e2e/comments-state.harness.html')
    const oldScope = { accountId: 'account-a', familyId: '11111111-1111-4111-8111-111111111111', membershipEpoch: 1 }
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
    await expect.poll(() => page.evaluate((expected) => window.__commentsState.snapshot().entries.some(({ key, data }) => key[0] === 'session' && key[1] === 'comments' && key[2] === expected.familyId && key[3] === expected.accountId && key[4] === expected.membershipEpoch && key[5] === 'list' && data !== undefined), oldScope)).toBe(false)
    const snapshot = await page.evaluate(() => JSON.stringify(window.__commentsState.snapshot()))
    expect(snapshot).not.toContain(privateBody)
    expect(snapshot).not.toContain('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee')
    await expect(page.getByText(privateBody)).toHaveCount(0)
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
  await expect(page.locator('.comments-item').first()).toContainText('My draft after conflict')

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
  await expect.poll(() => page.evaluate(() => window.__commentsState.snapshot().entries.some(({ key, data }) => key[0] === 'session' && key[1] === 'comments' && key[2] === '11111111-1111-4111-8111-111111111111' && key[5] === 'list' && data !== undefined))).toBe(false)
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
  const older = page.getByRole('button', { name: 'Показать более ранние' })
  await older.scrollIntoViewIfNeeded()
  const anchor = page.locator('.comments-item').filter({ has: page.getByText('Existing comment 1', { exact: true }) })
  const anchorY = await anchor.evaluate((node) => node.getBoundingClientRect().top)
  await older.click()
  await expect(page.locator('.comments-item')).toHaveCount(40)
  const afterAnchorY = await anchor.evaluate((node) => node.getBoundingClientRect().top)
  expect(Math.abs(afterAnchorY - anchorY)).toBeLessThan(3)

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
