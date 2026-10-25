import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'

import { FeedPresentation } from '../src/features/feed/presentation/FeedPresentation'

function renderFeed({ unreadOnly = false, showUnreadCount = true }: { unreadOnly?: boolean; showUnreadCount?: boolean } = {}) {
  return renderToStaticMarkup(
    <FeedPresentation
      activeFilter="all"
      childName="Лиля"
      childSubtitle=""
      children={<div />}
      insets={{ top: 0, right: 0, bottom: 0, left: 0 }}
      onFamily={() => undefined}
      onFeed={() => undefined}
      onFilterChange={() => undefined}
      onUnreadChange={() => undefined}
      role="full"
      unreadCount={7}
      unreadOnly={unreadOnly}
      unreadState="ready"
      showUnreadCountInMode={showUnreadCount}
    />,
  )
}

describe('feed unread presentation', () => {
  test('a filtered list keeps the unread action without presenting the family total as its count', () => {
    const html = renderFeed({ showUnreadCount: false })
    expect(html).toContain('aria-label="Непросмотренные"')
    expect(html).toContain('>Непросмотренные</span>')
    expect(html).not.toContain('7 новых')
  })

  test('a filtered unread mode stays count-free and can be exited', () => {
    const html = renderFeed({ unreadOnly: true, showUnreadCount: false })
    expect(html).toContain('>Непросмотренные</span>')
    expect(html).toContain('aria-label="Выйти из режима непросмотренных"')
    expect(html).not.toContain('Непросмотренные · 7')
    expect(html).not.toContain('7 новых')
  })

  test('the all-family feed retains its exact unread count', () => {
    const html = renderFeed()
    expect(html).toContain('aria-label="Показать 7 непросмотренных воспоминаний"')
    expect(html).toContain('>7 новых</span>')
  })
})
