import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

import { createHostBridge } from '../src/platform/host-bridge'

const indexPath = fileURLToPath(new URL('../index.html', import.meta.url))
const html = readFileSync(indexPath, 'utf8')
const telegramSdk = 'https://telegram.org/js/telegram-web-app.js?63'

function conditionalBootstrapSource() {
  const maxTagEnd = html.indexOf('</script>', html.indexOf('https://st.max.ru/js/max-web-app.js'))
  const moduleTag = '<script type="module" src="/src/main.tsx"></script>'
  const moduleIndex = html.indexOf(moduleTag)
  const source = html.slice(maxTagEnd + '</script>'.length, moduleIndex)
  const match = source.match(/<script>([\s\S]*?)<\/script>/)
  if (!match) throw new Error('conditional bootstrap script is missing')
  return match[1]
}

function runConditionalBootstrap(webApp: unknown) {
  const written: string[] = []
  const window = { WebApp: webApp }
  vm.runInNewContext(conditionalBootstrapSource(), {
    window,
    document: { write: (value: string) => written.push(value) },
  })
  return { window, written }
}

test('confirmed MAX does not request Telegram before memoLy module', () => {
  const { window, written } = runConditionalBootstrap({
    initData: 'query_id=max-signed',
    ready: () => undefined,
  })

  expect(written).toEqual([])
  expect(createHostBridge(window).kind).toBe('max')
  expect(createHostBridge(window).rawAuthData()).toBe('query_id=max-signed')
})

test('conditional bootstrap follows the positive MAX evidence contract', () => {
  const cases = [
    { WebApp: { initData: '', ready: () => undefined }, loadsTelegram: true },
    { WebApp: { initData: 'query_id=max-signed' }, loadsTelegram: true },
    { WebApp: { initData: 'query_id=max-signed', platform: 'ios' }, loadsTelegram: false },
    { WebApp: { initData: 'query_id=max-signed', colorScheme: 'dark' }, loadsTelegram: false },
    { WebApp: { initData: 'query_id=max-signed', close: () => undefined }, loadsTelegram: false },
  ]

  for (const { WebApp, loadsTelegram } of cases) {
    const { written } = runConditionalBootstrap(WebApp)
    expect(written.length > 0).toBe(loadsTelegram)
  }
})

test('non-MAX synchronously inserts Telegram SDK before the module snapshot', () => {
  const { window, written } = runConditionalBootstrap(undefined)

  expect(written).toEqual([`<script src="${telegramSdk}"></script>`])
  expect(written[0]).not.toContain('\\/')
  Object.assign(window, { Telegram: { WebApp: { initData: 'query_id=telegram-signed' } } })
  expect(createHostBridge(window).kind).toBe('telegram')
})

test('ordinary browser fallback remains safe when Telegram does not load', () => {
  const { window, written } = runConditionalBootstrap(undefined)

  expect(written).toHaveLength(1)
  expect(createHostBridge(window).kind).toBe('browser')
})

test('parser contract contains no static Telegram dependency before memoLy module', () => {
  const blockingExternalScripts = [...html.matchAll(/<script\b([^>]*)><\/script>/g)]
    .map((match) => match[1])
    .filter((attributes) => attributes.includes('src=') && !attributes.includes('type="module"'))

  expect(blockingExternalScripts).toEqual([' src="https://st.max.ru/js/max-web-app.js"'])
  expect(html.indexOf('https://st.max.ru/js/max-web-app.js')).toBeLessThan(html.indexOf('<script type="module"'))
  expect(html).toContain(telegramSdk)
})
