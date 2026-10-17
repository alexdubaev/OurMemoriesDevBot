import '../src/production.css'
if (import.meta.env.VITE_MEMOLY_UI_VERSION === 'v2') document.documentElement.dataset.uiVersion = 'v2'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AuthContext } from '@/features/auth'
import { FeedPage } from '@/features/feed/FeedPage'
import { createBrowserDevHostBridge } from '@/platform/telegram'
import { activatePrivateCacheIdentity, allowPrivateFamilyCache } from '@/platform/persistence/private-cache'
import { syncPrivateMediaAccessToken } from '@/platform/media/private-media-access'
import type { AuthenticatedTransport } from '@/platform/api'

declare global { interface Window { __fixedCarouselProbe?: { delayed: boolean; release: () => void; delayedPosterWaiters: Array<() => void> } } }

const familyId = '11111111-1111-4111-8111-111111111111'
const memoryId = '22222222-2222-4222-8222-222222222222'
const userId = '33333333-3333-4333-8333-333333333333'
activatePrivateCacheIdentity(userId)
allowPrivateFamilyCache(userId, familyId)
Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: undefined })
syncPrivateMediaAccessToken('synthetic-carousel-token', userId)
const delayedPosterWaiters: Array<() => void> = []
window.__fixedCarouselProbe = { delayed: true, release: () => { window.__fixedCarouselProbe!.delayed = false; delayedPosterWaiters.splice(0).forEach((resolve) => resolve()) }, delayedPosterWaiters }
const mediaPath = (id: string, kind: string) => `/api/v1/families/${familyId}/media/${kind}/${id}`
const attachments = [
  { id: '44444444-4444-4444-8444-444444444441', source: 'private_storage', kind: 'video', width: 720, height: 1280, durationMs: 5000, renditionStatus: 'ready', previewPath: mediaPath('44444444-4444-4444-8444-444444444441', 'photos'), displayPath: null, playbackPath: mediaPath('44444444-4444-4444-8444-444444444441', 'videos') + '/content', originalDownloadPath: mediaPath('44444444-4444-4444-8444-444444444441', 'original') },
  { id: '44444444-4444-4444-8444-444444444442', source: 'private_storage', kind: 'video', width: 1280, height: 720, durationMs: 5000, renditionStatus: 'ready', previewPath: mediaPath('44444444-4444-4444-8444-444444444442', 'photos'), displayPath: null, playbackPath: mediaPath('44444444-4444-4444-8444-444444444442', 'videos') + '/content', originalDownloadPath: mediaPath('44444444-4444-4444-8444-444444444442', 'original') },
  { id: '44444444-4444-4444-8444-444444444443', source: 'private_storage', kind: 'photo', width: 1000, height: 1000, durationMs: null, renditionStatus: 'ready', previewPath: mediaPath('44444444-4444-4444-8444-444444444443', 'photos'), displayPath: mediaPath('44444444-4444-4444-8444-444444444443', 'photos'), playbackPath: null, originalDownloadPath: mediaPath('44444444-4444-4444-8444-444444444443', 'original'), waveform: null },
  { id: '44444444-4444-4444-8444-444444444444', source: 'private_storage', kind: 'photo', width: 720, height: 1280, durationMs: null, renditionStatus: 'ready', previewPath: mediaPath('44444444-4444-4444-8444-444444444444', 'photos'), displayPath: mediaPath('44444444-4444-4444-8444-444444444444', 'photos'), playbackPath: null, originalDownloadPath: mediaPath('44444444-4444-4444-8444-444444444444', 'original'), waveform: null },
]
const memory = { id: memoryId, familyId, childId: '55555555-5555-4555-8555-555555555555', author: { id: userId, name: 'Synthetic author', avatarPath: null, avatarCrop: null }, kind: 'media', body: 'Synthetic carousel caption', occurredAt: '2026-10-14T10:00:00.000Z', firstPublishedAt: '2026-10-14T10:00:00.000Z', sourcePublishedAt: null, createdAt: '2026-10-14T10:00:00.000Z', version: 1, status: 'published', attachments, reactionCounts: {}, currentUserReaction: null, likes: { count: 0, likedByMe: false }, capabilities: { edit: true, delete: true, like: true } }
const singlePhotoMemory = { ...memory, id: '22222222-2222-4222-8222-222222222223', body: 'Single photo natural ratio', attachments: [attachments[3]] }
const photoAlbumAttachments = [attachments[2], attachments[3],
  { ...attachments[2], id: '44444444-4444-4444-8444-444444444445', width: 360, height: 640, previewPath: mediaPath('44444444-4444-4444-8444-444444444445', 'photos'), displayPath: mediaPath('44444444-4444-4444-8444-444444444445', 'photos'), originalDownloadPath: mediaPath('44444444-4444-4444-8444-444444444445', 'original') },
  { ...attachments[3], id: '44444444-4444-4444-8444-444444444446', previewPath: mediaPath('44444444-4444-4444-8444-444444444446', 'photos'), displayPath: mediaPath('44444444-4444-4444-8444-444444444446', 'photos'), originalDownloadPath: mediaPath('44444444-4444-4444-8444-444444444446', 'original') },
]
const photoAlbumMemory = { ...memory, id: '22222222-2222-4222-8222-222222222224', kind: 'photo', body: 'Synthetic photo album', attachments: photoAlbumAttachments }
const swipeMode = new URLSearchParams(window.location.search).has('fullscreen-swipe')
const swipePhotoAlbum = { ...photoAlbumMemory, attachments: photoAlbumAttachments.slice(0, 3) }
const swipeMixedMemory = { ...memory, id: '22222222-2222-4222-8222-222222222228', body: 'Synthetic fullscreen swipe', attachments: [attachments[2], attachments[0], attachments[3]] }
const lifecycleMemories = Array.from({ length: 60 }, (_, index) => {
  const suffix = String(index + 10).padStart(12, '0')
  const id = `66666666-6666-4666-8666-${suffix}`
  const attachmentId = `77777777-7777-4777-8777-${suffix}`
  return { ...memory, id, body: `Lifecycle video ${index + 1}`, kind: 'video', attachments: [{ ...attachments[0], id: attachmentId, previewPath: mediaPath(attachmentId, 'photos'), playbackPath: mediaPath(attachmentId, 'videos') + '/content' }] }
})
const maxVideoId = '99999999-9999-4999-8999-999999999999'
const maxAttachmentId = '99999999-9999-4999-8999-999999999998'
const maxPlaybackPath = `/api/v1/families/${familyId}/media/max-videos/${maxVideoId}/content`
const maxVideoMemory = { ...memory, id: maxAttachmentId, kind: 'video', body: 'Lifecycle MAX video', attachments: [{ id: maxVideoId, source: 'max', kind: 'video', width: 720, height: 1280, durationMs: 5000, playbackPath: maxPlaybackPath, posterState: 'ready', posterPath: maxPlaybackPath.replace('/content', '/poster') }] }
const lifecycleMode = new URLSearchParams(window.location.search).has('lifecycle')
const voiceMode = new URLSearchParams(window.location.search).has('voice')
const voiceId = '88888888-8888-4888-8888-888888888888'
const voicePath = mediaPath(voiceId, 'voices') + '/content'
const voiceMemory = { ...memory, id: '22222222-2222-4222-8222-222222222225', kind: 'voice', body: 'Synthetic voice recording', attachments: [{ id: voiceId, source: 'private_storage', kind: 'voice', width: null, height: null, durationMs: 5000, renditionStatus: 'ready', previewPath: null, displayPath: null, playbackPath: voicePath, originalDownloadPath: mediaPath(voiceId, 'original'), waveform: Array.from({ length: 48 }, (_, index) => .2 + (index % 6) * .12) }] }
const maxVoiceId = '88888888-8888-4888-8888-888888888887'
const maxVoicePath = mediaPath(maxVoiceId, 'voices') + '/content'
const missingWaveformVoice = { ...voiceMemory, id: '22222222-2222-4222-8222-222222222227', body: 'Synthetic MAX voice', attachments: [{ ...voiceMemory.attachments[0], id: maxVoiceId, playbackPath: maxVoicePath, waveform: null }] }
const transport = {
  request: async (path: string) => path.includes('/readiness') ? { state: 'ready', recheckable: false } : ({ items: swipeMode ? [swipeMixedMemory, swipePhotoAlbum] : [memory, singlePhotoMemory, photoAlbumMemory, ...(voiceMode ? [voiceMemory, { ...voiceMemory, id: '22222222-2222-4222-8222-222222222226' }, missingWaveformVoice] : []), ...(lifecycleMode ? lifecycleMemories : []), ...(lifecycleMode ? [maxVideoMemory] : [])], nextCursor: null }),
  raw: async (path: string, options?: { signal?: AbortSignal }) => {
    if (options?.signal?.aborted) throw new DOMException('Aborted', 'AbortError')
    if (path.includes('44444444-4444-4444-8444-444444444442') && window.__fixedCarouselProbe?.delayed) await new Promise<void>((resolve) => delayedPosterWaiters.push(resolve))
    const video = path.includes('44444444-4444-4444-8444-444444444441')
    const width = video ? 360 : path.includes('44444444-4444-4444-8444-444444444442') ? 640 : path.includes('44444444-4444-4444-8444-444444444443') ? 512 : 360
    const height = video ? 640 : path.includes('44444444-4444-4444-8444-444444444442') ? 360 : path.includes('44444444-4444-4444-8444-444444444443') ? 512 : 640
    const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height
    const context = canvas.getContext('2d')!
    context.fillStyle = '#e0b74d'; context.fillRect(0, 0, width, height)
    context.fillStyle = '#b04e63'; context.fillRect(0, 0, width / 5, height / 5)
    context.fillStyle = '#356d8b'; context.fillRect(width * .8, 0, width / 5, height / 5)
    context.fillStyle = '#4d8252'; context.fillRect(0, height * .8, width / 5, height / 5)
    context.fillStyle = '#765289'; context.fillRect(width * .8, height * .8, width / 5, height / 5)
    const blob = await new Promise<Blob>((resolve) => canvas.toBlob((value) => resolve(value!), 'image/png'))
    return new Response(blob, { status: 200, headers: { 'Content-Type': 'image/png' } })
  },
} as unknown as AuthenticatedTransport
const auth = { user: { id: userId }, transport } as never
const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
createRoot(document.getElementById('root')!).render(<div className="memoly-app-root" data-memoly-theme="sand" data-ui-version="v2"><AuthContext.Provider value={auth}><QueryClientProvider client={queryClient}><FeedPage active accountId={userId} childId="55555555-5555-4555-8555-555555555555" childName="Synthetic child" childSubtitle="" childAvatarMediaId={null} childAvatarCrop={null} familyId={familyId} familyName="Synthetic family" familyTimezone="UTC" filter="all" hostBridge={createBrowserDevHostBridge()} insets={{ top: 0, right: 0, bottom: 0, left: 0 }} isAppBootstrapped membershipEpoch={1} onAccessLost={() => undefined} onAllFamilies={() => undefined} onFamily={() => undefined} onFilterChange={() => undefined} role="full" transport={transport} /></QueryClientProvider></AuthContext.Provider></div>)
