import type { MemoryAttachment, MemoryDto } from '@web-app-demo/contracts'
import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useMemo, useRef, useState } from 'react'
import 'photoswipe/style.css'

import { Button } from '@/components/ui/button'
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Typography } from '@/components/typography'
import { WebpIcon } from '@/components/WebpIcon'
import { ApiRequestError, type AuthenticatedTransport } from '@/platform/api'
import { privateMediaSource } from '@/platform/media/private-media-access'
import { toggleMediaPlayback } from '@/platform/media/playback'
import type { HostBridge, TelegramInsets } from '@/platform/telegram'
import { loadFeed, openTelegramVideo } from './api'
import { navigateToTelegramVideo, useSingleFlightTelegramVideoHandoff } from './telegram-video-handoff'
import { EmptyState, FeedShell, FeedSkeleton, InlineError, MemoryCardFrame, type FeedFilter } from './components'
import { feedQueryKeys, useFeedQuery, useMemoryDelete, useMemoryLike } from './queries'
import { shouldCheckForNew, shouldRefreshInitialEmptyFeed } from './live-refresh'
import { MediaPlaybackCoordinator } from './playback'
import { usePlaybackRegistration } from './use-playback-registration'
import { isVoiceWaveformPeakPlayed, voiceWaveformProgress } from './voice-waveform'
import { shouldRenderInitialFeedError } from '@/features/app/startup-routing'

type Props = {
  childName: string
  childSubtitle: string
  familyId: string
  familyTimezone: string
  filter: FeedFilter
  hostBridge: HostBridge
  insets: TelegramInsets
  isAppBootstrapped?: boolean
  onFamily: () => void
  onFilterChange: (filter: FeedFilter) => void
  onAccessLost: () => void
  role: 'full' | 'viewer'
  transport: AuthenticatedTransport
}

export function FeedPage({
  childName, childSubtitle, familyId, familyTimezone, filter, hostBridge, insets, onFamily,
  isAppBootstrapped = true, onAccessLost, onFilterChange, role, transport,
}: Props) {
  const queryClient = useQueryClient()
  const feed = useFeedQuery(transport, familyId, filter)
  const { fetchNextPage, hasNextPage, isFetchNextPageError, isFetchingNextPage } = feed
  const { refetch } = feed
  const like = useMemoryLike(transport, familyId, filter)
  const [deleteError, setDeleteError] = useState(false)
  const deletion = useMemoryDelete(transport, familyId, () => setDeleteError(true))
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
      if (!shouldCheckForNew({ checking, hidden: document.hidden })) return
      checking = true
      try {
        const latest = await loadFeed(transport, familyId, filter, null)
        const latestFirstId = latest.items[0]?.id ?? null
        if (shouldRefreshInitialEmptyFeed({ knownFirstId: knownFirstId.current, latestFirstId })) {
          await refreshFromTop(refetch, knownFirstId, setNewAvailable)
        } else if (latestFirstId && latestFirstId !== knownFirstId.current) {
          setNewAvailable(true)
        }
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
  }, [familyId, filter, onAccessLost, refetch, transport])

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
      {!isAppBootstrapped || feed.isPending ? <FeedSkeleton /> : null}
      {shouldRenderInitialFeedError({ isAppBootstrapped, isFeedError: feed.isError, isFeedPending: feed.isPending, itemCount: items.length }) ? <InlineError onRetry={() => void feed.refetch()} /> : null}
      {isAppBootstrapped && !feed.isPending && !feed.isError && items.length === 0 ? <EmptyState mode={role} /> : null}
      {deleteError ? <Typography role="alert" variant="memoryMeta">Не удалось удалить воспоминание. Попробуйте ещё раз.</Typography> : null}
      {isAppBootstrapped && !feed.isPending && items.length > 0 ? <MemoryList familyTimezone={familyTimezone} hostBridge={hostBridge}
        items={items} onLike={(memory) => like.mutate({ memoryId: memory.id, liked: !memory.likes.likedByMe })}
        onDelete={(memory) => { setDeleteError(false); return deletion.mutateAsync({ memoryId: memory.id, version: memory.version }) }}
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

function MemoryList({ familyTimezone, hostBridge, items, onDelete, onLike, onOpen, transport }: {
  familyTimezone: string; hostBridge: HostBridge; items: MemoryDto[]; onLike: (memory: MemoryDto) => void
  onDelete: (memory: MemoryDto) => Promise<unknown>; onOpen: (memory: MemoryDto) => void; transport: AuthenticatedTransport
}) {
  return <>{items.map((memory, index) => {
    const date = dayLabel(memory.occurredAt, familyTimezone)
    const previousDate = index > 0 ? dayLabel(items[index - 1]!.occurredAt, familyTimezone) : null
    return <div className="flex flex-col gap-3" key={memory.id}>
      {date !== previousDate ? <Typography data-slot="date-heading" variant="memoryDate">{date}</Typography> : null}
      <MemoryCard familyTimezone={familyTimezone} hostBridge={hostBridge} memory={memory} onDelete={onDelete} onLike={onLike} onOpen={onOpen} transport={transport} />
    </div>
  })}</>
}

function MemoryCard({ familyTimezone, hostBridge, memory, onDelete, onLike, onOpen, transport }: {
  familyTimezone: string; hostBridge: HostBridge; memory: MemoryDto; onLike: (memory: MemoryDto) => void; onOpen: (memory: MemoryDto) => void; transport: AuthenticatedTransport
  onDelete: (memory: MemoryDto) => Promise<unknown>
}) {
  const primary = memory.attachments[0]
  const photos = memory.attachments.filter((attachment): attachment is Extract<MemoryAttachment, { source: 'private_storage' }> =>
    attachment.source === 'private_storage' && attachment.kind === 'photo')
  return <MemoryCardFrame data-memory-id={memory.id}>
    {primary ? <Attachment attachment={primary} hostBridge={hostBridge} memory={memory} photoAlbum={photos} photoIndex={0} transport={transport} /> : null}
    <div className="flex items-center justify-between gap-3 px-4 pt-3"><Typography variant="memoryMeta">{memory.author.name}</Typography><div className="flex items-center gap-1"><Typography tone="muted" variant="memoryMeta">{timeLabel(memory.occurredAt, familyTimezone)}</Typography>{memory.capabilities.delete ? <MemoryDeleteAction memory={memory} onDelete={onDelete} /> : null}</div></div>
    <button aria-label={`Открыть воспоминание ${memory.body || memory.kind}`} className="block w-full px-4 pb-4 pt-2 text-left" onClick={() => onOpen(memory)} type="button">
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
  if (attachment.kind === 'photo') return <PrivateImage attachment={attachment} hostBridge={hostBridge} photoAlbum={photoAlbum.length > 0 ? photoAlbum : [attachment]} photoIndex={photoIndex} transport={transport} />
  if (attachment.kind === 'voice') return <AudioPlayer durationMs={attachment.durationMs} path={attachment.playbackPath} waveform={attachment.waveform} />
  return <PrivateVideo path={attachment.playbackPath} />
}

export function TelegramVideo({ attachment, familyId, hostBridge, memoryId, transport }: { attachment: Extract<MemoryAttachment, { source: 'telegram' }>; familyId: string; hostBridge: HostBridge; memoryId: string; transport: AuthenticatedTransport }) {
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)
  const posterUrl = usePrivateObjectUrl(attachment.thumbnailPath, transport)
  const handoff = useSingleFlightTelegramVideoHandoff(async () => {
    setBusy(true); setFailed(false)
    try {
      await navigateToTelegramVideo(hostBridge, () => openTelegramVideo(transport, familyId, memoryId))
    } catch (error) {
      setFailed(true); setBusy(false)
      throw error
    }
  })
  const openHandoff = () => { void handoff().catch(() => undefined) }
  return <div className="bg-muted">
    <TelegramVideoPoster busy={busy} disabled={busy} durationMs={attachment.durationMs} height={attachment.height} onOpen={openHandoff} posterUrl={posterUrl} width={attachment.width} />
    {failed ? <Typography className="px-5 py-3 text-center" role="alert" variant="memoryMeta">Не удалось открыть видео в Telegram. Попробуйте ещё раз.</Typography> : null}
  </div>
}

function MemoryDeleteAction({ memory, onDelete }: { memory: MemoryDto; onDelete: (memory: MemoryDto) => Promise<unknown> }) {
  const [confirming, setConfirming] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const confirm = async () => {
    if (submitting) return
    setSubmitting(true)
    try {
      await onDelete(memory)
      setConfirming(false)
    } finally {
      setSubmitting(false)
    }
  }
  return <AlertDialog onOpenChange={(open) => { if (!submitting) setConfirming(open) }} open={confirming}>
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button aria-label="Действия с воспоминанием" className="flex size-11 items-center justify-center rounded-full text-muted-foreground" type="button"><WebpIcon decorative name="more" size={24} /></button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem className="min-h-11 px-3" onSelect={() => setConfirming(true)} variant="destructive">Удалить воспоминание</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
    <AlertDialogContent className="mx-4 max-w-[calc(100%-2rem)] rounded-[var(--radius-sheet)]">
      <AlertDialogHeader><AlertDialogTitle>Удалить воспоминание?</AlertDialogTitle><AlertDialogDescription>Оно исчезнет из семейной ленты.</AlertDialogDescription></AlertDialogHeader>
      <AlertDialogFooter>
        <AlertDialogCancel disabled={submitting}>Отмена</AlertDialogCancel>
        <Button disabled={submitting} onClick={() => void confirm()} type="button" variant="destructive">Удалить</Button>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>
}

export function TelegramVideoPoster({ durationMs, posterUrl, width, height, onOpen = () => undefined, disabled = false, busy = false }: {
  durationMs: number | null; posterUrl: string | null; width: number | null; height: number | null
  onOpen?: () => void; disabled?: boolean; busy?: boolean
}) {
  const aspectRatio = videoPosterAspectRatio(width, height)
  return <button aria-label="Смотреть видео в Telegram" className="relative block w-full overflow-hidden bg-muted text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-wait disabled:opacity-60" disabled={disabled} onClick={onOpen} style={{ aspectRatio }} type="button">
    {posterUrl
      ? <img alt="Кадр видео" className="size-full object-cover" src={posterUrl} />
      : <span className="absolute inset-0 flex items-center justify-center"><Typography as="span" tone="muted" variant="memoryBody">Видео</Typography></span>}
    <span aria-hidden="true" className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center" data-slot="telegram-video-play-control">
      {busy
        ? <Typography as="span" className="rounded-full bg-black/65 px-4 py-2 text-white shadow-sm backdrop-blur-[1px]" variant="memoryMeta">Открываем видео…</Typography>
        : <span className="flex size-14 items-center justify-center rounded-full bg-black/65 shadow-sm backdrop-blur-[1px]"><WebpIcon decorative name="play" size={24} state="white" /></span>}
    </span>
    <Typography as="span" className="pointer-events-none absolute bottom-3 right-3 z-20 rounded bg-black/70 px-2 py-1 text-white" variant="memoryMeta">{formatDuration(durationMs)}</Typography>
  </button>
}

function videoPosterAspectRatio(width: number | null, height: number | null) {
  return Number.isFinite(width) && Number.isFinite(height) && width! > 0 && height! > 0
    ? `${width} / ${height}`
    : '16 / 9'
}

function PrivateImage({ attachment, hostBridge, photoAlbum, photoIndex, transport }: {
  attachment: Extract<MemoryAttachment, { source: 'private_storage' }>
  hostBridge: HostBridge
  photoAlbum: Array<Extract<MemoryAttachment, { source: 'private_storage' }>>
  photoIndex: number
  transport: AuthenticatedTransport
}) {
  const path = attachment.displayPath ?? attachment.previewPath
  const url = usePrivateObjectUrl(path, transport)
  const viewerSession = useRef<AbortController | null>(null)
  useEffect(() => () => { viewerSession.current?.abort() }, [])
  if (!url) return <div aria-label="Загрузка фотографии" className="aspect-[4/3] bg-muted" />
  return <button aria-label="Открыть фото" className="block w-full" onClick={(event) => {
    viewerSession.current?.abort()
    const session = new AbortController()
    viewerSession.current = session
    void showPrivatePhotoAlbum(photoAlbum, photoIndex, transport, event.currentTarget, hostBridge, session.signal)
      .finally(() => { if (viewerSession.current === session) viewerSession.current = null })
  }} type="button"><img alt="Воспоминание" className="aspect-[4/3] w-full object-cover" height={attachment.height ?? undefined} src={url} width={attachment.width ?? undefined} /></button>
}

function AudioPlayer({ durationMs, path, waveform }: { durationMs: number | null; path: string | null; waveform: number[] | null }) {
  const url = usePrivateMediaSource(path)
  const audio = useRef<HTMLAudioElement | null>(null)
  const activate = usePlaybackRegistration(`audio:${path ?? 'missing'}`, audio)
  const [playing, setPlaying] = useState(false)
  const [current, setCurrent] = useState(0)
  const [duration, setDuration] = useState(() => durationMs ? durationMs / 1_000 : 0)
  const updateDuration = (element: HTMLAudioElement) => { if (Number.isFinite(element.duration) && element.duration >= 0) setDuration(element.duration) }
  const syncCurrent = (element: HTMLAudioElement) => setCurrent(element.currentTime)
  return <div className="p-4"><audio onDurationChange={(e) => updateDuration(e.currentTarget)} onEnded={(e) => { if (Number.isFinite(e.currentTarget.duration)) setCurrent(e.currentTarget.duration); setPlaying(false) }} onLoadedMetadata={(e) => updateDuration(e.currentTarget)} onPause={() => setPlaying(false)} onPlay={(e) => { activate(); syncCurrent(e.currentTarget) }} onSeeking={(e) => syncCurrent(e.currentTarget)} onTimeUpdate={(e) => syncCurrent(e.currentTarget)} preload="none" ref={audio} src={url ?? undefined} />
    <div className="flex items-center gap-3"><Button disabled={!url} onClick={() => void (async () => { const element = audio.current; if (!element) return; setPlaying(await toggleMediaPlayback(element)) })()} type="button">{playing ? 'Пауза' : 'Слушать'}</Button><Typography tone="muted" variant="memoryMeta">{seconds(current)} / {roundedSeconds(duration)}</Typography></div>
    <VoiceSeek current={current} duration={duration} onSeek={(position) => { if (audio.current) audio.current.currentTime = position; setCurrent(position) }} waveform={waveform} />
  </div>
}

function VoiceSeek({ current, duration, onSeek, waveform }: { current: number; duration: number; onSeek: (position: number) => void; waveform: number[] | null }) {
  if (!waveform || waveform.length !== 48) return <div className="mt-3"><input aria-label="Позиция голосового сообщения" className="w-full" max={Number.isFinite(duration) ? duration : 0} min="0" onChange={(event) => onSeek(Number(event.target.value))} step="0.1" type="range" value={current} /></div>
  const progress = voiceWaveformProgress(current, duration)
  return <div className="relative mt-3 flex h-10 items-center gap-px" data-slot="voice-waveform">
    {waveform.map((peak, index) => {
      const played = isVoiceWaveformPeakPlayed(index, waveform.length, progress)
      return <span aria-hidden="true" className="min-h-1 flex-1 rounded-full" data-waveform-peak="" data-waveform-played={played} key={index} style={{ backgroundColor: played ? 'var(--memory-accent-strong)' : 'var(--memory-line)', height: `${Math.max(10, Math.min(100, peak * 100))}%` }} />
    })}
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
  hostBridge: HostBridge,
  signal: AbortSignal,
) {
  const scrollY = window.scrollY
  const slides: Array<{ src: string; width?: number; height?: number }> = []
  try {
    for (const attachment of attachments) {
      const path = attachment.displayPath ?? attachment.originalDownloadPath
      const response = await transport.raw(path)
      const src = URL.createObjectURL(await response.blob())
      slides.push({
        src,
        width: attachment.width ?? undefined,
        height: attachment.height ?? undefined,
      })
      if (signal.aborted) return
    }
    await showPhoto(slides, index, hostBridge, signal)
  } finally {
    slides.forEach(({ src }) => URL.revokeObjectURL(src))
    window.scrollTo({ top: scrollY })
    if (trigger.isConnected) trigger.focus({ preventScroll: true })
  }
}

async function showPhoto(
  slides: Array<{ src: string; width?: number; height?: number }>,
  index: number,
  hostBridge: HostBridge,
  signal: AbortSignal,
) {
  const { default: PhotoSwipe } = await import('photoswipe')
  if (signal.aborted) return
  const gallery = new PhotoSwipe({ dataSource: slides, index, showHideAnimationType: 'none' })
  let closingFromHistory = false
  await new Promise<void>((resolve) => {
    let initialized = false
    let finished = false
    const finish = () => {
      if (finished) return
      finished = true
      window.removeEventListener('popstate', closeFromHistory)
      signal.removeEventListener('abort', closeFromUnmount)
      unsubscribeBack()
      if (!closingFromHistory && window.history.state?.privatePhotoViewer) window.history.back()
      resolve()
    }
    const closeFromHistory = () => {
      closingFromHistory = true
      gallery.close()
    }
    const closeFromUnmount = () => {
      if (initialized) gallery.destroy()
      else finish()
    }
    const unsubscribeBack = hostBridge.onBack(() => gallery.close())
    window.history.pushState({ privatePhotoViewer: true }, '')
    window.addEventListener('popstate', closeFromHistory, { once: true })
    signal.addEventListener('abort', closeFromUnmount, { once: true })
    gallery.on('destroy', finish)
    if (signal.aborted) {
      closeFromUnmount()
      return
    }
    gallery.init()
    initialized = true
  })
}

function dayLabel(value: string, timezone: string) { return new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', year: 'numeric', timeZone: timezone }).format(new Date(value)) }
function dateTimeLabel(value: string, timezone: string) { return new Intl.DateTimeFormat('ru-RU', { dateStyle: 'long', timeStyle: 'short', timeZone: timezone }).format(new Date(value)) }
function timeLabel(value: string, timezone: string) { return new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit', timeZone: timezone }).format(new Date(value)) }
function kindLabel(kind: MemoryDto['kind']) { return ({ note: 'Заметка', photo: 'Фото', video: 'Видео', voice: 'Голос' })[kind] }
function seconds(value: number) { return Number.isFinite(value) ? `${Math.floor(value / 60)}:${String(Math.floor(value % 60)).padStart(2, '0')}` : '0:00' }
function roundedSeconds(value: number) { return Number.isFinite(value) ? seconds(Math.round(value)) : '0:00' }
function formatDuration(value: number | null) { return value ? seconds(value / 1_000) : 'Длительность уточняется' }
