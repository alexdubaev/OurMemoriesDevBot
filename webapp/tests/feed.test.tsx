import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { MemoryDto } from '@web-app-demo/contracts'
import { expect, test } from 'bun:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import { FeedPage, TelegramVideo, TelegramVideoPoster } from '../src/features/feed/FeedPage'
import { feedQueryKeys } from '../src/features/feed/queries'
import type { AuthenticatedTransport } from '../src/platform/api'
import type { HostBridge } from '../src/platform/telegram'

const familyId = '11111111-1111-4111-8111-111111111111'
const memoryId = '22222222-2222-4222-8222-222222222222'
const childId = '33333333-3333-4333-8333-333333333333'
const authorId = '44444444-4444-4444-8444-444444444444'
const mediaId = '55555555-5555-4555-8555-555555555555'
const waveform = Array.from({ length: 48 }, (_, index) => (index + 1) / 48)

const memory: MemoryDto = {
  id: memoryId,
  familyId,
  childId,
  author: { id: authorId, name: 'Мама' },
  kind: 'voice',
  body: 'Первое слово',
  occurredAt: '2026-09-11T10:00:00.000Z',
  createdAt: '2026-09-11T10:00:00.000Z',
  version: 1,
  status: 'published',
  attachments: [{
    id: mediaId,
    source: 'private_storage',
    kind: 'voice',
    width: null,
    height: null,
    durationMs: 5_773,
    renditionStatus: 'ready',
    previewPath: null,
    displayPath: null,
    playbackPath: `/api/v1/families/${familyId}/media/${mediaId}/content?variant=playback`,
    originalDownloadPath: `/api/v1/families/${familyId}/media/${mediaId}/content?variant=original`,
    waveform,
  }],
  likes: { count: 0, likedByMe: false },
  capabilities: { edit: true, delete: true, like: true },
}

test('a next-page error keeps already displayed memories on screen', () => {
  const queryClient = feedClient()
  const query = queryClient.getQueryCache().find({ queryKey: feedQueryKeys.list(familyId, 'all') })
  if (!query) throw new Error('feed query was not created')
  query.setState({
    ...query.state,
    error: new Error('page two unavailable'),
    errorUpdateCount: 1,
    errorUpdatedAt: Date.now(),
    fetchFailureCount: 1,
    fetchFailureReason: new Error('page two unavailable'),
    status: 'error',
  })

  expect(renderFeed(queryClient)).toContain('Первое слово')
})

test('a prepared voice renders every measured waveform peak', () => {
  const markup = renderFeed(feedClient())
  expect(markup.match(/data-waveform-peak=/g)).toHaveLength(48)
})

test('a prepared voice starts with an unplayed waveform', () => {
  const markup = renderFeed(feedClient())
  expect(markup.match(/data-waveform-played="false"/g)).toHaveLength(48)
  expect(markup).toContain('background-color:var(--memory-line)')
})

test('a prepared voice displays its DTO duration before audio metadata loads', () => {
  expect(renderFeed(feedClient())).toContain('0:00 / 0:06')
})

test('a Telegram video poster renders a protected image and its duration', () => {
  const markup = renderToStaticMarkup(createElement(TelegramVideoPoster, {
    durationMs: 24_000,
    posterUrl: 'blob:private-telegram-video-poster',
    width: 1_920,
    height: 1_080,
  }))
  expect(markup).toContain('src="blob:private-telegram-video-poster"')
  expect(markup).toContain('0:24')
  expect(markup).toContain('aspect-ratio:1920 / 1080')
  expect(markup).toContain('aria-label="Смотреть видео в Telegram"')
  expect(markup).toContain('data-slot="telegram-video-play-control"')
  expect(markup).not.toMatch(/<(?:video|audio)\b/)
})

test('a Telegram video has no text CTA and keeps one handoff action for the full poster and center play control', () => {
  const onOpen = () => undefined
  const poster = TelegramVideoPoster({
    durationMs: 24_000,
    posterUrl: 'blob:private-telegram-video-poster',
    width: 1_920,
    height: 1_080,
    onOpen,
  })
  const markup = renderToStaticMarkup(createElement(TelegramVideo, {
    attachment: telegramAttachment,
    familyId,
    hostBridge,
    memoryId,
    transport,
  }))

  expect(poster.type).toBe('button')
  expect(poster.props.onClick).toBe(onOpen)
  expect(markup).not.toContain('Смотреть в Telegram')
  expect(markup).not.toMatch(/<(?:video|audio)\b/)
})

test('a Telegram portrait poster preserves the source orientation', () => {
  const markup = renderToStaticMarkup(createElement(TelegramVideoPoster, {
    durationMs: 24_000, posterUrl: 'blob:private-telegram-video-poster', width: 1_080, height: 1_920,
  }))
  expect(markup).toContain('aspect-ratio:1080 / 1920')
  expect(markup).not.toContain('aspect-ratio:1920 / 1080')
})

test('a Telegram square poster preserves its source ratio', () => {
  const markup = renderToStaticMarkup(createElement(TelegramVideoPoster, {
    durationMs: 24_000, posterUrl: 'blob:private-telegram-video-poster', width: 1_080, height: 1_080,
  }))
  expect(markup).toContain('aspect-ratio:1080 / 1080')
})

test('a Telegram poster falls back to 16:9 when dimensions are missing or invalid', () => {
  for (const [width, height] of [[null, null], [0, 1_080], [1_080, 0], [-1, 1_080]] as const) {
    const markup = renderToStaticMarkup(createElement(TelegramVideoPoster, {
      durationMs: 24_000, posterUrl: 'blob:private-telegram-video-poster', width, height,
    }))
    expect(markup).toContain('aspect-ratio:16 / 9')
  }
})

test('a Telegram video without a poster preserves the safe fallback', () => {
  const markup = renderToStaticMarkup(createElement(TelegramVideoPoster, { durationMs: null, posterUrl: null, width: null, height: null }))
  expect(markup).toContain('Видео')
  expect(markup).not.toContain('blob:')
  expect(markup).toContain('aspect-ratio:16 / 9')
  expect(markup).toContain('aria-label="Смотреть видео в Telegram"')
  expect(markup).toContain('data-slot="telegram-video-play-control"')
  expect(markup).toContain('Длительность уточняется')
})

test('overlapping keyset pages render one card per memory id', () => {
  const queryClient = feedClient()
  queryClient.setQueryData(feedQueryKeys.list(familyId, 'all'), {
    pages: [
      { items: [memory], nextCursor: 'page-2' },
      { items: [memory], nextCursor: null },
    ],
    pageParams: [null, 'page-2'],
  })
  const markup = renderFeed(queryClient)
  expect(markup.match(/aria-label="Открыть воспоминание Первое слово"/g)).toHaveLength(1)
})

function feedClient() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  queryClient.setQueryData(feedQueryKeys.list(familyId, 'all'), {
    pages: [{ items: [memory], nextCursor: 'page-2' }],
    pageParams: [null],
  })
  return queryClient
}

function renderFeed(queryClient: QueryClient) {
  return renderToStaticMarkup(createElement(QueryClientProvider, { client: queryClient }, createElement(FeedPage, {
    childName: 'Лиза',
    childSubtitle: '2 года',
    familyId,
    familyTimezone: 'Europe/Moscow',
    filter: 'all',
    hostBridge,
    insets: { top: 0, right: 0, bottom: 0, left: 0 },
    onFamily: () => undefined,
    onFilterChange: () => undefined,
    role: 'full',
    transport,
  })))
}

const transport: AuthenticatedTransport = {
  request: async () => { throw new Error('unexpected feed request during static render') },
  raw: async () => { throw new Error('unexpected media request during static render') },
}

const telegramAttachment: Extract<MemoryDto['attachments'][number], { source: 'telegram' }> = {
  id: mediaId,
  source: 'telegram',
  kind: 'video',
  width: 1_920,
  height: 1_080,
  durationMs: 24_000,
  thumbnailPath: `/api/v1/families/${familyId}/media/${mediaId}/content?variant=thumbnail`,
}

const hostBridge: HostBridge = {
  isAvailable: true,
  initData: () => null,
  inviteToken: () => null,
  metadata: () => null,
  ready: () => undefined,
  close: () => undefined,
  back: () => undefined,
  onBack: () => () => undefined,
  openBot: () => undefined,
  openTelegramVideo: () => false,
  openInvite: () => undefined,
  getInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}
