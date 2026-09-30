import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { MemoryDto } from '@web-app-demo/contracts'
import { expect, test } from 'bun:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import postcss from 'postcss'

import { FeedPage, MaxVideoPreview, PhotoImage, TelegramVideo, TelegramVideoPoster } from '../src/features/feed/FeedPage'
import { selectPendingPrivateVideoIds } from '../src/features/feed/pending-video-selection'
import { loadMaxVideoSourceOnce } from '../src/features/feed/max-video-source'
import { maxVideoReadinessInterval, maxVideoReadinessPath, withMaxVideoReadinessSlot } from '../src/features/feed/max-video-readiness'
import { refreshFromTop } from '../src/features/feed/live-refresh'
import { composerModeForAdd, memoryActionNames } from '../src/features/feed/composer-routing'
import { FeedShell } from '../src/features/feed/components/FeedShell'
import { EmptyState, InlineError } from '../src/features/feed/components'
import { FeedMemoryCard } from '../src/features/memoly-ui/FeedPresentation'
import { BottomNavigation } from '../src/components/BottomNavigation'
import { deleteMemory } from '../src/features/feed/api'
import { createSingleFlightTelegramVideoHandoff, navigateToTelegramVideo } from '../src/features/feed/telegram-video-handoff'
import { feedQueryKeys, removeMemoryFromCachedFeeds } from '../src/features/feed/queries'
import { FeedPresentation, MemoryCardPresentation } from '../src/features/feed/presentation'
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

const photoMemory: MemoryDto = {
  ...memory,
  id: '66666666-6666-4666-8666-666666666666',
  kind: 'photo',
  body: 'Прогулка в парке',
  attachments: [{
    id: '77777777-7777-4777-8777-777777777777',
    source: 'private_storage',
    kind: 'photo',
    width: 1_280,
    height: 960,
    durationMs: null,
    renditionStatus: 'ready',
    previewPath: `/api/v1/families/${familyId}/media/77777777-7777-4777-8777-777777777777/content?variant=preview`,
    displayPath: `/api/v1/families/${familyId}/media/77777777-7777-4777-8777-777777777777/content?variant=display`,
    playbackPath: null,
    originalDownloadPath: `/api/v1/families/${familyId}/media/77777777-7777-4777-8777-777777777777/content?variant=original`,
    waveform: null,
  }],
}

const videoMemory: MemoryDto = {
  ...memory,
  id: '88888888-8888-4888-8888-888888888888',
  kind: 'video',
  body: 'Первые шаги',
  attachments: [{
    id: '99999999-9999-4999-8999-999999999999',
    source: 'private_storage',
    kind: 'video',
    width: 1_920,
    height: 1_080,
    durationMs: 24_000,
    renditionStatus: 'ready',
    previewPath: null,
    displayPath: null,
    playbackPath: `/api/v1/families/${familyId}/media/99999999-9999-4999-8999-999999999999/content?variant=playback`,
    originalDownloadPath: `/api/v1/families/${familyId}/media/99999999-9999-4999-8999-999999999999/content?variant=original`,
    waveform: null,
  }],
}

const noteMemory: MemoryDto = {
  ...memory,
  id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  kind: 'note',
  body: 'Сегодня впервые улыбнулась.',
  attachments: [],
}

const mixedMemory: MemoryDto = {
  ...photoMemory,
  id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  kind: 'media',
  body: 'Фото и видео по порядку',
  attachments: [photoMemory.attachments[0], videoMemory.attachments[0], { ...photoMemory.attachments[0], id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' }, { ...videoMemory.attachments[0], id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd' }],
}

test('photo albums of five and ten keep one Memory and ordered Feed carousel slides', () => {
  for (const count of [5, 10]) {
    const album: MemoryDto = {
      ...photoMemory,
      attachments: Array.from({ length: count }, (_, index) => ({
        ...photoMemory.attachments[0]!,
        id: `photo-${index + 1}`,
      })),
    }
    const markup = renderFeed(feedClientWith([album]))
    expect(markup.match(/data-memory-id="66666666-6666-4666-8666-666666666666"/g)?.length).toBe(1)
    expect(markup).toContain(`data-carousel-dot="${count}"`)
    expect(markup).not.toContain(`1 / ${count}`)
    const positions = Array.from({ length: count }, (_, index) => markup.indexOf(`data-carousel-position="${index + 1}" data-media-kind="photo"`))
    expect(positions.every((position) => position >= 0)).toBe(true)
    expect(positions).toEqual([...positions].sort((a, b) => a - b))
    expect(markup.match(/aria-hidden="true"[^>]*inert=""/g)?.length).toBe(count - 1)
  }
})

test('a single photo uses the same fixed Feed stage without carousel navigation', () => {
  const markup = renderFeed(feedClientWith([photoMemory]))
  expect(markup).toContain('data-media-stage="feed"')
  expect(markup).toContain('data-carousel-position="1" data-media-kind="photo"')
  expect(markup).not.toContain('memoly-mixed-controls')
  expect(markup).toContain('Загрузка фотографии')
})

test('an empty photo caption adds no Open footer and the media itself remains the viewer control', () => {
  const emptyCaption = { ...photoMemory, body: '' }
  const markup = renderFeed(feedClientWith([emptyCaption]))
  expect(markup).toContain('aria-label="Загрузка фотографии"')
  expect(markup).not.toContain('>Открыть<')
  expect(markup).not.toContain('caption-open-empty')
})

test('notes keep selectable text in the memory surface and omit system labels', () => {
  for (const body of ['Привет', 'Сегодня гуляли в парке и впервые кормили уток вместе.', 'Утром мы долго собирались. Потом пошли гулять, встретили друзей и провели весь день вместе. Вечером Лиза уснула в машине по дороге домой.', 'Первая строка\n\nВторая строка ❤️ <script>alert("x")</script>']) {
    const markup = renderFeed(feedClientWith([{ ...noteMemory, body }]))
    const panelIndex = markup.indexOf('data-memoly-note-gradient')
    const panelEnd = markup.indexOf('</button>', panelIndex)
    const panelMarkup = markup.slice(panelIndex, panelEnd)
    const escapedBody = body.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;')
    const bodyIndex = markup.indexOf(escapedBody, panelIndex)
    const likeIndex = markup.indexOf('class="memory-like')
    expect(panelIndex).toBeGreaterThanOrEqual(0)
    expect(bodyIndex).toBeGreaterThan(panelIndex)
    expect(likeIndex).toBeGreaterThan(bodyIndex)
    expect(markup).not.toContain('Заметка')
    expect(markup).toContain('memoly-note-gradient__text')
    expect(panelMarkup).not.toContain('data-slot="webp-icon"')
    expect(panelMarkup).not.toContain('<img')
    if (body.includes('<script>')) {
      expect(panelMarkup).toContain('&lt;script&gt;')
      expect(panelMarkup).not.toContain('<script>')
    }
    expect(markup).toContain(`aria-label="Открыть заметку: ${escapedBody}"`)
    expect(markup).not.toContain('>Открыть<')
  }
})

test('note content stays unboxed with natural text flow and semantic focus', () => {
  const css = readFileSync(resolve(import.meta.dir, '../src/features/feed/presentation/memoly-feed.css'), 'utf8')
  const rules: postcss.Rule[] = []
  postcss.parse(css).walkRules((rule) => rules.push(rule))
  const panel = rules.filter((rule) => rule.selector === '[data-memoly-feed] [data-memoly-note-gradient]').at(-1)
  const declarations = Object.fromEntries(panel?.nodes?.filter((node): node is postcss.Declaration => node.type === 'decl').map(({ prop, value }) => [prop, value]) ?? [])
  expect(declarations['min-block-size']).toBe('0')
  expect(declarations['width']).toBe('100%')
  expect(declarations['padding']).toBe('6px 4px')
  expect(declarations['border-radius']).toBe('0')
  expect(declarations['box-shadow']).toBe('none')
  expect(declarations['font']).toBe('inherit')
  expect(declarations['font-size']).toBe('18px')
  expect(declarations['line-height']).toBe('1.5')
  expect(declarations['background']).toBe('transparent')
  expect(css).not.toContain('.note-story-panel')
  expect(panel?.nodes?.some((node) => node.type === 'decl' && node.value.includes('!important'))).toBe(false)
})

test('private video controls use accessible icons and keep the timeline without text buttons', () => {
  const markup = renderFeed(feedClientWith([videoMemory]))
  expect(markup).toContain('aria-label="Воспроизвести видео"')
  expect(markup).toContain('aria-label="На весь экран"')
  expect(markup).toContain('aria-label="Позиция видео"')
  expect(markup).not.toContain('>Смотреть</button>')
  expect(markup).not.toContain('>Полный экран</button>')
  expect(markup).not.toContain('>Открыть<')
})

test('portrait Feed stages are not height-clipped and video seek targets remain touch-sized', () => {
  const css = readFileSync(resolve(import.meta.dir, '../src/features/feed/presentation/memoly-feed.css'), 'utf8')
  const rules: postcss.Rule[] = []
  postcss.parse(css).walkRules((rule) => rules.push(rule))
  const feedViewport = rules.find((rule) => rule.selector.includes('.memoly-mixed-viewport[data-media-stage='))
  const soloVideoStage = rules.find((rule) => rule.selector === '[data-memoly-feed] .memory-media-slot.video-wrap' && rule.nodes?.some((node) => node.type === 'decl' && node.prop === 'aspect-ratio'))
  expect(feedViewport?.nodes?.some((node) => node.type === 'decl' && node.prop === 'aspect-ratio' && node.value === '4 / 5')).toBe(true)
  expect(soloVideoStage?.nodes?.some((node) => node.type === 'decl' && node.prop === 'aspect-ratio' && node.value === '4 / 5')).toBe(true)
  expect(feedViewport?.nodes?.some((node) => node.type === 'decl' && node.prop === 'max-height')).toBe(false)
  expect(soloVideoStage?.nodes?.some((node) => node.type === 'decl' && node.prop === 'max-height')).toBe(false)
  const seekRules = rules.filter((rule) => rule.selector.includes('.memoly-private-video-v2') && rule.selector.includes("input[type='range']"))
  expect(seekRules.length).toBeGreaterThanOrEqual(2)
  expect(seekRules.every((rule) => rule.nodes?.some((node) => node.type === 'decl' && node.prop === 'min-height' && Number.parseFloat(node.value) >= 44))).toBe(true)
})

test('mixed slides use one fixed stage without attachment-specific sizing', () => {
  const markup = renderFeed(feedClientWith([mixedMemory]))
  expect(markup).toContain('data-media-stage="feed"')
  expect(markup).not.toMatch(/data-carousel-position="[2-4]"[^>]*style="aspect-ratio/)
})

test('automatic rendition checks prioritize an opened Memory and nearby pending cards only', () => {
  const pending = (id: string): MemoryDto => ({ ...videoMemory, id, attachments: [{ ...videoMemory.attachments[0]!, renditionStatus: 'pending', playbackPath: null }] })
  const items = [pending('far'), pending('near-a'), pending('near-b'), pending('near-c'), pending('near-d')]
  expect(selectPendingPrivateVideoIds(items, [], ['near-a', 'near-b', 'near-c', 'near-d'], 3)).toEqual(['near-a', 'near-b', 'near-c'])
  expect(selectPendingPrivateVideoIds(items, [items[0]!], ['near-a', 'near-b', 'near-c'], 3)).toEqual(['far', 'near-a', 'near-b'])
  expect(selectPendingPrivateVideoIds(items, [], ['far-ready', 'near-a'], 3)).toEqual(['near-a'])
  expect(selectPendingPrivateVideoIds(items, [], ['near-a', 'near-b', 'near-c', 'near-d'], 3, new Set(['near-a']))).toEqual(['near-b', 'near-c', 'near-d'])
  expect(selectPendingPrivateVideoIds(items, [items[0]!], ['near-a', 'near-b', 'near-c'], 3, new Set(['far', 'near-a']))).toEqual(['near-b', 'near-c'])
})

test('mixed memory renders one card with ordered slides and lazily mounts video', () => {
  const markup = renderFeed(feedClientWith([mixedMemory]))
  expect(markup.match(/data-memory-id="bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"/g)?.length).toBe(1)
  expect(markup).toContain('data-memory-kind="media"')
  const positions = [['1', 'photo'], ['2', 'video'], ['3', 'photo'], ['4', 'video']].map(([position, kind]) => markup.indexOf(`data-carousel-position="${position}" data-media-kind="${kind}"`))
  expect(positions.every((position) => position >= 0)).toBe(true)
  expect(positions).toEqual([...positions].sort((a, b) => a - b))
  expect(markup).toContain('data-carousel-dot="4"')
  expect(markup).not.toContain('1 / 4')
  expect(markup).toContain('data-seen-active-index="0"')
  expect(markup).toContain('data-carousel-active="true"')
  expect(markup.match(/aria-hidden="true"[^>]*inert=""/g)?.length).toBe(3)
  expect(markup).not.toContain('<video')
})

test('one mixed card keeps private photo, MAX video, private photo in order with lazy video', () => {
  const maxAttachment = {
    id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
    source: 'max' as const,
    kind: 'video' as const,
    width: 1_920,
    height: 1_080,
    durationMs: 24_000,
    playbackPath: `/api/v1/families/${familyId}/media/max-videos/eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee/content`,
  }
  const mixed: MemoryDto = {
    ...mixedMemory,
    attachments: [photoMemory.attachments[0]!, maxAttachment, mixedMemory.attachments[2]!],
  }
  const markup = renderFeed(feedClientWith([mixed]))
  expect(markup.match(/data-memory-id="bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"/g)?.length).toBe(1)
  const positions = [['1', 'photo'], ['2', 'video'], ['3', 'photo']].map(([position, kind]) => markup.indexOf(`data-carousel-position="${position}" data-media-kind="${kind}"`))
  expect(positions.every((position) => position >= 0)).toBe(true)
  expect(positions).toEqual([...positions].sort((a, b) => a - b))
  expect(markup).toContain('data-carousel-dot="3"')
  expect(markup).not.toContain('1 / 3')
  expect(markup).toContain('data-carousel-active="true"')
  expect(markup).not.toContain('<video')
  expect(markup).toContain('data-seen-active-index="0"')
})

test('a published private video still preparing its rendition shows pending state without becoming seen', () => {
  const pending = { ...videoMemory, attachments: [{ ...videoMemory.attachments[0], renditionStatus: 'pending' as const, playbackPath: null }] }
  const markup = renderFeed(feedClientWith([pending]))
  expect(markup).toContain('Подготавливаем видео')
  expect(markup).toContain('data-video-viewer-state="loading"')
  expect(markup).toContain('data-seen-ready="false"')
  expect(markup).not.toContain('Не удалось загрузить видео')
  expect(markup).not.toContain('role="alert"')
})

test('a pending video becomes ready from its detail response without replacing or refetching the feed list', () => {
  const pending = { ...videoMemory, attachments: [{ ...videoMemory.attachments[0], renditionStatus: 'pending' as const, playbackPath: null }] }
  const queryClient = feedClientWith([pending, noteMemory])
  const listKey = feedQueryKeys.list(familyId, 'all')
  const listBefore = queryClient.getQueryData(listKey)

  const before = renderFeed(queryClient)
  expect(before).toContain('Подготавливаем видео')
  expect(before.indexOf('Первые шаги')).toBeLessThan(before.indexOf('Сегодня впервые улыбнулась'))

  queryClient.setQueryData([...feedQueryKeys.all, familyId, 'video-rendition', '', 0, videoMemory.id], videoMemory)
  const after = renderFeed(queryClient)
  expect(after).toContain('Загружаем видео')
  expect(after).not.toContain('Подготавливаем видео')
  expect(after).toContain('data-video-viewer-state="loading"')
  expect(after).not.toContain('autoPlay')
  expect(after.indexOf('Первые шаги')).toBeLessThan(after.indexOf('Сегодня впервые улыбнулась'))
  expect(queryClient.getQueryData(listKey)).toBe(listBefore)
})

test('a ready private video keeps the source loading path and does not autoplay', () => {
  const markup = renderFeed(feedClientWith([videoMemory]))
  expect(markup).toContain('data-video-viewer-state="loading"')
  expect(markup).toContain('Загружаем видео')
  expect(markup).toContain('data-seen-ready="false"')
  expect(markup).not.toContain('Не удалось загрузить видео')
  expect(markup).not.toContain('autoPlay')
})

test('failed and unusable ready private videos retain a visible error', () => {
  for (const renditionStatus of ['failed', 'ready'] as const) {
    const unavailable = { ...videoMemory, attachments: [{ ...videoMemory.attachments[0], renditionStatus, playbackPath: null }] }
    const markup = renderFeed(feedClientWith([unavailable]))
    expect(markup).toContain('data-video-viewer-state="error"')
    expect(markup).toContain('Не удалось загрузить видео')
    expect(markup).toContain('data-seen-ready="false"')
  }
})

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

test('new-memory refresh keeps its notice and first id until refetch succeeds', async () => {
  const first = { current: memoryId }
  let cleared = 0
  const clear = () => { cleared += 1 }
  const failed = await refreshFromTop(async () => ({ isError: true, data: { pages: [{ items: [photoMemory] }] } }), first, () => true, clear)
  expect(failed).toBe(false)
  expect(first.current).toBe(memoryId)
  expect(cleared).toBe(0)
  const stale = await refreshFromTop(async () => ({ data: { pages: [{ items: [photoMemory] }] } }), first, () => false, clear)
  expect(stale).toBe(false)
  expect(first.current).toBe(memoryId)
  const succeeded = await refreshFromTop(async () => ({ isError: false, data: { pages: [{ items: [photoMemory] }] } }), first, () => true, clear)
  expect(succeeded).toBe(true)
  expect(first.current).toBe(photoMemory.id)
  expect(cleared).toBe(1)
})

test('the feed ignores legacy type filters and keeps the all-content empty state', () => {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  queryClient.setQueryData(feedQueryKeys.list(familyId, 'all'), {
    pages: [{ items: [], nextCursor: null }], pageParams: [null],
  })
  const markup = renderToStaticMarkup(createElement(QueryClientProvider, { client: queryClient }, createElement(FeedPage, {
    childName: 'Лиза', childSubtitle: '2 года', familyId, familyTimezone: 'Europe/Moscow', filter: 'photo',
    hostBridge, insets: { top: 0, right: 0, bottom: 0, left: 0 }, onFamily: () => undefined,
    onFilterChange: () => undefined, onAccessLost: () => undefined, role: 'full', transport,
  })))
  expect(markup).toContain('data-slot="feed-empty"')
  expect(markup).not.toContain('data-slot="feed-filter-empty"')
  expect(markup).not.toContain('Показать все')
  expect(markup).not.toContain('Открыть бота')
})

test('feed empty and page-error states expose only real actions and distinct retry copy', () => {
  const empty = renderToStaticMarkup(createElement(EmptyState, { mode: 'full' }))
  expect(empty).not.toContain('Открыть бота')
  const first = renderToStaticMarkup(createElement(InlineError, { onRetry: () => undefined }))
  const next = renderToStaticMarkup(createElement(InlineError, { nextPage: true, onRetry: () => undefined }))
  expect(first).toContain('Не удалось обновить ленту')
  expect(next).toContain('Не удалось загрузить ещё')
})

test('real memory DTOs map to explicit memoLy card layouts without demo media', () => {
  const markup = renderFeed(feedClientWith([photoMemory, videoMemory, memory, noteMemory]))

  expect(markup).toContain('data-memory-kind="photo"')
  expect(markup).toContain('data-slot="memoly-author-row"')
  expect(markup).toContain('aria-label="Поставить сердечко"')
  expect(markup).toContain('data-slot="memoly-photo-layout"')
  expect(markup).toContain('data-slot="memoly-video-layout"')
  expect(markup).toContain('data-slot="memoly-voice-layout"')
  expect(markup).toContain('data-slot="memoly-note-layout"')
  expect(markup).not.toContain('date-dot')
  expect(markup).not.toContain('/assets/photo-park.webp')
})

test('video cards remove the standalone open action and collapse when the caption is empty', () => {
  const card = MemoryCardPresentation({
    actions: null,
    authorInitials: 'М',
    authorName: 'Мама',
    body: '',
    kind: 'video',
    liked: false,
    likeCount: 0,
    media: createElement('div', null, 'video'),
    memoryId: 'video-empty-body',
    occurredTime: '12 мая 2024, 10:24',
    onLike: () => undefined,
    onOpen: () => undefined,
  })

  const markup = renderToStaticMarkup(card)
  expect(markup).toContain('data-memory-kind="video"')
  expect(markup).toMatch(/class="memory-media-slot video-wrap(?: |")/)
  expect(markup).not.toContain('Открыть')
  expect(markup).toContain('aria-label="Поставить сердечко"')
})

test('video cards treat whitespace-only captions as empty', () => {
  const markup = renderToStaticMarkup(MemoryCardPresentation({
    actions: null,
    authorInitials: 'М',
    authorName: 'Мама',
    body: '   \n\t',
    kind: 'video',
    liked: false,
    likeCount: 0,
    media: createElement('div', null, 'video'),
    memoryId: 'video-whitespace-body',
    occurredTime: '12 мая 2024, 10:24',
    onLike: () => undefined,
    onOpen: () => undefined,
  }))

  expect(markup).toMatch(/class="memory-media-slot video-wrap(?: |")/)
  expect(markup).not.toContain('has-caption')
  expect(markup).not.toContain('class="caption"')
})

test('memory child details stay out of the card while like state and count remain visible', () => {
  for (const childProps of [
    { childName: 'Лиза', childAvatarUrl: '/child.webp', childAvatarCrop: { x: 0, y: 0, scale: 1 } },
    {},
  ]) {
    const markup = renderToStaticMarkup(MemoryCardPresentation({
      actions: null,
      authorInitials: 'М',
      authorName: 'Мама',
      ...childProps,
      body: 'Первое слово',
      kind: 'photo',
      liked: true,
      likeCount: 3,
      media: createElement('div', null, 'photo'),
      memoryId: 'child-tag-hidden',
      occurredTime: 'Сегодня, 10:24',
      onLike: () => undefined,
      onOpen: () => undefined,
    }))

    expect(markup).not.toContain('memory-child-tag')
    expect(markup).not.toContain('Лиза')
    expect(markup).toContain('aria-label="Убрать сердечко"')
    expect(markup).toContain('aria-pressed="true"')
    expect(markup).toContain('>3</span>')
  }
})

test('delete preview cards preserve the selected memory while removing interactive actions', () => {
  const markup = renderToStaticMarkup(MemoryCardPresentation({
    actions: createElement('button', { 'aria-label': 'Действия с воспоминанием' }, '...'),
    authorInitials: 'М',
    authorName: 'Мама',
    body: 'Первое слово',
    kind: 'voice',
    liked: true,
    likeCount: 2,
    media: createElement('div', null, 'static waveform'),
    memoryId: memoryId,
    mode: 'delete-preview',
    occurredTime: '12 мая 2024, 10:24',
    onLike: () => undefined,
    onOpen: () => undefined,
  }))

  expect(markup).toContain('aria-hidden="true"')
  expect(markup).toContain('memoly-memory-delete-preview')
  expect(markup).not.toContain('Действия с воспоминанием')
  expect(markup).not.toContain('Открыть воспоминание')
  expect(markup).toContain('disabled=""')
})

test('delete preview notes keep seen hooks and render the gradient as noninteractive text', () => {
  const seenContentRef = { current: null as HTMLDivElement | null }
  const markup = renderToStaticMarkup(MemoryCardPresentation({
    actions: null,
    authorInitials: 'М',
    authorName: 'Мама',
    body: 'Заметка для удаления',
    kind: 'note',
    liked: false,
    likeCount: 0,
    media: null,
    memoryId,
    mode: 'delete-preview',
    occurredTime: '12 мая 2024, 10:24',
    onLike: () => undefined,
    onOpen: () => undefined,
    seenContentRef,
  }))
  const noteIndex = markup.indexOf('data-memoly-note-gradient')
  const noteEnd = markup.indexOf('</div>', noteIndex)
  const noteMarkup = markup.slice(noteIndex, noteEnd)

  expect(markup).toContain('data-seen-main="" data-seen-ready="true" data-slot="memoly-note-layout"')
  expect(markup).toContain('memoly-memory-delete-preview')
  expect(noteIndex).toBeGreaterThanOrEqual(0)
  expect(noteMarkup).not.toContain('<button')
  expect(noteMarkup).toContain('Заметка для удаления')
})

test('video captions remain visible without becoming a separate detail button', () => {
  const markup = renderToStaticMarkup(MemoryCardPresentation({
    actions: null,
    authorInitials: 'М',
    authorName: 'Мама',
    body: 'Первые шаги',
    kind: 'video',
    liked: false,
    likeCount: 0,
    media: createElement('div', null, 'video'),
    memoryId: 'video-with-caption',
    occurredTime: '12 мая 2024, 10:24',
    onLike: () => undefined,
    onOpen: () => undefined,
  }))

  expect(markup).toContain('Первые шаги')
  expect(markup).toContain(' caption"')
  expect(markup).not.toContain('Открыть воспоминание')
  expect(markup).not.toContain('>Открыть<')
})

test('empty photo and voice captions do not create a blank detail footer', () => {
  let opens = 0
  for (const kind of ['photo', 'voice'] as const) {
    const card = MemoryCardPresentation({
      actions: null,
      authorInitials: 'М',
      authorName: 'Мама',
      body: '',
      kind,
      liked: false,
      likeCount: 0,
      media: createElement('div', null, kind),
      memoryId: `${kind}-empty-body`,
      occurredTime: '12 мая 2024, 10:24',
      onLike: () => undefined,
      onOpen: () => { opens += 1 },
    })

    const markup = renderToStaticMarkup(card)
    const openAction = findOpenAction(card)
    expect(markup).toContain(`data-memory-kind="${kind}"`)
    expect(markup).not.toContain('Открыть воспоминание')
    expect(markup).not.toContain('caption-open-empty')
    expect(openAction).toBeNull()
  }

  expect(opens).toBe(0)
})

test('viewer cards keep like enabled while omitting the delete action', () => {
  const viewerMemory = { ...memory, capabilities: { ...memory.capabilities, delete: false } }
  const markup = renderFeed(feedClientWith([viewerMemory]), 'viewer')

  expect(markup).toContain('aria-label="Действия с воспоминанием"')
  expect(markup).toContain('aria-label="Поставить сердечко"')
  expect(markup).toContain('aria-pressed="false"')
  expect(markup).not.toMatch(/aria-label="Поставить сердечко"[^>]*disabled=""/)
})

test('routes the three Add actions to one supported composer and exposes Edit only by capability', () => {
  expect(composerModeForAdd('photo', childId)).toBe('photo')
  expect(composerModeForAdd('note', childId)).toBe('note')
  expect(composerModeForAdd('video', childId)).toBe('video')
  expect(composerModeForAdd('photo', undefined)).toBeNull()
  expect(memoryActionNames({ edit: true, delete: true, like: true })).toEqual(['details', 'edit', 'delete'])
  expect(memoryActionNames({ edit: false, delete: false, like: true })).toEqual(['details'])
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
    posterReady: true,
    posterUrl: 'blob:private-telegram-video-poster',
    width: 1_920,
    height: 1_080,
  }))
  expect(markup).toContain('src="blob:private-telegram-video-poster"')
  expect(markup).toContain('0:24')
  expect(markup).toContain('aspect-ratio:1920 / 1080')
  expect(markup).toContain('aria-label="Смотреть видео в Telegram"')
  expect(markup).toContain('data-slot="telegram-video-play-control"')
  expect(markup).toContain('data-seen-ready="true"')
  expect(markup).not.toMatch(/<(?:video|audio)\b/)
})

test('a Telegram video poster keeps its overlays in a local stacking context below bottom navigation', () => {
  const poster = renderToStaticMarkup(createElement(TelegramVideoPoster, {
    durationMs: 24_000,
    posterUrl: 'blob:private-telegram-video-poster',
    width: 1_920,
    height: 1_080,
  }))
  const navigation = renderToStaticMarkup(createElement(BottomNavigation, {
    active: 'feed',
    onFamily: () => undefined,
    onFeed: () => undefined,
    role: 'full',
  }))

  expect(poster).toContain('isolate')
  expect(navigation).toContain('z-30')
})

test('a Telegram video handoff opens the verified link before closing the Mini App', async () => {
  const calls: string[] = []
  const bridge = { ...hostBridge,
    openTelegramVideo: (link: string) => { calls.push(`open:${link}`); return true },
    close: () => { calls.push('close') },
  }

  await navigateToTelegramVideo(bridge, async () => ({ telegramDeepLink: 'https://t.me/OurMemoriesDevBot?start=watch_abcdefghijklmnopqrstuvwxyzABCDEF' }))

  expect(calls).toEqual([
    'open:https://t.me/OurMemoriesDevBot?start=watch_abcdefghijklmnopqrstuvwxyzABCDEF',
    'close',
  ])
})

test('a Telegram video handoff does not close when the bridge cannot open its link', async () => {
  let closed = false
  const bridge = { ...hostBridge, openTelegramVideo: () => false, close: () => { closed = true } }

  await expect(navigateToTelegramVideo(bridge, async () => ({ telegramDeepLink: 'https://t.me/OurMemoriesDevBot?start=watch_abcdefghijklmnopqrstuvwxyzABCDEF' }))).rejects.toThrow('unavailable')
  expect(closed).toBe(false)
})

test('a Telegram video handoff blocks duplicate taps until a failed request settles', async () => {
  let attempts = 0
  let rejectRequest: ((error: Error) => void) | undefined
  const action = createSingleFlightTelegramVideoHandoff(async () => {
    attempts += 1
    if (attempts > 1) throw new Error('handoff failed')
    await new Promise<never>((_, reject) => { rejectRequest = reject })
  })

  const first = action()
  const second = action()
  expect(await second).toBe(false)
  expect(attempts).toBe(1)
  rejectRequest!(new Error('handoff failed'))
  await expect(first).rejects.toThrow('handoff failed')
  await expect(action()).rejects.toThrow('handoff failed')
  expect(attempts).toBe(2)
})

test('a Telegram video poster exposes a transient opening state without changing its aspect ratio', () => {
  const markup = renderToStaticMarkup(createElement(TelegramVideoPoster, {
    busy: true, disabled: true, durationMs: 24_000, posterUrl: 'blob:private-telegram-video-poster', width: 1_920, height: 1_080,
  }))
  expect(markup).toContain('Открываем видео…')
  expect(markup).toContain('aspect-ratio:1920 / 1080')
  expect(markup).toContain('disabled=""')
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

test('a private feed photo preserves portrait, landscape, and square proportions without cropping', () => {
  for (const [width, height] of [[720, 1_080], [1_920, 1_080], [1_080, 1_080]] as const) {
    const markup = renderToStaticMarkup(createElement(PhotoImage, {
      alt: 'Воспоминание',
      height,
      src: 'blob:private-photo',
      width,
    }))

    expect(markup).toContain(`width="${width}"`)
    expect(markup).toContain(`height="${height}"`)
    expect(markup).toContain('h-auto')
    expect(markup).toContain('w-full')
    expect(markup).not.toContain('aspect-video')
    expect(markup).not.toContain('object-cover')
    expect(markup).not.toContain('absolute')
  }
})

test('a ready MAX video preview embeds native playback without a persistent MAX action', () => {
  for (const [width, height] of [[720, 1_080], [1_920, 1_080], [1_080, 1_080]] as const) {
    const markup = renderToStaticMarkup(createElement(MaxVideoPreview, {
      durationMs: 24_000,
      height,
      onOpen: () => undefined,
      src: '/api/v1/families/family/media/max-videos/video/content',
      width,
    }))

    expect(markup).toContain('<video')
    expect(markup).toContain('controls=""')
    expect(markup).toContain('preload="metadata"')
    expect(markup).toContain('playsInline=""')
    expect(markup).not.toContain('#t=0.001')
    expect(markup).toContain(`aspect-ratio:${width} / ${height}`)
    expect(markup).toContain('object-contain')
    expect(markup).toContain('Смотреть видео')
    expect(markup).toContain('data-video-viewer-state="ready"')
    expect(markup).not.toContain('Открыть в MAX')
    expect(markup).not.toContain('Открыть видео в memoLy')
    expect(markup).not.toContain('aspect-video')
    expect(markup).not.toContain('object-cover')
  }
})

test('MAX readiness URL uses the validated playback reference, not attachment identity', () => {
  const referenceId = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'
  const playbackPath = `/api/v1/families/${familyId}/media/max-videos/${referenceId}/content`
  expect(maxVideoReadinessPath(playbackPath)).toBe(`/api/v1/families/${familyId}/media/max-videos/${referenceId}/readiness`)
  expect(maxVideoReadinessPath(`${playbackPath}?token=unsafe`)).toBeNull()
  expect(maxVideoReadinessPath(`/api/v1/families/${familyId}/media/${referenceId}/content`)).toBeNull()
})

test('MAX processing and unknown remain neutral while unavailable is terminal', () => {
  for (const [readinessState, label] of [['processing', 'Видео обрабатывается…'], ['unknown', 'Готовность видео пока неизвестна'], ['unavailable', 'Видео недоступно']] as const) {
    const markup = renderToStaticMarkup(createElement(MaxVideoPreview, {
      durationMs: 24_000, height: 720, onCheckReadiness: () => undefined, onOpen: () => undefined,
      readinessState, src: null, width: 1_280,
    }))
    expect(markup).toContain(`data-video-viewer-state="${readinessState}"`)
    expect(markup).toContain(label)
    expect(markup).toContain('data-seen-ready="false"')
    expect(markup).not.toContain('Не удалось загрузить видео')
    if (readinessState === 'unavailable') expect(markup).not.toContain('Проверить готовность')
    else expect(markup).toContain('Проверить готовность')
  }
  expect(maxVideoReadinessInterval({ data: { state: 'processing', recheckable: true }, dataUpdateCount: 11, errorUpdateCount: 0 })).toBe(5_000)
  expect(maxVideoReadinessInterval({ data: { state: 'unknown', recheckable: true }, dataUpdateCount: 12, errorUpdateCount: 0 })).toBe(false)
  expect(maxVideoReadinessInterval({ data: undefined, dataUpdateCount: 0, errorUpdateCount: 4 })).toBe(false)
  expect(maxVideoReadinessInterval({ data: { state: 'unavailable', recheckable: false }, dataUpdateCount: 1, errorUpdateCount: 0 })).toBe(false)
})

test('MAX readiness network checks never exceed three simultaneous requests', async () => {
  let active = 0
  let peak = 0
  const releases: Array<() => void> = []
  const checks = Array.from({ length: 5 }, () => withMaxVideoReadinessSlot(new AbortController().signal, async () => {
    active += 1
    peak = Math.max(peak, active)
    await new Promise<void>((resolve) => releases.push(resolve))
    active -= 1
  }))
  await Promise.resolve()
  expect(active).toBe(3)
  for (let index = 0; index < 5; index += 1) {
    releases[index]?.()
    await Promise.resolve()
    await Promise.resolve()
  }
  await Promise.all(checks)
  expect(peak).toBe(3)
})

test('an aborted queued MAX readiness check never starts a request', async () => {
  const releases: Array<() => void> = []
  let started = 0
  const active = Array.from({ length: 3 }, () => withMaxVideoReadinessSlot(new AbortController().signal, async () => {
    started += 1
    await new Promise<void>((resolve) => releases.push(resolve))
  }))
  const controller = new AbortController()
  const queued = withMaxVideoReadinessSlot(controller.signal, async () => { started += 1 })
  controller.abort()
  await expect(queued).rejects.toBeDefined()
  expect(started).toBe(3)
  releases.forEach((release) => release())
  await Promise.all(active)
  expect(started).toBe(3)
})

test('a MAX video source is assigned and loaded once per distinct source', () => {
  const loads: string[] = []
  const video = {
    src: '',
    load() { loads.push(this.src) },
    removeAttribute(name: string) { if (name === 'src') this.src = '' },
  }
  let assigned: string | null = null

  assigned = loadMaxVideoSourceOnce(video, '/video-a.mp4', assigned)
  assigned = loadMaxVideoSourceOnce(video, '/video-a.mp4', assigned)
  assigned = loadMaxVideoSourceOnce(video, '/video-b.mp4', assigned)
  assigned = loadMaxVideoSourceOnce(video, null, assigned)
  assigned = loadMaxVideoSourceOnce(video, null, assigned)

  expect(loads).toEqual(['/video-a.mp4', '/video-b.mp4', ''])
  expect(assigned).toBeNull()
})

test('a MAX video frame keeps the source ratio, contains playback, and caps its height', () => {
  const markup = renderToStaticMarkup(createElement(MaxVideoPreview, {
    durationMs: 24_000,
    height: 1_920,
    onOpen: () => undefined,
    src: '/api/v1/families/family/media/max-videos/video/content',
    width: 1_080,
  }))

  expect(markup).toContain('data-slot="max-video-frame"')
  expect(markup).toContain('aspect-ratio:1080 / 1920')
  expect(markup).toContain('width:min(100%, calc(75dvh * 1080 / 1920))')
  expect(markup).toContain('max-h-[75dvh]')
  expect(markup).toContain('object-contain')
})

test('a MAX video exposes only a numeric media error code for diagnostics', () => {
  const markup = renderToStaticMarkup(createElement(MaxVideoPreview, {
    durationMs: 24_000,
    height: 720,
    onOpen: () => undefined,
    src: '/api/v1/families/family/media/max-videos/video/content',
    width: 1_280,
  }))

  expect(markup).toContain('data-media-error-code="0"')
  expect(markup).not.toContain('access-token')
  expect(markup).not.toContain('bearer=')
})

test('a MAX video without an authenticated source keeps its safe pending state', () => {
  const markup = renderToStaticMarkup(createElement(MaxVideoPreview, {
    durationMs: null,
    height: null,
    onOpen: () => undefined,
    src: null,
    width: null,
  }))

  expect(markup).toContain('Видео')
  expect(markup).toContain('Загружаем видео…')
  expect(markup).not.toContain('Открыть в MAX')
  expect(markup).toContain('aspect-ratio:16 / 9')
})

test('a failed MAX source shows a load error while retaining the safe fallback and MAX action', () => {
  const markup = renderToStaticMarkup(createElement(MaxVideoPreview, {
    durationMs: 24_000,
    height: 720,
    onOpen: () => undefined,
    sourceStatus: 'error',
    onRetry: () => undefined,
    src: null,
    width: 1_280,
  }))

  expect(markup).toContain('Не удалось загрузить видео')
  expect(markup).toContain('Повторить')
  expect(markup).toContain('Открыть в MAX')
  expect(markup).toContain('aspect-ratio:1280 / 720')
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

test('delete request uses the family-scoped endpoint and current memory version', async () => {
  let path = ''
  let options: unknown
  const deletingTransport: AuthenticatedTransport = {
    ...transport,
    raw: async (receivedPath, receivedOptions) => {
      path = receivedPath
      options = receivedOptions
      return new Response(null, { status: 204 })
    },
  }

  await deleteMemory(deletingTransport, familyId, memoryId, memory.version)

  expect(path).toBe(`/api/v1/families/${familyId}/memories/${memoryId}`)
  expect(options).toEqual({ method: 'DELETE', headers: { 'If-Match': '1' } })
})

test('optimistic deletion removes a memory from every cached family filter', () => {
  const queryClient = feedClient()
  queryClient.setQueryData(feedQueryKeys.list(familyId, 'voice'), {
    pages: [{ items: [memory], nextCursor: null }], pageParams: [null],
  })

  const snapshot = removeMemoryFromCachedFeeds(queryClient, familyId, memoryId)

  expect(queryClient.getQueryData<{ pages: Array<{ items: MemoryDto[] }> }>(feedQueryKeys.list(familyId, 'all'))?.pages[0]?.items).toEqual([])
  expect(queryClient.getQueryData<{ pages: Array<{ items: MemoryDto[] }> }>(feedQueryKeys.list(familyId, 'voice'))?.pages[0]?.items).toEqual([])
  expect(snapshot).toHaveLength(2)
})

test('memory actions menu is available to every role while delete remains capability-gated', () => {
  const fullMarkup = renderFeed(feedClient())
  expect(fullMarkup).toContain('aria-label="Действия с воспоминанием"')

  const viewerClient = feedClient()
  viewerClient.setQueryData(feedQueryKeys.list(familyId, 'all'), {
    pages: [{ items: [{ ...memory, capabilities: { ...memory.capabilities, delete: false } }], nextCursor: null }], pageParams: [null],
  })
  expect(renderFeed(viewerClient)).toContain('aria-label="Действия с воспоминанием"')
})

test('memory like exposes a dedicated lightweight control while preserving pressed and count semantics', () => {
  const props = {
    actions: null,
    authorInitials: 'М',
    authorName: 'Мама',
    body: '',
    kind: 'note' as const,
    media: null,
    memoryId,
    occurredTime: '10:00',
    onLike: () => undefined,
    onOpen: () => undefined,
  }
  const empty = renderToStaticMarkup(createElement(MemoryCardPresentation, { ...props, liked: false, likeCount: 0 }))
  const liked = renderToStaticMarkup(createElement(MemoryCardPresentation, { ...props, liked: true, likeCount: 12 }))

  expect(empty).toMatch(/<button[^>]*aria-label="Поставить сердечко"[^>]*aria-pressed="false"[^>]*class="memory-like"/)
  expect(empty).toMatch(/class="memory-like"[^>]*><span[^>]*data-slot="webp-icon"[^>]*background-color:currentColor/)
  expect(empty).not.toContain('>0</span>')
  expect(liked).toMatch(/<button[^>]*aria-label="Убрать сердечко"[^>]*aria-pressed="true"[^>]*class="memory-like is-liked"/)
  expect(liked).toMatch(/class="memory-like is-liked"[^>]*><span[^>]*data-slot="webp-icon"[^>]*background-color:currentColor/)
  expect(liked).toContain('>12</span>')
})

test('memoLy feed card keeps the media slot and open-memory callback around a private album', () => {
  let opened = false
  const markup = renderToStaticMarkup(createElement(FeedMemoryCard, {
    familyTimezone: 'Europe/Moscow',
    memory,
    onDelete: () => Promise.resolve(),
    onLike: () => undefined,
    onOpen: () => { opened = true },
    renderAttachment: () => createElement('div', { 'data-slot': 'private-photo-album' }, 'PhotoSwipe slot'),
    renderDeleteAction: () => null,
  }))

  expect(markup).toContain('class="ml-memory ')
  expect(markup).toContain('data-slot="private-photo-album"')
  expect(markup).toContain('Открыть воспоминание Первое слово')
  expect(markup).not.toContain('/api/v1/families/')
  expect(opened).toBe(false)
})

test('memoLy feed card preserves line breaks in a multi-line memory body', () => {
  const markup = renderToStaticMarkup(createElement(FeedMemoryCard, {
    familyTimezone: 'Europe/Moscow',
    memory: { ...memory, body: 'Первая строка\nВторая строка' },
    onDelete: () => Promise.resolve(),
    onLike: () => undefined,
    onOpen: () => undefined,
    renderAttachment: () => null,
  }))

  expect(markup).toContain('ml-caption-text')
  expect(markup).toContain('whitespace-pre-wrap')
  expect(markup).toContain('Первая строка\nВторая строка')
})

test('memoLy feed card clamps long captions without changing the full body passed to detail', () => {
  const body = 'ОченьДлинныйТокен'.repeat(500)
  const markup = renderToStaticMarkup(createElement(FeedMemoryCard, {
    familyTimezone: 'Europe/Moscow',
    memory: { ...memory, body },
    onDelete: () => Promise.resolve(),
    onLike: () => undefined,
    onOpen: () => undefined,
    renderAttachment: () => null,
  }))

  expect(markup).toContain('line-clamp-4')
  expect(markup).toContain(body)
})

function feedClient() {
  return feedClientWith([memory])
}

function feedClientWith(items: MemoryDto[]) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  queryClient.setQueryData(feedQueryKeys.list(familyId, 'all'), {
    pages: [{ items, nextCursor: 'page-2' }],
    pageParams: [null],
  })
  return queryClient
}

function renderFeed(queryClient: QueryClient, role: 'full' | 'viewer' = 'full') {
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
    role,
    transport,
  })))
}

const transport: AuthenticatedTransport = {
  request: async () => { throw new Error('unexpected feed request during static render') },
  raw: async () => { throw new Error('unexpected media request during static render') },
}

test('the feed header renders the memoLy logo above the child profile instead of the former text brand', () => {
  const markup = renderToStaticMarkup(createElement(FeedShell, {
    activeFilter: 'all',
    childName: 'Лиза',
    childSubtitle: '2 года',
    insets: { top: 0, right: 0, bottom: 0, left: 0 },
    onFilterChange: () => undefined,
    role: 'full',
  }, createElement('p', null, 'Лента')))

  expect(markup).toContain('data-slot="app-brand"')
  expect(markup).toContain('src="/assets/brand/memoly-logo-correct.webp"')
  expect(markup).toContain('alt="memoLy"')
  expect(markup).not.toContain('Наши воспоминания')
  expect(markup.indexOf('data-slot="app-brand"')).toBeLessThan(markup.indexOf('data-slot="child-profile"'))
})

test('the feed presentation keeps one memory surface and only the unread mode toggle', () => {
  const markup = renderToStaticMarkup(createElement(FeedPresentation, {
    activeFilter: 'all',
    childName: 'Лиза',
    childSubtitle: '2 года',
    insets: { top: 0, right: 0, bottom: 0, left: 0 },
    unreadState: 'ready',
    unreadOnly: false,
    onUnreadChange: () => undefined,
    onFamily: () => undefined,
    onFeed: () => undefined,
    onFilterChange: () => undefined,
    role: 'full',
  }, createElement('section', { className: 'feed-section', 'data-kind': 'photo' },
    createElement('h2', { className: 'date-heading' }, 'Сегодня'),
    createElement(MemoryCardPresentation, {
      actions: createElement('button', { 'aria-label': 'Действия с воспоминанием', type: 'button' }),
      authorInitials: 'М',
      authorName: 'Мама',
      body: 'Первое слово',
      kind: 'photo',
      liked: false,
      likeCount: 0,
      media: createElement('img', { alt: 'Воспоминание', src: '/photo.webp' }),
      memoryId,
      occurredTime: 'Сегодня, 10:24',
      onLike: () => undefined,
      onOpen: () => undefined,
    }),
  )))

  expect(markup).not.toContain('memoly-filter-rail')
  expect(markup).not.toContain('Фото</span>')
  expect(markup).toContain('aria-label="Режим ленты"')
  expect(markup).toContain('>Все</span>')
  expect(markup).toContain('>Непросмотренные</span>')
  expect(markup).toContain('class="feed-section"')
  expect(markup).toContain('class="date-heading"')
  expect(markup).not.toContain('class="date-dot"')
  expect(markup).toContain('class="memory-card surface-raised')
  expect(markup).toContain('class="memory-header"')
  expect(markup).toContain('class="memory-media-slot"')
  expect(markup).not.toContain('surface-inset')
  expect(markup).toContain('class="actions"')
  expect(markup).toMatch(/class="caption(?: |")/)
})

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

function findOpenAction(node: ReactNode): ReactElement<{ body?: string; kind?: MemoryDto['kind']; onOpen?: () => void }> | null {
  if (Array.isArray(node)) {
    for (const child of node) {
      const match = findOpenAction(child)
      if (match) return match
    }
    return null
  }
  if (!node || typeof node !== 'object' || !('type' in node) || !('props' in node)) return null
  const element = node as ReactElement<{ body?: string; kind?: MemoryDto['kind']; onOpen?: () => void }>
  if (typeof element.type === 'function' && element.type.name === 'MemoryOpenButton' && element.props.kind && element.props.onOpen) return element
  return findOpenAction(element.props.children)
}
