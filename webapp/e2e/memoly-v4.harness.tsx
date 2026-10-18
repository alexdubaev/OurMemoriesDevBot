/* eslint-disable react-refresh/only-export-components -- Standalone E2E HTML entry; exporting its app only to satisfy Fast Refresh would create a production-like boundary solely for the harness. */
import '../src/production.css'
import { useState, type CSSProperties } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { FamilyResponse, FamilyMemberDto } from '@web-app-demo/contracts'
import { AuthContext } from '@/features/auth'
import { ThemeProvider } from '@/features/theme/ThemeProvider'
import { FeedPage } from '@/features/feed/FeedPage'
import { FamilyScreen } from '@/features/family/FamilyScreen'
import { FamilyOnboarding } from '@/features/family/FamilyOnboarding'
import { createBrowserDevHostBridge } from '@/platform/telegram'
import { activatePrivateCacheIdentity, allowPrivateFamilyCache } from '@/platform/persistence/private-cache'
import { syncPrivateMediaAccessToken } from '@/platform/media/private-media-access'
import type { AuthenticatedTransport } from '@/platform/api'
import { memolyV4ReferenceImages } from './fixtures/memoly-v4-reference-images'

const familyId = '11111111-1111-4111-8111-111111111111'
const userId = '33333333-3333-4333-8333-333333333333'
const childId = '55555555-5555-4555-8555-555555555555'
const childAvatarId = 'aaa00000-0000-4000-8000-000000000012'
const params = new URLSearchParams(location.search)
const requestedTheme = params.get('theme')
const theme = ['mint', 'rose', 'sky', 'lavender', 'apricot', 'sand'].includes(requestedTheme ?? '') ? requestedTheme : 'lavender'
const long = params.has('long')
activatePrivateCacheIdentity(userId); allowPrivateFamilyCache(userId, familyId)
Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: undefined })
syncPrivateMediaAccessToken('synthetic-memoly-v4-token', userId)
const path = (id: string) => `/api/v1/families/${familyId}/media/photos/${id}`
const avatarPath = (id: string) => `/api/v1/families/${familyId}/media/${id}/content?variant=display`
const fixtureBySuffix: Record<string, keyof typeof memolyV4ReferenceImages> = {
  '000000000001': 'park-wide', '000000000002': 'park-portrait', '000000000003': 'garden-play',
  '000000000004': 'park-wide', '000000000005': 'park-portrait', '000000000006': 'garden-play',
  '000000000007': 'park-wide', '000000000008': 'kitchen-video', '000000000009': 'garden-play',
  '000000000010': 'park-portrait', '000000000011': 'autumn-leaves', '000000000012': 'portrait-girl',
  '000000000013': 'portrait-dad', '000000000014': 'river-family', '000000000015': 'walk-path',
}
const makeAttachment = (id: string, width: number, height: number, kind = 'photo') => ({ id, source: 'private_storage', kind, width, height, durationMs: kind === 'video' ? 5000 : null, renditionStatus: 'ready', previewPath: path(id), displayPath: path(id), playbackPath: kind === 'video' ? `${path(id)}/content` : null, originalDownloadPath: `${path(id)}/original`, waveform: null })
const entries = [
  { id: 'park-wide', kind: 'photo', body: 'Нашли маленький мир посреди большого города. Алиса изучала всё с таким интересом 🦕🤍', at: '2026-10-17T12:05:00.000Z', attachments: [makeAttachment('aaa00000-0000-4000-8000-000000000001', 616, 372), makeAttachment('aaa00000-0000-4000-8000-000000000010', 642, 1540), makeAttachment('aaa00000-0000-4000-8000-000000000011', 696, 567)] },
  { id: 'portrait', body: 'После прогулки с Алисой. ' + 'Очень длинная подпись, которая переносится и остаётся доступной. '.repeat(4), at: '2026-10-17T10:00:00.000Z', attachments: [makeAttachment('aaa00000-0000-4000-8000-000000000002', 642, 1540)] },
  { id: 'square', body: '', at: '2026-10-16T10:00:00.000Z', attachments: [makeAttachment('aaa00000-0000-4000-8000-000000000003', 354, 354)] },
  { id: 'album', kind: 'photo', body: 'Фотографии из парка', at: '2026-10-16T12:00:00.000Z', attachments: [makeAttachment('aaa00000-0000-4000-8000-000000000004', 616, 372), makeAttachment('aaa00000-0000-4000-8000-000000000005', 642, 1540), makeAttachment('aaa00000-0000-4000-8000-000000000006', 354, 354)] },
  { id: 'mixed', body: 'Фото, ролик и ещё одно фото', at: '2026-10-15T12:00:00.000Z', attachments: [makeAttachment('aaa00000-0000-4000-8000-000000000007', 616, 372), makeAttachment('aaa00000-0000-4000-8000-000000000008', 720, 1280, 'video'), makeAttachment('aaa00000-0000-4000-8000-000000000009', 354, 354)] },
  { id: 'note', body: 'Алиса сказала: «ещё пять минут»', at: '2026-10-14T09:00:00.000Z', attachments: [] },
]
const memories = entries.map((entry, index) => ({ id: `22222222-2222-4222-8222-${String(index + 1).padStart(12, '0')}`, familyId, childId, author: { id: userId, name: index ? 'Мама' : 'Папа', avatarPath: avatarPath(index ? 'aaa00000-0000-4000-8000-000000000014' : 'aaa00000-0000-4000-8000-000000000013'), avatarCrop: null }, kind: entry.kind ?? (entry.attachments.length ? 'media' : 'note'), body: entry.body, occurredAt: entry.at, firstPublishedAt: entry.at, sourcePublishedAt: null, createdAt: entry.at, version: 1, status: 'published', attachments: entry.attachments, reactionCounts: index === 0 ? { heart: 12 } : {}, currentUserReaction: null, likes: { count: 0, likedByMe: false }, capabilities: { edit: true, delete: true, like: true } }))
const transport = {
  request: async (url: string) => {
    if (url.includes('/readiness')) return { state: 'ready', recheckable: false }
    if (url.endsWith('/max-channel')) return { state: 'connected', title: 'Семейный архив', canManage: true }
    if (url.endsWith('/usage')) return { usedBytes: 0, quotaBytes: null }
    const state = params.get('state')
    if (state === 'loading') return await new Promise<never>(() => undefined)
    if (state === 'error') throw new Error('synthetic feed error')
    return { items: state === 'empty' ? [] : memories, nextCursor: null }
  },
  raw: async (url: string) => {
    const requests = (window as typeof window & { __memolyV4RawRequests?: string[] }).__memolyV4RawRequests ?? []
    requests.push(url)
    Object.assign(window, { __memolyV4RawRequests: requests })
    const photoControl = (window as typeof window & { __memolyV4PhotoRawControl?: { target: string; holdNext: boolean; started: boolean; failOnRelease: boolean; release?: () => void } }).__memolyV4PhotoRawControl
    if (photoControl && url.endsWith(photoControl.target) && photoControl.holdNext) {
      photoControl.holdNext = false
      photoControl.started = true
      await new Promise<void>((resolve) => { photoControl.release = resolve })
      if (photoControl.failOnRelease) {
        photoControl.failOnRelease = false
        throw new Error('synthetic photo failure')
      }
    }
    const suffix = url.match(/[0-9a-f]{12}(?:\/content(?:\?variant=(?:display|preview))?)?$/i)?.[0]?.replace(/\/content(?:\?variant=(?:display|preview))?$/, '')
    const fixtureName = suffix ? fixtureBySuffix[suffix] : undefined
    const fixture = memolyV4ReferenceImages[fixtureName ?? 'park-wide']
    const response = await fetch(fixture.dataUrl)
    return new Response(await response.blob(), { status: 200, headers: { 'Content-Type': response.headers.get('Content-Type') ?? 'image/svg+xml' } })
  },
} as unknown as AuthenticatedTransport
const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
const hostBridge = createBrowserDevHostBridge()
const count = new URLSearchParams(location.search).get('members') === '10' ? 10 : 2
const role = new URLSearchParams(location.search).get('role') ?? 'owner'
const insets = { top: Number(new URLSearchParams(location.search).get('top') ?? 0), right: 0, bottom: Number(new URLSearchParams(location.search).get('bottom') ?? 0), left: 0 }
const insetsStyle = { '--host-inset-top': `${insets.top}px`, '--host-inset-right': `${insets.right}px`, '--host-inset-bottom': `${insets.bottom}px`, '--host-inset-left': `${insets.left}px` } as CSSProperties
const familyResponse = { family: { id: familyId, name: 'Семья Алисы', timezone: 'Europe/Moscow', ownerUserId: role === 'owner' ? userId : '44444444-4444-4444-8444-444444444444' }, child: { id: childId, name: long ? 'Алиса с очень длинным синтетическим именем для проверки переноса строк' : 'Алиса', birthDate: '2024-01-17', sex: 'girl', avatarMediaId: childAvatarId, avatarCrop: null, version: 1, isComplete: true } } as FamilyResponse
const members = Array.from({ length: count }, (_, i) => ({ userId: i === 0 ? userId : `33333333-3333-4333-8333-${String(i + 2).padStart(12, '0')}`, avatarPath: i === 0 ? avatarPath('aaa00000-0000-4000-8000-000000000013') : null, displayName: i === 0 ? 'Папа' : i === 1 ? long ? 'Андрей с очень длинным тестовым именем участника' : 'Андрей' : `Участник ${i + 1}`, familyDisplayName: null, role: i === 0 && role === 'viewer' ? 'viewer' : 'full', isOwner: i === 0 && role === 'owner', joinedAt: '2026-10-17T00:00:00.000Z', version: 1 })) as FamilyMemberDto[]
const isFamily = new URLSearchParams(location.search).has('family')
function HarnessApp() {
  const [childProfileOpen, setChildProfileOpen] = useState(false)
  const [childEditor, setChildEditor] = useState<'profile' | 'photo' | null>(null)
  const [showFamily, setShowFamily] = useState(isFamily)
  const [settingsRequest, setSettingsRequest] = useState(0)
  const openSettingsFromFeed = () => { setShowFamily(true); setSettingsRequest((value) => value + 1) }
  return <AuthContext.Provider value={{ user: { id: userId, theme }, transport, updateTheme: async () => undefined } as never}><ThemeProvider><QueryClientProvider client={queryClient}>{showFamily ? childEditor ? <FamilyOnboarding familyId={familyId} familyTimezone={familyResponse.family.timezone} initialChild={familyResponse.child ?? undefined} photoOnly={childEditor === 'photo'} transport={transport} onCancel={() => setChildEditor(null)} onCompleted={async () => undefined} /> : <div style={insetsStyle}><FamilyScreen childProfileOpen={childProfileOpen} familyResponse={familyResponse} invites={[]} members={members} transport={transport} hostBridge={hostBridge} currentUserId={userId} onAdd={() => undefined} onAllFamilies={() => undefined} onEditChild={() => setChildEditor('profile')} onChangeChildPhoto={() => setChildEditor('photo')} onOpenChild={() => setChildProfileOpen(true)} onCloseChild={() => setChildProfileOpen(false)} onFeed={() => setShowFamily(false)} onRefresh={async () => undefined} createInviteLink={() => 'https://example.invalid/invite'} settingsRequest={settingsRequest} onSettingsRequestHandled={() => setSettingsRequest(0)} /></div> : <FeedPage active accountId={userId} childId={childId} childName={long ? 'Алиса с очень длинным синтетическим именем для проверки переноса строк' : 'Алиса'} childSubtitle="2 года 9 месяцев" childAvatarMediaId={childAvatarId} childAvatarCrop={null} familyId={familyId} familyName="Семья Алисы" familyTimezone="Europe/Moscow" filter="all" hostBridge={hostBridge} insets={insets} isAppBootstrapped membershipEpoch={1} unreadCount={params.has('unread') ? 3 : null} unreadState={params.has('unread') ? 'ready' : 'not_enabled'} onAccessLost={() => undefined} onAllFamilies={() => setShowFamily(true)} onFamily={() => { setShowFamily(true); setSettingsRequest(0) }} onFilterChange={() => undefined} onOpenSettings={openSettingsFromFeed} role="full" transport={transport} />}</QueryClientProvider></ThemeProvider></AuthContext.Provider>
}
const app = <HarnessApp />
createRoot(document.getElementById('root')!).render(app)
