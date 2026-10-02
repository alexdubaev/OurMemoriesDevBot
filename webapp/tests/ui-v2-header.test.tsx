import { expect, test } from 'bun:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import { ChildHeader } from '../src/components/ChildHeader'
import { getUiV2HeaderAsset } from '../src/components/ui-v2/header-assets'

const props = {
  childAvatarCrop: { x: 0.2, y: 0.1, width: 0.5, height: 0.6 },
  childAvatarUrl: 'blob:private-child-avatar',
  childName: 'Лилия Александровна с длинным именем',
  childSubtitle: '1 год 4 месяца',
  mode: 'family' as const,
  onAllFamilies: () => undefined,
  onOpenChild: () => undefined,
  onOpenSettings: () => undefined,
  theme: 'mint' as const,
}

test('maps all six existing cover preferences to their owner supplied local artwork', () => {
  expect(['mint', 'rose', 'sky', 'lavender', 'apricot', 'sand'].map((theme) => getUiV2HeaderAsset(theme as typeof props.theme)))
    .toEqual([
      '/assets/ui-v2/headers/header-bunny-meadow.webp',
      '/assets/ui-v2/headers/header-kite-sunset.webp',
      '/assets/ui-v2/headers/header-airplane-sky.webp',
      '/assets/ui-v2/headers/header-whale-ocean.webp',
      '/assets/ui-v2/headers/header-bear-forest.webp',
      '/assets/ui-v2/headers/header-moon-dream.webp',
    ])
})

test('keeps the legacy header default byte-for-byte in markup and switches only on explicit override', () => {
  const legacy = renderToStaticMarkup(createElement(ChildHeader, props))
  const explicitLegacy = renderToStaticMarkup(createElement(ChildHeader, { ...props, uiVersion: 'legacy' }))
  const v2 = renderToStaticMarkup(createElement(ChildHeader, { ...props, uiVersion: 'v2' }))

  expect(explicitLegacy).toBe(legacy)
  expect(legacy).toContain('--theme-header-art:url(/assets/theme-header/mint.webp)')
  expect(v2).toContain('data-ui-version="v2"')
  expect(v2).toContain('Лилия Александровна с длинным именем')
  expect(v2).toContain('1 год 4 месяца')
  expect(v2).toContain('src="blob:private-child-avatar"')
  expect(v2).toContain('object-position:45% 40%')
  expect(v2).toContain('aria-label="Настройки"')
  expect(v2).toContain('aria-label="Все семьи"')
  expect(v2).toContain('aria-label="Открыть профиль ребёнка: Лилия Александровна с длинным именем"')
  expect(v2).toContain('/assets/ui-v2/icons/settings-gear@2x.webp')
  expect(v2).not.toContain('<svg')
})

test('v2 omits settings without a callback and keeps the real avatar fallback', () => {
  const v2 = renderToStaticMarkup(createElement(ChildHeader, {
    ...props,
    childAvatarCrop: null,
    childAvatarUrl: null,
    mode: 'feed',
    onOpenSettings: undefined,
    uiVersion: 'v2',
  }))

  expect(v2).toContain('data-slot="avatar-letter"')
  expect(v2).not.toContain('aria-label="Настройки"')
})
