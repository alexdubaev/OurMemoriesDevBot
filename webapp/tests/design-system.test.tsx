import { expect, test } from 'bun:test'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import { BottomNavigation } from '../src/components/BottomNavigation'
import { WebpIcon } from '../src/components/WebpIcon'
import { Drawer } from '../src/components/ui/drawer'
import {
  AddSheetPanel,
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

test('memoLy shell keeps horizontal host insets in feed content and navigation gutters', async () => {
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

  expect(markup).toContain('--host-inset-left:11px')
  expect(markup).toContain('--host-inset-right:13px')
  expect(css).toContain('padding-left: calc(16px + var(--host-inset-left))')
  expect(css).toContain('padding-right: calc(16px + var(--host-inset-right))')
  expect(css).toContain('padding-left: calc(21px + var(--host-inset-left))')
  expect(css).toContain('padding-right: calc(21px + var(--host-inset-right))')
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

test('AddSheet panel contains only the three approved actions and an accessible title', () => {
  const markup = render(
    createElement(
      Drawer,
      { open: true },
      createElement(AddSheetPanel, { onClose: () => undefined }),
    ),
  )

  expect(markup).toContain('Что добавить?')
  expect(markup).toContain('Фото или видео')
  expect(markup).toContain('Заметка')
  expect(markup).toContain('Голосовое в боте')
  expect(markup).toContain('Материалы увидят участники вашей семьи')
  expect(markup).not.toContain('Событие')
  expect(markup).not.toContain('Календарь')
  expect(markup).not.toContain('AI')
  expect(markup.match(/data-add-action=/g)).toHaveLength(3)
  expect(markup).toContain('aria-label="Закрыть"')
})
