import { expect, test as base, type Page } from '@playwright/test'
import { loadVerifiedInterFontCache } from './inter-font-cache'

export { expect }

export const test = base.extend<{ page: Page }>({
  page: async ({ page }, use) => {
    const { manifest, bytesByUrl } = await loadVerifiedInterFontCache()
    const resources = new Map<string, { bytes: Uint8Array; contentType: string }>([
      [manifest.stylesheet.url, { bytes: bytesByUrl.get(manifest.stylesheet.url)!, contentType: manifest.stylesheet.contentType }],
      [manifest.license.url, { bytes: bytesByUrl.get(manifest.license.url)!, contentType: manifest.license.contentType }],
      ...manifest.fonts.map((font) => [font.url, { bytes: bytesByUrl.get(font.url)!, contentType: font.contentType }] as const),
    ])
    await page.route('https://rsms.me/**', async (route) => {
      const resource = resources.get(route.request().url())
      if (!resource) {
        await route.abort('blockedbyclient')
        throw new Error(`The browser requested an uncached Inter resource: ${route.request().url()}`)
      }
      await route.fulfill({
        body: Buffer.from(resource.bytes),
        contentType: resource.contentType,
        headers: {
          'access-control-allow-origin': '*',
          'cache-control': 'public, max-age=31536000, immutable',
        },
      })
    })
    // Playwright's fixture lifecycle hook named `use` is not a React hook.
    // eslint-disable-next-line react-hooks/rules-of-hooks
    await use(page)
  },
})

export const e2ePassword = 'password123'

export function uniqueEmail(prefix = 'web-e2e') {
  const timestamp = new Date().toISOString().replace(/[^0-9]/g, '')
  const suffix = Math.random().toString(36).slice(2, 8)

  return `${prefix}-${timestamp}-${suffix}@example.com`
}
