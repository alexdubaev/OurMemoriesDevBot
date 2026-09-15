import { expect, test } from 'bun:test'

import { createHostBridge } from '../src/platform/host-bridge'

const maxInitData = 'query_id=max-signed'

test('host selector deterministically prefers a meaningful MAX surface', () => {
  const bridge = createHostBridge({
    Telegram: { WebApp: { initData: 'query_id=tg-signed' } },
    WebApp: { initData: maxInitData, ready: () => undefined },
  })
  expect(bridge.kind).toBe('max')
  expect(bridge.initData()).toBe(maxInitData)
})

test('passes the configured MAX username through the host selector', () => {
  const token = 'A'.repeat(32)
  const bridge = createHostBridge({ WebApp: { initData: maxInitData, ready: () => undefined } }, { maxBotUsername: 'OurMemoriesMaxBot' })
  expect(bridge.inviteLink(token)).toBe(`https://max.ru/OurMemoriesMaxBot?startapp=invite_${token}`)
})

test('host selector chooses Telegram when MAX is absent and browser otherwise', () => {
  expect(createHostBridge({ Telegram: { WebApp: { initData: 'query_id=tg-signed' } } }).kind).toBe('telegram')
  expect(createHostBridge({}).kind).toBe('browser')
  expect(createHostBridge(undefined).kind).toBe('browser')
})

test('random WebApp objects are not misclassified as MAX', () => {
  const bridge = createHostBridge({ WebApp: { ready: () => undefined } })
  expect(bridge.kind).toBe('browser')
})
