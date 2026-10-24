import { describe, expect, test } from 'bun:test'

import { createHostBridge, isSafeExternalLink } from '../src/platform/host-bridge'
import { createMaxHostBridge } from '../src/platform/max/host-bridge'
import { createBrowserDevHostBridge } from '../src/platform/telegram/host-bridge'

describe('isSafeExternalLink', () => {
  test('accepts only http and https links without credentials', () => {
    expect(isSafeExternalLink('https://shop.example.test/item?id=1')).toBe(true)
    expect(isSafeExternalLink('http://shop.example.test/item')).toBe(true)

    for (const rejected of [
      'javascript:alert(1)',
      'data:text/html,hello',
      'file:///etc/passwd',
      'ftp://shop.example.test/item',
      'tel:+10000000000',
      'https://user:pass@shop.example.test/item',
      'https://user@shop.example.test/item',
      '//shop.example.test/item',
      '/relative/path',
      'not a url',
      '',
    ]) {
      expect(isSafeExternalLink(rejected)).toBe(false)
    }
  })

  test('rejects non-string input', () => {
    expect(isSafeExternalLink(undefined as unknown as string)).toBe(false)
    expect(isSafeExternalLink(null as unknown as string)).toBe(false)
  })
})

describe('openExternalLink in MAX', () => {
  function maxHost(openLink: (url: string) => void) {
    return { WebApp: { initData: 'user=synthetic', openLink }, location: { origin: 'https://app.example.test' } }
  }

  test('passes a safe third-party link to webApp.openLink', () => {
    const opened: string[] = []
    const host = maxHost(function (this: unknown, url) {
      expect(this).toBe(host.WebApp)
      opened.push(url)
    })
    expect(createMaxHostBridge(host).openExternalLink?.('https://shop.example.test/item')).toBe(true)
    expect(opened).toEqual(['https://shop.example.test/item'])
  })

  test('refuses unsafe links without calling openLink', () => {
    const opened: string[] = []
    const bridge = createMaxHostBridge(maxHost((url) => { opened.push(url) }))
    expect(bridge.openExternalLink?.('javascript:alert(1)')).toBe(false)
    expect(bridge.openExternalLink?.('https://u:p@shop.example.test/')).toBe(false)
    expect(opened).toEqual([])
  })

  test('returns false when openLink is missing or throws', () => {
    const missing = createMaxHostBridge({ WebApp: { initData: 'user=synthetic' } })
    expect(missing.openExternalLink?.('https://shop.example.test/')).toBe(false)
    const throwing = createMaxHostBridge(maxHost(() => { throw new Error('unsupported') }))
    expect(throwing.openExternalLink?.('https://shop.example.test/')).toBe(false)
  })

  test('leaves openExternalUrl limited to the own origin', () => {
    const opened: string[] = []
    const bridge = createMaxHostBridge(maxHost((url) => { opened.push(url) }))
    expect(bridge.openExternalUrl?.('https://shop.example.test/item')).toBe(false)
    expect(bridge.openExternalUrl?.('https://app.example.test/install')).toBe(true)
    expect(opened).toEqual(['https://app.example.test/install'])
  })
})

describe('openExternalLink in the browser', () => {
  test('opens a safe link in a new tab with noopener and noreferrer', () => {
    const calls: unknown[][] = []
    const bridge = createBrowserDevHostBridge({}, { open: (...args: unknown[]) => { calls.push(args) } })
    expect(bridge.openExternalLink?.('https://shop.example.test/item')).toBe(true)
    expect(calls).toEqual([['https://shop.example.test/item', '_blank', 'noopener,noreferrer']])
  })

  test('refuses unsafe links and a missing window.open', () => {
    const calls: unknown[][] = []
    const bridge = createBrowserDevHostBridge({}, { open: (...args: unknown[]) => { calls.push(args) } })
    expect(bridge.openExternalLink?.('javascript:alert(1)')).toBe(false)
    expect(bridge.openExternalLink?.('https://u:p@shop.example.test/')).toBe(false)
    expect(calls).toEqual([])
    expect(createBrowserDevHostBridge({}, {}).openExternalLink?.('https://shop.example.test/')).toBe(false)
  })

  test('is selected for a plain browser host', () => {
    const calls: unknown[][] = []
    const bridge = createHostBridge({ open: (...args: unknown[]) => { calls.push(args) } })
    expect(bridge.kind).toBe('browser')
    expect(bridge.openExternalLink?.('http://shop.example.test/')).toBe(true)
    expect(calls).toHaveLength(1)
  })
})
