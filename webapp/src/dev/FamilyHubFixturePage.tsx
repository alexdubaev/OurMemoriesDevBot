import { useEffect, useState } from 'react'
import type { FamilyHomeResponse } from '@web-app-demo/contracts'

import { ThemeProvider, isMemolyTheme, useMemolyTheme } from '@/features/theme'
import { FamilyHubPage } from '@/features/family/FamilyHubPage'
import { FeedPresentation } from '@/features/feed/presentation/FeedPresentation'
import type { AuthenticatedTransport } from '@/platform/api'
import { Typography } from '@/components/typography'

const transport: AuthenticatedTransport = {
  request: async () => { throw new Error('fixture has no network') },
  raw: async () => { throw new Error('fixture has no network') },
}

type Item = FamilyHomeResponse['items'][number]
function item(id: number, name: string, options: Partial<Item> = {}): Item {
  return {
    familyId: `00000000-0000-4000-8000-${String(id).padStart(12, '0')}`,
    name, displaySubtitle: null, childAvatarMediaId: null, isOwner: false, role: 'viewer', setupStatus: 'ready',
    capabilities: { canCreateInvite: false, canManageMembers: false, canEditChild: false, canPublishNote: false, canPublishPhoto: false, canPublishVoice: false, canPublishVideo: false, canUploadChildAvatar: false },
    unreadCount: 0, unreadState: 'ready', membershipEpoch: 1, ...options,
  }
}
const owner = item(1, 'Семья Александра', { isOwner: true, role: 'full', displaySubtitle: 'София · 2 года 4 месяца', unreadCount: 2 })
const invited = [item(2, 'Семья Миши', { displaySubtitle: 'Альбом близких', unreadCount: 3 }), item(3, 'Семья Саши', { displaySubtitle: 'Альбом близких', unreadCount: 7 }), item(4, 'Семья Лены', { displaySubtitle: 'Альбом близких', unreadCount: 0 })]
const params = new URLSearchParams(window.location.search)
const caseName = params.get('state') ?? 'owned'
const requestedTheme = params.get('theme')
const themeName = isMemolyTheme(requestedTheme) ? requestedTheme : 'mint'

function fixtureHome(): FamilyHomeResponse {
  const items = caseName === 'empty' ? []
    : caseName === 'single' ? [owner]
      : caseName === 'multi' ? invited
        : caseName === 'long' ? [item(1, 'Очень длинное название семейного альбома, которое должно переноситься', { isOwner: true, role: 'full', unreadCount: 128 }), ...invited]
          : caseName === 'revoked' ? invited.slice(1)
            : [owner, invited[0]!, invited[2]!]
  return { version: 1, ownFamilyId: items.find((value) => value.isOwner)?.familyId ?? null, ownFamilyStatus: items.some((value) => value.isOwner) ? 'active' : null, canCreateOwnFamily: !items.some((value) => value.isOwner), items, nextCursor: null }
}

function FixtureContent() {
  const { theme, setTheme } = useMemolyTheme()
  const [selected, setSelected] = useState<Item | null>(caseName === 'feed' ? owner : null)
  useEffect(() => {
    const timer = window.setTimeout(() => setTheme(themeName), 0)
    return () => window.clearTimeout(timer)
  }, [setTheme])
  if (selected) return <div data-fixture-state="feed"><FeedPresentation activeFilter="all" childName="Ребёнок" childSubtitle="Профиль ребёнка" familyName={selected.name} insets={{ top: 0, right: 0, bottom: 0, left: 0 }} onAllFamilies={() => setSelected(null)} onFamily={() => undefined} onFeed={() => undefined} onFilterChange={() => undefined} role={selected.role}><Typography as="p" variant="memoryBody">Воспоминания выбранной семьи</Typography></FeedPresentation></div>
  const data = fixtureHome()
  return <div data-fixture-state={caseName} data-fixture-theme={theme}>
    <FamilyHubPage busy={false} error={caseName === 'error' ? 'Проверьте соединение и повторите попытку.' : null} home={caseName === 'loading' || caseName === 'error' ? null : data} loading={caseName === 'loading'} loadingMore={false} notice={caseName === 'revoked' ? 'Доступ к этой семье закрыт.' : null} onCreate={() => undefined} onLoadMore={() => undefined} onRetry={() => undefined} onSelect={(id) => setSelected(data.items.find((value) => value.familyId === id) ?? null)} transport={transport} />
  </div>
}

export function FamilyHubFixturePage() {
  return <ThemeProvider><FixtureContent /></ThemeProvider>
}
