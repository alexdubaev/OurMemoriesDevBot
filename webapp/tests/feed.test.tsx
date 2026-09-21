import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { MemoryDto } from '@web-app-demo/contracts'
import { expect, test } from 'bun:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import { FeedPage, MaxVideoPreview, PhotoImage, TelegramVideo, TelegramVideoPoster } from '../src/features/feed/FeedPage'
import { loadMaxVideoSourceOnce } from '../src/features/feed/max-video-source'
import { composerModeForAdd, memoryActionNames } from '../src/features/feed/composer-routing'
import { FeedShell } from '../src/features/feed/components/FeedShell'
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

test('real memory DTOs map to explicit memoLy card layouts without demo media', () => {
  const markup = renderFeed(feedClientWith([photoMemory, videoMemory, memory, noteMemory]))

  expect(markup).toContain('data-memory-kind="photo"')
  expect(markup).toContain('data-slot="memoly-author-row"')
  expect(markup).toContain('aria-label="Поставить сердечко"')
  expect(markup).toContain('data-slot="memoly-photo-layout"')
  expect(markup).toContain('data-slot="memoly-video-layout"')
  expect(markup).toContain('data-slot="memoly-voice-layout"')
  expect(markup).toContain('data-slot="memoly-note-layout"')
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
  expect(markup).toMatch(/class="media-well surface-inset video-wrap(?: |")/)
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

  expect(markup).toMatch(/class="media-well surface-inset video-wrap(?: |")/)
  expect(markup).not.toContain('has-caption')
  expect(markup).not.toContain('class="caption"')
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

test('photo and voice cards keep their caption detail action when the body is empty', () => {
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
    expect(markup).toContain('Открыть')
    expect(markup).toContain(`aria-label="Открыть воспоминание ${kind}"`)
    expect(markup).toContain('caption-open-empty')
    expect(openAction).not.toBeNull()
    openAction?.props.onOpen?.()
  }

  expect(opens).toBe(2)
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

test('a private photo uses its intrinsic dimensions without a fixed crop', () => {
  for (const [width, height] of [[720, 1_080], [1_920, 1_080], [1_080, 1_080]] as const) {
    const markup = renderToStaticMarkup(createElement(PhotoImage, {
      alt: 'Воспоминание',
      height,
      src: 'blob:private-photo',
      width,
    }))

    expect(markup).toContain(`width="${width}"`)
    expect(markup).toContain(`height="${height}"`)
    expect(markup).toContain(`aspect-ratio:${width} / ${height}`)
    expect(markup).toContain('object-contain')
    expect(markup).not.toContain('object-cover')
    expect(markup).not.toContain('aspect-[4/3]')
  }
})

test('a MAX video preview embeds native playback and keeps MAX as a secondary action', () => {
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
    expect(markup).toContain('Открыть в MAX')
    expect(markup).not.toContain('Открыть видео в memoLy')
    expect(markup).not.toContain('aspect-video')
    expect(markup).not.toContain('object-cover')
  }
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

test('a MAX video without an authenticated source keeps a safe video fallback', () => {
  const markup = renderToStaticMarkup(createElement(MaxVideoPreview, {
    durationMs: null,
    height: null,
    onOpen: () => undefined,
    src: null,
    width: null,
  }))

  expect(markup).toContain('Видео')
  expect(markup).toContain('Открыть в MAX')
  expect(markup).toContain('aspect-ratio:16 / 9')
})

test('a failed MAX source shows a load error while retaining the safe fallback and MAX action', () => {
  const markup = renderToStaticMarkup(createElement(MaxVideoPreview, {
    durationMs: 24_000,
    height: 720,
    onOpen: () => undefined,
    sourceStatus: 'error',
    src: null,
    width: 1_280,
  }))

  expect(markup).toContain('Не удалось загрузить видео')
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

test('the feed presentation keeps the approved filter and memory composition', () => {
  const markup = renderToStaticMarkup(createElement(FeedPresentation, {
    activeFilter: 'all',
    childName: 'Лиза',
    childSubtitle: '2 года',
    insets: { top: 0, right: 0, bottom: 0, left: 0 },
    onFamily: () => undefined,
    onFeed: () => undefined,
    onFilterChange: () => undefined,
    role: 'full',
  }, createElement('section', { className: 'feed-section', 'data-kind': 'photo' },
    createElement('h2', { className: 'date-heading' }, 'Сегодня', createElement('span', { 'aria-hidden': 'true', className: 'date-dot' })),
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

  expect(markup).toContain('class="filters-wrap surface-inset"')
  expect(markup).toContain('class="filters"')
  expect(markup.match(/class="filter(?: |")/g)).toHaveLength(5)
  expect(markup).toContain('class="feed-section"')
  expect(markup).toContain('class="date-heading"')
  expect(markup).toContain('class="date-dot"')
  expect(markup).toContain('class="memory-card surface-raised')
  expect(markup).toContain('class="memory-header"')
  expect(markup).toContain('class="media-well surface-inset"')
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
