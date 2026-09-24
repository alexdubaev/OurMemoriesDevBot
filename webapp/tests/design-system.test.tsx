import { expect, test } from 'bun:test'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { BottomNavigation } from '../src/components/BottomNavigation'
import { WebpIcon } from '../src/components/WebpIcon'
import { AddSheetPanel, MediaChoiceAction, VoiceOrVideoAction, VoiceOrVideoPanel } from '../src/features/memoly-ui/AddSheetPresentation'
import { subscribeAddSheetBack } from '../src/features/memoly-ui/add-sheet-back'
import { Drawer } from '../src/components/ui/drawer'
import {
  DateHeading,
  EmptyState,
  FeedShell,
  InlineError,
  MemoryCardFrame,
} from '../src/features/feed/components'
import { FeedPresentation } from '../src/features/feed/presentation'
import { AvatarLetter } from '../src/features/session/components/AvatarLetter'

function render(component: Parameters<typeof renderToStaticMarkup>[0]) {
  return renderToStaticMarkup(component)
}

test('WebpIcon selects local 2x and 3x assets while keeping button-owned labels single', () => {
  const markup = render(
    createElement(WebpIcon, {
      decorative: true,
      name: 'home',
      size: 22,
      state: 'active',
    }),
  )

  expect(markup).toContain('src="/assets/icons/home-active@2x.webp"')
  expect(markup).toContain(
    'srcSet="/assets/icons/home-active@2x.webp 2x, /assets/icons/home-active@3x.webp 3x"',
  )
  expect(markup).toContain('width="22"')
  expect(markup).toContain('height="22"')
  expect(markup).toContain('alt=""')
  expect(markup).toContain('aria-hidden="true"')
})

test('feed primitives expose semantic structure and approved full-access copy', () => {
  const markup = render(
    createElement('div', null,
      createElement(AvatarLetter, { name: 'Варя' }),
      createElement(DateHeading, null, 'Сегодня'),
      createElement(MemoryCardFrame, null, createElement('p', null, 'Тестовое воспоминание')),
      createElement(EmptyState, { mode: 'full', onOpenBot: () => undefined }),
      createElement(InlineError, { onRetry: () => undefined }),
    ),
  )

  expect(markup).toContain('data-slot="avatar-letter"')
  expect(markup).toContain('>В<')
  expect(markup).toContain('<h2')
  expect(markup).toContain('>Сегодня</h2>')
  expect(markup).toContain('<article')
  expect(markup).toContain('Здесь появятся ваши воспоминания')
  expect(markup).toContain('Отправьте боту фото, видео, голосовое или заметку')
  expect(markup).toContain('Открыть бота')
  expect(markup).toContain('role="alert"')
  expect(markup).toContain('Не удалось обновить ленту')
  expect(markup).toContain('Повторить')
})

test('bottom navigation keeps three positions and one add action for full access', () => {
  const markup = render(
    createElement(BottomNavigation, {
      active: 'feed',
      onAdd: () => undefined,
      onFamily: () => undefined,
      onFeed: () => undefined,
      role: 'full',
    }),
  )

  expect(markup.match(/data-nav-position=/g)).toHaveLength(3)
  expect(markup.match(/aria-label="Добавить"/g)).toHaveLength(1)
  expect(markup).toContain('Лента')
  expect(markup).toContain('Добавить')
  expect(markup).toContain('Семья')
})

test('viewer navigation replaces add with a non-focusable viewing label', () => {
  const markup = render(
    createElement(BottomNavigation, {
      active: 'feed',
      onFamily: () => undefined,
      onFeed: () => undefined,
      role: 'viewer',
    }),
  )

  expect(markup.match(/data-nav-position=/g)).toHaveLength(3)
  expect(markup).not.toContain('aria-label="Добавить"')
  expect(markup).toContain('data-nav-viewer="true"')
  expect(markup).toContain('Просмотр')
  expect(markup).not.toContain('tabindex="0"')
})

test('memoLy feed presentation composes the child hero, filters, and scoped navigation', () => {
  const markup = render(
    createElement(
      FeedPresentation,
      {
        activeFilter: 'all',
        childName: 'Саша',
        childSubtitle: '2 года 8 месяцев',
        insets: { top: 0, right: 0, bottom: 0, left: 0 },
        onFamily: () => undefined,
        onFeed: () => undefined,
        onFilterChange: () => undefined,
        role: 'full',
      },
      createElement('article', { 'data-memory-id': 'm1' }),
    ),
  )

  expect(markup).toContain('data-memoly-feed="true"')
  expect(markup).toContain('data-slot="memoly-child-hero"')
  expect(markup).toContain('data-slot="memoly-filter-rail"')
  expect(markup).toContain('data-bottom-navigation-appearance="memoly"')
  expect(markup).toContain('aria-pressed="true"')
})

test('memoLy content rail keeps date groups and cards separated', async () => {
  const css = await readFile(path.resolve(import.meta.dir, '../src/features/feed/presentation/memoly-feed.css'), 'utf8')

  expect(css).toContain('[data-memoly-feed] .feed-content { display: flex; min-width: 0; flex-direction: column; gap: 0; }')
  expect(css).toContain('grid-template-columns: repeat(5, minmax(0, 1fr));')
  expect(css).toContain('[data-memoly-feed] .feed-section { min-width: 0; }')
})

test('memoLy shell keeps horizontal host insets at the narrow breakpoint and consumes them once in navigation', async () => {
  const markup = render(
    createElement(
      FeedPresentation,
      {
        activeFilter: 'all',
        childName: 'Саша',
        childSubtitle: '2 года 8 месяцев',
        insets: { top: 4, right: 13, bottom: 8, left: 11 },
        onFamily: () => undefined,
        onFeed: () => undefined,
        onFilterChange: () => undefined,
        role: 'full',
      },
      createElement('article', { 'data-memory-id': 'm1' }),
    ),
  )
  const css = await readFile(path.resolve(import.meta.dir, '../src/features/feed/presentation/memoly-feed.css'), 'utf8')
  const sharedTokens = await readFile(path.resolve(import.meta.dir, '../src/styles/tokens.css'), 'utf8')

  expect(markup).toContain('--host-inset-left:11px')
  expect(markup).toContain('--host-inset-right:13px')
  expect(markup).toContain('class="app"')
  expect(markup).toContain('class="filters-wrap surface-inset"')
  expect(css).toContain('padding: max(12px, var(--host-inset-top)) 14px calc(var(--memoly-nav-height) + max(22px, var(--host-inset-bottom)) + 30px);')
  expect(sharedTokens).toContain('padding: 8px calc(16px + var(--host-inset-right)) 8px calc(16px + var(--host-inset-left))')
  expect(sharedTokens).toContain('padding-bottom: var(--host-inset-bottom) !important')
  expect(sharedTokens).toContain('width: 100% !important')
  expect(css).toContain('grid-template-columns: repeat(5, minmax(0, 1fr));')
  expect(sharedTokens).toContain("nav[data-bottom-navigation-appearance='memoly']")
})

test('FeedShell applies normalized host insets once and lets long names grow safely', () => {
  const markup = render(
    createElement(
      FeedShell,
      {
        activeFilter: 'all',
        childName: 'Очень длинное имя ребёнка, которое занимает две строки',
        childSubtitle: 'Семейная лента',
        insets: { top: 12, right: 3, bottom: 18, left: 4 },
        onFilterChange: () => undefined,
        role: 'viewer',
      },
      createElement(EmptyState, { mode: 'viewer' }),
    ),
  )

  expect(markup).toContain('--host-inset-top:12px')
  expect(markup).toContain('--host-inset-right:3px')
  expect(markup).toContain('--host-inset-bottom:18px')
  expect(markup).toContain('--host-inset-left:4px')
  expect(markup).toContain('data-slot="child-name"')
  expect(markup).toContain('line-clamp-2')
  expect(markup).toContain('data-slot="feed-scroll"')
  expect(markup).toContain('max-w-[var(--layout-max-width)]')
})

test('FeedShell mounts the memoLy feed presentation and keeps the bottom navigation layer above media', () => {
  const markup = render(
    createElement(
      FeedShell,
      {
        activeFilter: 'all',
        childName: 'Лиза',
        childSubtitle: 'Семейная лента',
        insets: { top: 0, right: 0, bottom: 0, left: 0 },
        onFilterChange: () => undefined,
        role: 'full',
      },
      createElement('div', { className: 'ml-memory' }, createElement('div', { className: 'ml-play' })),
    ),
  )

  expect(markup).toContain('class="ml-page')
  expect(markup).toContain('class="ml-shell')
  expect(markup).toContain('class="ml-topbar')
  expect(markup).toContain('class="ml-child-hero')
  expect(markup).toContain('class="ml-filters')
  expect(markup).toContain('ml-filter')
  expect(markup).toContain('class="ml-memory"')
  expect(markup).toContain('data-slot="bottom-navigation"')
  expect(markup).toContain('z-30')
})

test('FeedShell provides the left spacer required by the memoLy three-column topbar', () => {
  const markup = render(
    createElement(
      FeedShell,
      {
        activeFilter: 'all',
        childName: 'Лиза',
        childSubtitle: 'Семейная лента',
        insets: { top: 0, right: 0, bottom: 0, left: 0 },
        onFilterChange: () => undefined,
        role: 'viewer',
      },
      createElement('div', null),
    ),
  )
  const css = readFileSync(resolve(import.meta.dir, '../src/features/memoly-ui/memoly-ui.css'), 'utf8')

  expect(markup).toContain('data-slot="topbar-spacer"')
  expect(markup).toContain('class="ml-topbar-spacer"')
  expect(css).toContain('.ml-topbar-spacer')
  expect(css).toContain('grid-column: 1')
  expect(css).toContain('width: 44px')
})

test('production AddSheet exposes the T09 first-level actions and an accessible title', () => {
  const markup = render(
    createElement(
      Drawer,
      { open: true },
      createElement(AddSheetPanel, { onClose: () => undefined, onNote: () => undefined, onPhoto: () => undefined, onVoiceOrVideo: () => undefined }),
    ),
  )

  expect(markup).toContain('Добавить воспоминание')
  expect(markup).toContain('Сохраняйте моменты, которые важны')
  expect(markup).toContain('Фото')
  expect(markup).toContain('Заметка')
  expect(markup).toContain('Голос или видео')
  expect(markup).not.toContain('Событие')
  expect(markup).not.toContain('Календарь')
  expect(markup).not.toContain('AI')
  expect(markup.match(/data-add-action=/g)).toHaveLength(3)
  expect(markup).toContain('class="add-options"')
})

test('media choice preserves canonical order and routes video to the supplied callback', () => {
  const markup = render(
    createElement(
      Drawer,
      { open: true },
      createElement(VoiceOrVideoPanel, {
        onBack: () => undefined,
        onClose: () => undefined,
        onVideo: () => undefined,
      }),
    ),
  )

  expect(markup.match(/class="media-choice-card/g)).toHaveLength(2)
  expect(markup).toContain('Добавить голос или видео')
  expect(markup.indexOf('data-add-action="video"')).toBeLessThan(markup.indexOf('data-add-action="audio"'))
  expect(markup).toContain('Выбрать видео')
  expect(markup).toContain('Готовый видеофайл')
  expect(markup).toContain('Голосовые — через бот')
  expect(markup).toContain('Добавление аудио в приложении пока недоступно')
  expect(markup).toContain('https://t.me/OurMemoriesDevBot')

  let opened = false
  const action = MediaChoiceAction({
    copy: <>Готовый видеофайл<br />с устройства</>,
    icon: 'video',
    label: 'Выбрать видео',
    name: 'video',
    onClick: () => { opened = true },
    title: 'Выбрать видео',
  })
  if (action.type !== 'button') throw new Error('expected a button action')
  action.props.onClick()
  expect(opened).toBe(true)
})

test('voice-or-video action invokes the supplied bot handoff', () => {
  let opened = false
  const action = VoiceOrVideoAction({ onClick: () => { opened = true } })
  if (action.type !== 'button') throw new Error('expected a button action')

  action.props.onClick()
  expect(opened).toBe(true)
})

test('production add sheet closes when the host Back lifecycle fires and unsubscribes cleanly', () => {
  let onBackHandler: (() => void) | undefined
  let unsubscribed = false
  let closeCalls = 0
  const unsubscribe = subscribeAddSheetBack({
    onBack: (handler) => {
      onBackHandler = handler
      return () => { unsubscribed = true }
    },
  }, () => { closeCalls += 1 })

  expect(onBackHandler).toBeDefined()
  onBackHandler?.()
  onBackHandler?.()
  expect(closeCalls).toBe(1)

  unsubscribe()
  expect(unsubscribed).toBe(true)
})
