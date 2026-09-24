import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

import { createHostBridge } from '../src/platform/host-bridge'

const indexPath = fileURLToPath(new URL('../index.html', import.meta.url))
const html = readFileSync(indexPath, 'utf8')
const maxSdk = 'https://st.max.ru/js/max-web-app.js'
const telegramSdk = 'https://telegram.org/js/telegram-web-app.js?63'

function conditionalBootstrapSource() {
  const moduleTag = '<script type="module" src="/src/main.tsx"></script>'
  const moduleIndex = html.indexOf(moduleTag)
  const source = html.slice(0, moduleIndex)
  const match = source.match(/<script>([\s\S]*?)<\/script>/)
  if (!match) throw new Error('conditional bootstrap script is missing')
  return match[1]
}

function runConditionalBootstrap({
  webApp,
  telegramWebApp,
  hash = '',
  navigationName,
  sessionStorage,
}: {
  webApp?: unknown
  telegramWebApp?: unknown
  hash?: string
  navigationName?: string
  sessionStorage?: unknown
} = {}) {
  const written: string[] = []
  const window = {
    WebApp: webApp,
    Telegram: telegramWebApp === undefined ? undefined : { WebApp: telegramWebApp },
    location: { hash },
    performance: navigationName
      ? { getEntriesByType: () => [{ name: navigationName }] }
      : undefined,
    sessionStorage,
  }
  vm.runInNewContext(conditionalBootstrapSource(), {
    window,
    document: { write: (value: string) => written.push(value) },
  })
  return { window, written }
}

test('ordinary browser does not request either host SDK before memoLy module', () => {
  const { window, written } = runConditionalBootstrap()

  expect(written).toEqual([])
  expect(createHostBridge(window).kind).toBe('browser')
})

test('MAX launch markers request MAX SDK with precedence over Telegram markers', () => {
  const { written } = runConditionalBootstrap({
    hash: '#WebAppData=query_id=max-signed&WebAppPlatform=ios&tgWebAppData=query_id=telegram-signed',
  })

  expect(written).toEqual([`<script src="${maxSdk}"></script>`])
})

test('Telegram launch markers synchronously request Telegram SDK', () => {
  const { written } = runConditionalBootstrap({ hash: '#tgWebAppData=query_id=telegram-signed&tgWebAppPlatform=ios' })

  expect(written).toEqual([`<script src="${telegramSdk}"></script>`])
  expect(written[0]).not.toContain('\\/')
})

test('MAX launch markers from the navigation entry restore MAX SDK bootstrap', () => {
  const { written } = runConditionalBootstrap({
    navigationName: 'https://memo.ly/#WebAppData=query_id=max-signed&WebAppVersion=1.0',
  })

  expect(written).toEqual([`<script src="${maxSdk}"></script>`])
})

test('an explicit Telegram URL takes precedence over a MAX navigation fallback', () => {
  const { written } = runConditionalBootstrap({
    hash: '#tgWebAppData=query_id=telegram-signed&tgWebAppVersion=8.0',
    navigationName: 'https://memo.ly/#WebAppData=query_id=max-signed',
    sessionStorage: { getItem: () => 'query_id=persisted-max' },
  })

  expect(written).toEqual([`<script src="${telegramSdk}"></script>`])
})

test('meaningful injected host globals remain available without a second SDK request', () => {
  const max = runConditionalBootstrap({
    webApp: { initData: 'query_id=max-signed', ready: () => undefined },
  })
  expect(max.written).toEqual([])
  expect(createHostBridge(max.window).kind).toBe('max')

  const telegram = runConditionalBootstrap({
    telegramWebApp: { initData: 'query_id=telegram-signed' },
  })
  expect(telegram.written).toEqual([])
  expect(createHostBridge(telegram.window).kind).toBe('telegram')
})

test('persisted SDK markers alone do not request a host SDK in an ordinary browser', () => {
  const { written } = runConditionalBootstrap({
    sessionStorage: { getItem: () => 'query_id=persisted' },
  })

  expect(written).toEqual([])
})

test('parser contract keeps host SDKs conditional and parses the fallback before the module', () => {
  const blockingExternalScripts = [...html.matchAll(/<script\b([^>]*)><\/script>/g)]
    .map((match) => match[1])
    .filter((attributes) => attributes.includes('src=') && !attributes.includes('type="module"'))

  expect(blockingExternalScripts).toEqual([])
  expect(html.indexOf('<div id="root">')).toBeLessThan(html.indexOf('<script>'))
  expect(html.indexOf(maxSdk)).toBeLessThan(html.indexOf('<script type="module"'))
  expect(html).toContain(telegramSdk)
})
