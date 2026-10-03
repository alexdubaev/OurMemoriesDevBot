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
  const requested: string[] = []
  let timerId = 0
  const window = {
    WebApp: webApp,
    Telegram: telegramWebApp === undefined ? undefined : { WebApp: telegramWebApp },
    performance: navigationName
      ? { getEntriesByType: () => [{ name: navigationName }] }
      : undefined,
    sessionStorage,
    setTimeout: () => ++timerId,
    clearTimeout: () => undefined,
    addEventListener: () => undefined,
    location: { hash, reload: () => undefined },
  }
  vm.runInNewContext(conditionalBootstrapSource(), {
    window,
    document: {
      getElementById: () => null,
      createElement: () => ({ setAttribute: () => undefined, addEventListener: () => undefined }),
      head: { append: (script: { src: string }) => requested.push(script.src) },
    },
    MutationObserver: class { observe() {} disconnect() {} },
    HTMLScriptElement: class {},
    ErrorEvent: class {},
    console: { error: () => undefined },
  })
  return { window, requested }
}

test('ordinary browser does not request either host SDK before memoLy module', () => {
  const { window, requested } = runConditionalBootstrap()

  expect(requested).toEqual([])
  expect(createHostBridge(window).kind).toBe('browser')
})

test('MAX launch markers request MAX SDK with precedence over Telegram markers', () => {
  const { requested } = runConditionalBootstrap({
    hash: '#WebAppData=query_id=max-signed&WebAppPlatform=ios&tgWebAppData=query_id=telegram-signed',
  })

  expect(requested).toEqual([maxSdk])
})

test('Telegram launch markers synchronously request Telegram SDK', () => {
  const { requested } = runConditionalBootstrap({ hash: '#tgWebAppData=query_id=telegram-signed&tgWebAppPlatform=ios' })

  expect(requested).toEqual([telegramSdk])
  expect(requested[0]).not.toContain('\\/')
})

test('MAX launch markers from the navigation entry restore MAX SDK bootstrap', () => {
  const { requested } = runConditionalBootstrap({
    navigationName: 'https://memo.ly/#WebAppData=query_id=max-signed&WebAppVersion=1.0',
  })

  expect(requested).toEqual([maxSdk])
})

test('an explicit Telegram URL takes precedence over a MAX navigation fallback', () => {
  const { requested } = runConditionalBootstrap({
    hash: '#tgWebAppData=query_id=telegram-signed&tgWebAppVersion=8.0',
    navigationName: 'https://memo.ly/#WebAppData=query_id=max-signed',
    sessionStorage: { getItem: () => 'query_id=persisted-max' },
  })

  expect(requested).toEqual([telegramSdk])
})

test('meaningful injected host globals remain available without a second SDK request', () => {
  const max = runConditionalBootstrap({
    webApp: { initData: 'query_id=max-signed', ready: () => undefined },
  })
  expect(max.requested).toEqual([])
  expect(createHostBridge(max.window).kind).toBe('max')

  const telegram = runConditionalBootstrap({
    telegramWebApp: { initData: 'query_id=telegram-signed' },
  })
  expect(telegram.requested).toEqual([])
  expect(createHostBridge(telegram.window).kind).toBe('telegram')
})

test('persisted SDK markers alone do not request a host SDK in an ordinary browser', () => {
  const { requested } = runConditionalBootstrap({
    sessionStorage: { getItem: () => 'query_id=persisted' },
  })

  expect(requested).toEqual([])
})

test('parser contract keeps host SDKs conditional and parses the fallback before the module', () => {
  const blockingExternalScripts = [...html.matchAll(/<script\b([^>]*)><\/script>/g)]
    .map((match) => match[1])
    .filter((attributes) => attributes.includes('src=') && !attributes.includes('type="module"'))

  expect(blockingExternalScripts).toEqual([])
  expect(html.indexOf('<script>')).toBeLessThan(html.indexOf('<div id="root">'))
  expect(html.indexOf('<div id="root">')).toBeLessThan(html.indexOf('<script type="module"'))
  expect(html.indexOf(maxSdk)).toBeLessThan(html.indexOf('<script type="module"'))
  expect(html).toContain(telegramSdk)
})
