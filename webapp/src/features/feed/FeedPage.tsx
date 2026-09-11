import type { MemoryAttachment, MemoryDto } from '@web-app-demo/contracts'
import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useMemo, useRef, useState } from 'react'
import 'photoswipe/style.css'

import { Button } from '@/components/ui/button'
import { Typography } from '@/components/typography'
import { ApiRequestError, type AuthenticatedTransport } from '@/platform/api'
import { privateMediaSource } from '@/platform/media/private-media-access'
import type { HostBridge, TelegramInsets } from '@/platform/telegram'
import { loadFeed, openTelegramVideo } from './api'
import { EmptyState, FeedShell, FeedSkeleton, InlineError, MemoryCardFrame, type FeedFilter } from './components'
import { feedQueryKeys, useFeedQuery, useMemoryLike } from './queries'
import { MediaPlaybackCoordinator } from './playback'
import { usePlaybackRegistration } from './use-playback-registration'

type Props = {
  childName: string
  childSubtitle: string
  familyId: string
  familyTimezone: string
  filter: FeedFilter
  hostBridge: HostBridge
  insets: TelegramInsets
  onFamily: () => void
  onFilterChange: (filter: FeedFilter) => void
  onAccessLost: () => void
  role: 'full' | 'viewer'
  transport: AuthenticatedTransport
}

export function FeedPage({
  childName, childSubtitle, familyId, familyTimezone, filter, hostBridge, insets, onFamily,
  onAccessLost, onFilterChange, role, transport,
}: Props) {
  const queryClient = useQueryClient()
  const feed = useFeedQuery(transport, familyId, filter)
  const { fetchNextPage, hasNextPage, isFetchNextPageError, isFetchingNextPage } = feed
  const like = useMemoryLike(transport, familyId, filter)
  const sentinel = useRef<HTMLDivElement | null>(null)
  const [detail, setDetail] = useState<MemoryDto | null>(null)
  const [newAvailable, setNewAvailable] = useState(false)
  const knownFirstId = useRef<string | null>(null)
  const items = useMemo(() => {
    const unique = new Map<string, MemoryDto>()
    for (const page of feed.data?.pages ?? []) {
      for (const memory of page.items) if (!unique.has(memory.id)) unique.set(memory.id, memory)
    }
    return [...unique.values()]
  }, [feed.data])

  useEffect(() => {
    if (!knownFirstId.current && items[0]) knownFirstId.current = items[0].id
  }, [items])

  useEffect(() => {
    const error = feed.error
    if (!(error instanceof ApiRequestError) || ![403, 404].includes(error.status)) return
    void queryClient.cancelQueries({ queryKey: feedQueryKeys.all }).finally(() => {
      queryClient.removeQueries({ queryKey: feedQueryKeys.all })
      onAccessLost()
    })
  }, [feed.error, onAccessLost, queryClient])

  useEffect(() => {
    let checking = false
    const checkForNew = async () => {
      if (checking || document.hidden || !knownFirstId.current) return
      checking = true
      try {
        const latest = await loadFeed(transport, familyId, filter, null)
        if (latest.items[0]?.id && latest.items[0].id !== knownFirstId.current) setNewAvailable(true)
      } catch (error) {
        if (error instanceof ApiRequestError && [403, 404].includes(error.status)) onAccessLost()
      } finally {
        checking = false
      }
    }
    const onVisibility = () => { if (!document.hidden) void checkForNew() }
    const timer = window.setInterval(() => { void checkForNew() }, 15_000)
    document.addEventListener('visibilitychange', onVisibility)
    return () => { window.clearInterval(timer); document.removeEventListener('visibilitychange', onVisibility) }
  }, [familyId, filter, onAccessLost, transport])

  useEffect(() => {
    const target = sentinel.current
    if (!target || !hasNextPage) return
    const observer = new IntersectionObserver(([entry]) => {
      if (entry?.isIntersecting && !isFetchingNextPage && !isFetchNextPageError) void fetchNextPage()
    }, { rootMargin: '320px' })
    observer.observe(target)
    return () => observer.disconnect()
  }, [fetchNextPage, hasNextPage, isFetchNextPageError, isFetchingNextPage])

  return (
    <MediaPlaybackCoordinator>
    <FeedShell activeFilter={filter} childName={childName} childSubtitle={childSubtitle} insets={insets}
      onFamily={onFamily} onFeed={() => undefined} onFilterChange={onFilterChange} role={role}>
      {newAvailable ? <Button className="sticky top-3 z-20 self-start shadow-[var(--shadow-card)]" onClick={() => void refreshFromTop(feed.refetch, knownFirstId, setNewAvailable)} type="button">Показать новые</Button> : null}
      {feed.isPending ? <FeedSkeleton /> : null}
      {feed.isError && items.length === 0 ? <InlineError onRetry={() => void feed.refetch()} /> : null}
      {!feed.isPending && !feed.isError && items.length === 0 ? <EmptyState mode={role} /> : null}
      {!feed.isPending && items.length > 0 ? <MemoryList familyTimezone={familyTimezone} hostBridge={hostBridge}
        items={items} onLike={(memory) => like.mutate({ memoryId: memory.id, liked: !memory.likes.likedByMe })}
        onOpen={setDetail} transport={transport} /> : null}
      <div aria-label="Загрузить ещё" ref={sentinel} />
      {feed.isFetchingNextPage ? <FeedSkeleton /> : null}
      {feed.isFetchNextPageError && items.length > 0 ? <InlineError onRetry={() => void feed.fetchNextPage()} /> : null}
      {detail ? <MemoryDetail familyTimezone={familyTimezone} hostBridge={hostBridge} memory={detail} onClose={() => setDetail(null)} transport={transport} /> : null}
    </FeedShell>
    </MediaPlaybackCoordinator>
  )
}

async function refreshFromTop(
  refetch: () => Promise<{ data?: { pages: Array<{ items: MemoryDto[] }> } }>,
  knownFirstId: React.MutableRefObject<string | null>,
  setNewAvailable: (available: boolean) => void,
) {
  const result = await refetch()
  knownFirstId.current = result.data?.pages[0]?.items[0]?.id ?? knownFirstId.current
  setNewAvailable(false)
}

function MemoryList({ familyTimezone, hostBridge, items, onLike, onOpen, transport }: {
  familyTimezone: string; hostBridge: HostBridge; items: MemoryDto[]; onLike: (memory: MemoryDto) => void
  onOpen: (memory: MemoryDto) => void; transport: AuthenticatedTransport
}) {
  return <>{items.map((memory, index) => {
    const date = dayLabel(memory.occurredAt, familyTimezone)
    const previousDate = index > 0 ? dayLabel(items[index - 1]!.occurredAt, familyTimezone) : null
    return <div className="flex flex-col gap-3" key={memory.id}>
      {date !== previousDate ? <Typography data-slot="date-heading" variant="memoryDate">{date}</Typography> : null}
      <MemoryCard familyTimezone={familyTimezone} hostBridge={hostBridge} memory={memory} onLike={onLike} onOpen={onOpen} transport={transport} />
    </div>
  })}</>
}

function MemoryCard({ familyTimezone, hostBridge, memory, onLike, onOpen, transport }: {
  familyTimezone: string; hostBridge: HostBridge; memory: MemoryDto; onLike: (memory: MemoryDto) => void; onOpen: (memory: MemoryDto) => void; transport: AuthenticatedTransport
}) {
  const primary = memory.attachments[0]
  const photos = memory.attachments.filter((attachment): attachment is Extract<MemoryAttachment, { source: 'private_storage' }> =>
    attachment.source === 'private_storage' && attachment.kind === 'photo')
  return <MemoryCardFrame data-memory-id={memory.id}>
    {primary ? <Attachment attachment={primary} hostBridge={hostBridge} memory={memory} photoAlbum={photos} photoIndex={0} transport={transport} /> : null}
    <button aria-label={`Открыть воспоминание ${memory.body || memory.kind}`} className="block w-full p-4 text-left" onClick={() => onOpen(memory)} type="button">
      <div className="flex items-center justify-between gap-3"><Typography variant="memoryMeta">{memory.author.name}</Typography><Typography tone="muted" variant="memoryMeta">{timeLabel(memory.occurredAt, familyTimezone)}</Typography></div>
      {memory.body ? <Typography className="mt-2 whitespace-pre-wrap" variant="memoryBody">{memory.body}</Typography> : null}
    </button>
    <div className="flex items-center justify-between border-t border-border px-4 py-2">
      <Typography asChild variant="memoryMeta"><button aria-pressed={memory.likes.likedByMe} className="min-h-11 rounded-[var(--radius-pill)] px-2" onClick={() => onLike(memory)} type="button">
        {memory.likes.likedByMe ? 'С сердечком' : 'Сердечко'} · {memory.likes.count}
      </button></Typography>
      <Typography tone="muted" variant="memoryMeta">{kindLabel(memory.kind)}</Typography>
    </div>
  </MemoryCardFrame>
}

function Attachment({ attachment, hostBridge, memory, photoAlbum = [], photoIndex = 0, transport }: {
  attachment: MemoryAttachment
  hostBridge: HostBridge
  memory: MemoryDto
  photoAlbum?: Array<Extract<MemoryAttachment, { source: 'private_storage' }>>
  photoIndex?: number
  transport: AuthenticatedTransport
}) {
  if (attachment.source === 'telegram') return <TelegramVideo attachment={attachment} familyId={memory.familyId} hostBridge={hostBridge} memoryId={memory.id} transport={transport} />
  if (attachment.kind === 'photo') return <PrivateImage attachment={attachment} photoAlbum={photoAlbum.length > 0 ? photoAlbum : [attachment]} photoIndex={photoIndex} transport={transport} />
  if (attachment.kind === 'voice') return <AudioPlayer path={attachment.playbackPath} waveform={attachment.waveform} />
  return <PrivateVideo path={attachment.playbackPath} />
}

function TelegramVideo({ attachment, familyId, hostBridge, memoryId, transport }: { attachment: Extract<MemoryAttachment, { source: 'telegram' }>; familyId: string; hostBridge: HostBridge; memoryId: string; transport: AuthenticatedTransport }) {
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)
  return <div className="flex aspect-video flex-col items-center justify-center bg-muted p-5 text-center">
    <Typography variant="memoryBody">Видео хранится в Telegram</Typography>
    <Typography className="mt-1" tone="muted" variant="memoryMeta">{formatDuration(attachment.durationMs)}</Typography>
    <Button className="mt-4" disabled={busy} onClick={() => void (async () => {
      setBusy(true); setFailed(false)
      try { hostBridge.openTelegramVideo((await openTelegramVideo(transport, familyId, memoryId)).telegramDeepLink) }
      catch { setFailed(true) } finally { setBusy(false) }
    })()} type="button">Смотреть в Telegram</Button>
    {failed ? <Typography className="mt-2" role="alert" variant="memoryMeta">Не удалось открыть видео. Повторите попытку.</Typography> : null}
  </div>
}

function PrivateImage({ attachment, photoAlbum, photoIndex, transport }: {
  attachment: Extract<MemoryAttachment, { source: 'private_storage' }>
  photoAlbum: Array<Extract<MemoryAttachment, { source: 'private_storage' }>>
  photoIndex: number
  transport: AuthenticatedTransport
}) {
  const path = attachment.displayPath ?? attachment.previewPath
  const url = usePrivateObjectUrl(path, transport)
  if (!url) return <div aria-label="Загрузка фотографии" className="aspect-[4/3] bg-muted" />
  return <button aria-label="Открыть фото" className="block w-full" onClick={(event) => void showPrivatePhotoAlbum(photoAlbum, photoIndex, transport, event.currentTarget)} type="button"><img alt="Воспоминание" className="aspect-[4/3] w-full object-cover" height={attachment.height ?? undefined} src={url} width={attachment.width ?? undefined} /></button>
}

function AudioPlayer({ path, waveform }: { path: string | null; waveform: number[] | null }) {
  const url = usePrivateMediaSource(path)
  const audio = useRef<HTMLAudioElement | null>(null)
  const activate = usePlaybackRegistration(`audio:${path ?? 'missing'}`, audio)
  const [playing, setPlaying] = useState(false)
  const [current, setCurrent] = useState(0)
  const [duration, setDuration] = useState(0)
  return <div className="p-4"><audio onEnded={() => setPlaying(false)} onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)} onPause={() => setPlaying(false)} onPlay={activate} onTimeUpdate={(e) => setCurrent(e.currentTarget.currentTime)} preload="none" ref={audio} src={url ?? undefined} />
    <div className="flex items-center gap-3"><Button disabled={!url} onClick={() => void (async () => { const element = audio.current; if (!element) return; if (element.paused) { await element.play(); setPlaying(true) } else { element.pause(); setPlaying(false) } })()} type="button">{playing ? 'Пауза' : 'Слушать'}</Button><Typography tone="muted" variant="memoryMeta">{seconds(current)} / {seconds(duration)}</Typography></div>
    <VoiceSeek current={current} duration={duration} onSeek={(position) => { if (audio.current) audio.current.currentTime = position }} waveform={waveform} />
  </div>
}

function VoiceSeek({ current, duration, onSeek, waveform }: { current: number; duration: number; onSeek: (position: number) => void; waveform: number[] | null }) {
  if (!waveform || waveform.length !== 48) return <div className="mt-3"><input aria-label="Позиция голосового сообщения" className="w-full" max={Number.isFinite(duration) ? duration : 0} min="0" onChange={(event) => onSeek(Number(event.target.value))} step="0.1" type="range" value={current} /></div>
  return <div className="relative mt-3 flex h-10 items-center gap-px" data-slot="voice-waveform">
    {waveform.map((peak, index) => <span aria-hidden="true" className="min-h-1 flex-1 rounded-full bg-primary/70" data-waveform-peak="" key={index} style={{ height: `${Math.max(10, Math.min(100, peak * 100))}%` }} />)}
    <div className="absolute inset-0 flex items-center opacity-0 focus-within:opacity-100"><input aria-label="Позиция голосового сообщения" className="w-full" max={Number.isFinite(duration) ? duration : 0} min="0" onChange={(event) => onSeek(Number(event.target.value))} step="0.1" type="range" value={current} /></div>
  </div>
}

function PrivateVideo({ path }: { path: string | null }) {
  const url = usePrivateMediaSource(path)
  const video = useRef<HTMLVideoElement | null>(null)
  const activate = usePlaybackRegistration(`video:${path ?? 'missing'}`, video)
  const [playing, setPlaying] = useState(false)
  const [current, setCurrent] = useState(0)
  const [duration, setDuration] = useState(0)
  const canFullscreen = typeof HTMLVideoElement !== 'undefined' && 'requestFullscreen' in HTMLVideoElement.prototype
  return <div className="bg-muted"><video aria-label="Видео воспоминания" className="aspect-video w-full" onEnded={() => setPlaying(false)} onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)} onPause={() => setPlaying(false)} onPlay={activate} onTimeUpdate={(e) => setCurrent(e.currentTarget.currentTime)} playsInline preload="none" ref={video} src={url ?? undefined} />
    <div className="flex flex-wrap items-center gap-2 p-3"><Button disabled={!url} onClick={() => void (async () => { const element = video.current; if (!element) return; if (element.paused) { await element.play(); setPlaying(true) } else { element.pause(); setPlaying(false) } })()} type="button">{playing ? 'Пауза' : 'Смотреть'}</Button><Typography tone="muted" variant="memoryMeta">{seconds(current)} / {seconds(duration)}</Typography><Button disabled={!canFullscreen} onClick={() => void video.current?.requestFullscreen?.()} type="button">Полный экран</Button></div>
    <input aria-label="Позиция видео" className="mb-3 w-full px-3" max={Number.isFinite(duration) ? duration : 0} min="0" onChange={(e) => { if (video.current) video.current.currentTime = Number(e.target.value) }} step="0.1" type="range" value={current} />
  </div>
}

function MemoryDetail({ familyTimezone, hostBridge, memory, onClose, transport }: { familyTimezone: string; hostBridge: HostBridge; memory: MemoryDto; onClose: () => void; transport: AuthenticatedTransport }) {
  const photos = memory.attachments.filter((attachment): attachment is Extract<MemoryAttachment, { source: 'private_storage' }> =>
    attachment.source === 'private_storage' && attachment.kind === 'photo')
  return <div aria-modal="true" className="fixed inset-0 z-50 flex items-end bg-black/50 p-3" role="dialog"><section className="max-h-[90dvh] w-full overflow-y-auto rounded-[var(--radius-card)] bg-card p-5"><div className="flex justify-between gap-3"><Typography variant="memoryHero">Воспоминание</Typography><Button onClick={onClose} type="button">Закрыть</Button></div><Typography className="mt-2" tone="muted" variant="memoryMeta">{dateTimeLabel(memory.occurredAt, familyTimezone)}</Typography>{memory.attachments.map((item) => <div className="mt-4" key={item.id}><Attachment attachment={item} hostBridge={hostBridge} memory={memory} photoAlbum={photos} photoIndex={item.source === 'private_storage' && item.kind === 'photo' ? photos.findIndex((photo) => photo.id === item.id) : 0} transport={transport} /></div>)}{memory.body ? <Typography className="mt-4 whitespace-pre-wrap" variant="memoryBody">{memory.body}</Typography> : null}</section></div>
}

function usePrivateObjectUrl(path: string | null, transport?: AuthenticatedTransport) {
  const [loaded, setLoaded] = useState<{ path: string; url: string | null } | null>(null)
  useEffect(() => {
    if (!path || !transport) return
    let cancelled = false; let objectUrl: string | null = null
    void transport.raw(path).then(async (response) => {
      objectUrl = URL.createObjectURL(await response.blob())
      if (cancelled) URL.revokeObjectURL(objectUrl); else setLoaded({ path, url: objectUrl })
    }).catch(() => { if (!cancelled) setLoaded({ path, url: null }) })
    return () => { cancelled = true; if (objectUrl) URL.revokeObjectURL(objectUrl) }
  }, [path, transport])
  return loaded?.path === path ? loaded.url : null
}

function usePrivateMediaSource(path: string | null) {
  const [loaded, setLoaded] = useState<{ path: string; url: string | null } | null>(null)
  useEffect(() => {
    let cancelled = false
    if (!path) return
    void privateMediaSource(path).then((source) => { if (!cancelled) setLoaded({ path, url: source }) })
    return () => { cancelled = true }
  }, [path])
  return loaded?.path === path ? loaded.url : null
}

async function showPrivatePhotoAlbum(
  attachments: Array<Extract<MemoryAttachment, { source: 'private_storage' }>>,
  index: number,
  transport: AuthenticatedTransport,
  trigger: HTMLButtonElement,
) {
  const slides = await Promise.all(attachments.map(async (attachment) => {
    const path = attachment.displayPath ?? attachment.originalDownloadPath
    const response = await transport.raw(path)
    return {
      src: URL.createObjectURL(await response.blob()),
      width: attachment.width ?? undefined,
      height: attachment.height ?? undefined,
    }
  }))
  const scrollY = window.scrollY
  await showPhoto(slides, index, () => {
    slides.forEach(({ src }) => URL.revokeObjectURL(src))
    window.scrollTo({ top: scrollY })
    trigger.focus({ preventScroll: true })
  })
}

async function showPhoto(slides: Array<{ src: string; width?: number; height?: number }>, index: number, onClosed: () => void) {
  const { default: PhotoSwipe } = await import('photoswipe')
  const gallery = new PhotoSwipe({ dataSource: slides, index, showHideAnimationType: 'none' })
  let closingFromHistory = false
  const closeFromHistory = () => {
    closingFromHistory = true
    gallery.close()
  }
  window.history.pushState({ privatePhotoViewer: true }, '')
  window.addEventListener('popstate', closeFromHistory, { once: true })
  gallery.on('destroy', () => {
    window.removeEventListener('popstate', closeFromHistory)
    if (!closingFromHistory && window.history.state?.privatePhotoViewer) window.history.back()
    onClosed()
  })
  gallery.init()
}

function dayLabel(value: string, timezone: string) { return new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', year: 'numeric', timeZone: timezone }).format(new Date(value)) }
function dateTimeLabel(value: string, timezone: string) { return new Intl.DateTimeFormat('ru-RU', { dateStyle: 'long', timeStyle: 'short', timeZone: timezone }).format(new Date(value)) }
function timeLabel(value: string, timezone: string) { return new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit', timeZone: timezone }).format(new Date(value)) }
function kindLabel(kind: MemoryDto['kind']) { return ({ note: 'Заметка', photo: 'Фото', video: 'Видео', voice: 'Голос' })[kind] }
function seconds(value: number) { return Number.isFinite(value) ? `${Math.floor(value / 60)}:${String(Math.floor(value % 60)).padStart(2, '0')}` : '0:00' }
function formatDuration(value: number | null) { return value ? seconds(value / 1_000) : 'Длительность уточняется' }
