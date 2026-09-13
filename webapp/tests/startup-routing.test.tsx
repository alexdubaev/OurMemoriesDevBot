import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { expect, test } from 'bun:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import { BootPreloader } from '../src/features/app/BootPreloader'
import { decideStartupRoute, shouldRenderInitialFeedError } from '../src/features/app/startup-routing'
import { FeedPage } from '../src/features/feed/FeedPage'
import { feedQueryKeys } from '../src/features/feed/queries'
import type { AuthenticatedTransport } from '../src/platform/api'
import { createBrowserDevHostBridge } from '../src/platform/telegram'

const familyId = '11111111-1111-4111-8111-111111111111'

test('keeps the application on its boot screen until the family bootstrap resolves', () => {
  expect(decideStartupRoute({ status: 'pending' })).toBe('boot')
})

test('routes a first launch without a completed child profile to family onboarding', () => {
  expect(decideStartupRoute({ status: 'ready', hasActiveFamily: false, hasChildProfile: false })).toBe('family')
  expect(decideStartupRoute({ status: 'ready', hasActiveFamily: true, hasChildProfile: false })).toBe('family')
})

test('routes a returning user with a completed family profile directly to the feed', () => {
  expect(decideStartupRoute({ status: 'ready', hasActiveFamily: true, hasChildProfile: true })).toBe('feed')
})

test('renders the local memoLy logo in the preloader instead of the former text brand', () => {
  const markup = renderToStaticMarkup(createElement(BootPreloader, {
    style: { '--host-inset-top': '12px', '--host-inset-bottom': '18px' },
  }))

  expect(markup).toContain('data-slot="app-loading"')
  expect(markup).toContain('data-slot="app-brand"')
  expect(markup).toContain('src="/assets/brand/memoly-logo.webp"')
  expect(markup).toContain('alt="memoLy"')
  expect(markup).not.toContain('Наши воспоминания')
  expect(markup).toContain('aria-busy="true"')
  expect(markup).toContain('--host-inset-top:12px')
  expect(markup).toContain('--host-inset-bottom:18px')
})

test('does not render a feed failure before the application bootstrap is complete', () => {
  const queryClient = failedFeedClient()

  const markup = renderToStaticMarkup(createElement(QueryClientProvider, { client: queryClient }, createElement(FeedPage, {
    childName: 'Лиза',
    childSubtitle: '2 года',
    familyId,
    familyTimezone: 'Europe/Moscow',
    filter: 'all',
    hostBridge: createBrowserDevHostBridge(),
    insets: { top: 0, right: 0, bottom: 0, left: 0 },
    isAppBootstrapped: false,
    onFamily: () => undefined,
    onFilterChange: () => undefined,
    role: 'full',
    transport,
  })))

  expect(markup).not.toContain('Не удалось обновить ленту')
  expect(markup).toContain('Загрузка ленты')
})

test('allows a feed failure only after bootstrap and a failed initial request', () => {
  expect(shouldRenderInitialFeedError({ isAppBootstrapped: false, isFeedError: true, isFeedPending: false, itemCount: 0 })).toBe(false)
  expect(shouldRenderInitialFeedError({ isAppBootstrapped: true, isFeedError: true, isFeedPending: true, itemCount: 0 })).toBe(false)
  expect(shouldRenderInitialFeedError({ isAppBootstrapped: true, isFeedError: true, isFeedPending: false, itemCount: 0 })).toBe(true)
  expect(shouldRenderInitialFeedError({ isAppBootstrapped: true, isFeedError: true, isFeedPending: false, itemCount: 1 })).toBe(false)
})

function failedFeedClient() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const query = queryClient.getQueryCache().build(queryClient, { queryKey: feedQueryKeys.list(familyId, 'all') })
  const error = new Error('feed unavailable')
  query.setState({ ...query.state, error, errorUpdateCount: 1, errorUpdatedAt: Date.now(), fetchFailureCount: 1, fetchFailureReason: error, status: 'error' })
  return queryClient
}

const transport: AuthenticatedTransport = {
  request: async () => { throw new Error('unexpected request') },
  raw: async () => { throw new Error('unexpected request') },
}
