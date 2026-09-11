import type { MemoryAttachment, MemoryDto } from '@web-app-demo/contracts'
import { useEffect, useMemo, useRef, useState } from 'react'
import 'photoswipe/style.css'

import { Button } from '@/components/ui/button'
import { Typography } from '@/components/typography'
import type { AuthenticatedTransport } from '@/platform/api'
import type { HostBridge, TelegramInsets } from '@/platform/telegram'
import { openTelegramVideo } from './api'
import { DateHeading, EmptyState, FeedShell, FeedSkeleton, InlineError, MemoryCardFrame, type FeedFilter } from './components'
import { useFeedQuery, useMemoryLike } from './queries'
import { MediaPlaybackCoordinator, usePlaybackRegistration } from './playback'

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
  role: 'full' | 'viewer'
  transport: AuthenticatedTransport
}

export function FeedPage({
  childName, childSubtitle, familyId, familyTimezone, filter, hostBridge, insets, onFamily,
  onFilterChange, role, transport,
}: Props) {
  const feed = useFeedQuery(transport, familyId, filter)
  const like = useMemoryLike(transport, familyId, filter)
  const sentinel = useRef<HTMLDivElement | null>(null)
  const [detail, setDetail] = useState<MemoryDto | null>(null)
  const [newAvailable, setNewAvailable] = useState(false)
  const knownFirstId = useRef<string | null>(null)
  const items = useMemo(() => feed.data?.pages.flatMap((page) => page.items) ?? [], [feed.data])

  useEffect(() => {
    const first = items[0]?.id ?? null
    if (knownFirstId.current && first && first !== knownFirstId.current) setNewAvailable(true)
    if (first) knownFirstId.current = first
  }, [items])

  useEffect(() => {
    const target = sentinel.current
    if (!target || !feed.hasNextPage) return
    const observer = new IntersectionObserver(([entry]) => {
      if (entry?.isIntersecting && !feed.isFetchingNextPage) void feed.fetchNextPage()
    }, { rootMargin: '320px' })
    observer.observe(target)
    return () => observer.disconnect()
  }, [feed.fetchNextPage, feed.hasNextPage, feed.isFetchingNextPage])

  return (
    <MediaPlaybackCoordinator>
    <FeedShell activeFilter={filter} childName={childName} childSubtitle={childSubtitle} insets={insets}
      onFamily={onFamily} onFeed={() => undefined} onFilterChange={onFilterChange} role={role}>
      {newAvailable ? <Button className="self-start" onClick={() => { setNewAvailable(false); void feed.refetch() }} type="button">Показать новые</Button> : null}
      {feed.isPending ? <FeedSkeleton /> : null}
      {feed.isError ? <InlineError onRetry={() => void feed.refetch()} /> : null}
      {!feed.isPending && !feed.isError && items.length === 0 ? <EmptyState mode={role} /> : null}
      {!feed.isPending && !feed.isError ? <MemoryList familyTimezone={familyTimezone} hostBridge={hostBridge}
        items={items} onLike={(memory) => like.mutate({ memoryId: memory.id, liked: !memory.likes.likedByMe })}
        onOpen={setDetail} transport={transport} /> : null}
      <div aria-label="Загрузить ещё" ref={sentinel} />
      {feed.isFetchingNextPage ? <FeedSkeleton /> : null}
      {detail ? <MemoryDetail familyTimezone={familyTimezone} hostBridge={hostBridge} memory={detail} onClose={() => setDetail(null)} transport={transport} /> : null}
    </FeedShell>
    </MediaPlaybackCoordinator>
  )
}

function MemoryList({ familyTimezone, hostBridge, items, onLike, onOpen, transport }: {
  familyTimezone: string; hostBridge: HostBridge; items: MemoryDto[]; onLike: (memory: MemoryDto) => void
  onOpen: (memory: MemoryDto) => void; transport: AuthenticatedTransport
}) {
  let lastDate = ''
  return <>{items.map((memory) => {
    const date = dayLabel(memory.occurredAt, familyTimezone)
    const heading = date !== lastDate ? <DateHeading key={`date-${date}`}>{date}</DateHeading> : null
    lastDate = date
    return <div className="flex flex-col gap-3" key={memory.id}>{heading}<MemoryCard familyTimezone={familyTimezone} hostBridge={hostBridge} memory={memory} onLike={onLike} onOpen={onOpen} transport={transport} /></div>
  })}</>
}

function MemoryCard({ familyTimezone, hostBridge, memory, onLike, onOpen, transport }: {
  familyTimezone: string; hostBridge: HostBridge; memory: MemoryDto; onLike: (memory: MemoryDto) => void; onOpen: (memory: MemoryDto) => void; transport: AuthenticatedTransport
}) {
  const primary = memory.attachments[0]
  return <MemoryCardFrame>
    {primary ? <Attachment attachment={primary} hostBridge={hostBridge} memory={memory} transport={transport} /> : null}
    <button aria-label={`Открыть воспоминание ${memory.body || memory.kind}`} className="block w-full p-4 text-left" onClick={() => onOpen(memory)} type="button">
      <div className="flex items-center justify-between gap-3"><Typography variant="memoryMeta">{memory.author.name}</Typography><Typography tone="muted" variant="memoryMeta">{timeLabel(memory.occurredAt, familyTimezone)}</Typography></div>
      {memory.body ? <Typography className="mt-2 whitespace-pre-wrap" variant="memoryBody">{memory.body}</Typography> : null}
    </button>
    <div className="flex items-center justify-between border-t border-border px-4 py-2">
      <button aria-pressed={memory.likes.likedByMe} className="min-h-11 rounded-[var(--radius-pill)] px-2 text-sm" onClick={() => onLike(memory)} type="button">
        {memory.likes.likedByMe ? 'С сердечком' : 'Сердечко'} · {memory.likes.count}
      </button>
      <Typography tone="muted" variant="memoryMeta">{kindLabel(memory.kind)}</Typography>
    </div>
  </MemoryCardFrame>
}

function Attachment({ attachment, hostBridge, memory, transport }: { attachment: MemoryAttachment; hostBridge: HostBridge; memory: MemoryDto; transport: AuthenticatedTransport }) {
  if (attachment.source === 'telegram') return <TelegramVideo attachment={attachment} familyId={memory.familyId} hostBridge={hostBridge} memoryId={memory.id} transport={transport} />
  if (attachment.kind === 'photo') return <PrivateImage path={attachment.displayPath ?? attachment.previewPath} transport={transport} />
  if (attachment.kind === 'voice') return <AudioPlayer path={attachment.playbackPath} transport={transport} />
  return <PrivateVideo path={attachment.playbackPath} transport={transport} />
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

function PrivateImage({ path, transport }: { path: string | null; transport: AuthenticatedTransport }) {
  const url = usePrivateObjectUrl(path, transport)
  if (!url) return <div aria-label="Загрузка фотографии" className="aspect-[4/3] bg-muted" />
  return <button aria-label="Открыть фото" className="block w-full" onClick={() => void showPhoto([url], 0)} type="button"><img alt="Воспоминание" className="aspect-[4/3] w-full object-cover" src={url} /></button>
}

function AudioPlayer({ path, transport }: { path: string | null; transport: AuthenticatedTransport }) {
  const url = usePrivateObjectUrl(path, transport)
  const audio = useRef<HTMLAudioElement | null>(null)
  const activate = usePlaybackRegistration(`audio:${path ?? 'missing'}`, audio)
  const [playing, setPlaying] = useState(false)
  const [current, setCurrent] = useState(0)
  const [duration, setDuration] = useState(0)
  return <div className="p-4"><audio onEnded={() => setPlaying(false)} onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)} onPlay={activate} onTimeUpdate={(e) => setCurrent(e.currentTarget.currentTime)} ref={audio} src={url ?? undefined} />
    <div className="flex items-center gap-3"><Button disabled={!url} onClick={() => void (async () => { const element = audio.current; if (!element) return; if (element.paused) { await element.play(); setPlaying(true) } else { element.pause(); setPlaying(false) } })()} type="button">{playing ? 'Пауза' : 'Слушать'}</Button><Typography tone="muted" variant="memoryMeta">{seconds(current)} / {seconds(duration)}</Typography></div>
    <input aria-label="Позиция голосового сообщения" className="mt-3 w-full" max={Number.isFinite(duration) ? duration : 0} min="0" onChange={(e) => { if (audio.current) audio.current.currentTime = Number(e.target.value) }} step="0.1" type="range" value={current} />
  </div>
}

function PrivateVideo({ path, transport }: { path: string | null; transport: AuthenticatedTransport }) {
  const url = usePrivateObjectUrl(path, transport)
  const video = useRef<HTMLVideoElement | null>(null)
  const activate = usePlaybackRegistration(`video:${path ?? 'missing'}`, video)
  const [playing, setPlaying] = useState(false)
  const [current, setCurrent] = useState(0)
  const [duration, setDuration] = useState(0)
  return <div className="bg-muted"><video aria-label="Видео воспоминания" className="aspect-video w-full" onEnded={() => setPlaying(false)} onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)} onPlay={activate} onTimeUpdate={(e) => setCurrent(e.currentTarget.currentTime)} playsInline preload="metadata" ref={video} src={url ?? undefined} />
    <div className="flex flex-wrap items-center gap-2 p-3"><Button disabled={!url} onClick={() => void (async () => { const element = video.current; if (!element) return; if (element.paused) { await element.play(); setPlaying(true) } else { element.pause(); setPlaying(false) } })()} type="button">{playing ? 'Пауза' : 'Смотреть'}</Button><Typography tone="muted" variant="memoryMeta">{seconds(current)} / {seconds(duration)}</Typography><Button disabled={!video.current?.requestFullscreen} onClick={() => void video.current?.requestFullscreen?.()} type="button">Полный экран</Button></div>
    <input aria-label="Позиция видео" className="mb-3 w-full px-3" max={Number.isFinite(duration) ? duration : 0} min="0" onChange={(e) => { if (video.current) video.current.currentTime = Number(e.target.value) }} step="0.1" type="range" value={current} />
  </div>
}

function MemoryDetail({ familyTimezone, hostBridge, memory, onClose, transport }: { familyTimezone: string; hostBridge: HostBridge; memory: MemoryDto; onClose: () => void; transport: AuthenticatedTransport }) {
  return <div aria-modal="true" className="fixed inset-0 z-50 flex items-end bg-black/50 p-3" role="dialog"><section className="max-h-[90dvh] w-full overflow-y-auto rounded-[var(--radius-card)] bg-card p-5"><div className="flex justify-between gap-3"><Typography variant="memoryHero">Воспоминание</Typography><Button onClick={onClose} type="button">Закрыть</Button></div><Typography className="mt-2" tone="muted" variant="memoryMeta">{dateTimeLabel(memory.occurredAt, familyTimezone)}</Typography>{memory.attachments.map((item) => <div className="mt-4" key={item.id}><Attachment attachment={item} hostBridge={hostBridge} memory={memory} transport={transport} /></div>)}{memory.body ? <Typography className="mt-4 whitespace-pre-wrap" variant="memoryBody">{memory.body}</Typography> : null}</section></div>
}

function usePrivateObjectUrl(path: string | null, transport?: AuthenticatedTransport) {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    if (!path || !transport) { setUrl(null); return }
    let cancelled = false; let objectUrl: string | null = null
    void transport.raw(path).then(async (response) => {
      objectUrl = URL.createObjectURL(await response.blob())
      if (cancelled) URL.revokeObjectURL(objectUrl); else setUrl(objectUrl)
    }).catch(() => { if (!cancelled) setUrl(null) })
    return () => { cancelled = true; if (objectUrl) URL.revokeObjectURL(objectUrl) }
  }, [path, transport])
  return url
}

async function showPhoto(urls: string[], index: number) {
  const { default: PhotoSwipe } = await import('photoswipe')
  const gallery = new PhotoSwipe({ dataSource: urls.map((src) => ({ src })), index })
  gallery.init()
}

function dayLabel(value: string, timezone: string) { return new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', year: 'numeric', timeZone: timezone }).format(new Date(value)) }
function dateTimeLabel(value: string, timezone: string) { return new Intl.DateTimeFormat('ru-RU', { dateStyle: 'long', timeStyle: 'short', timeZone: timezone }).format(new Date(value)) }
function timeLabel(value: string, timezone: string) { return new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit', timeZone: timezone }).format(new Date(value)) }
function kindLabel(kind: MemoryDto['kind']) { return ({ note: 'Заметка', photo: 'Фото', video: 'Видео', voice: 'Голос' })[kind] }
function seconds(value: number) { return Number.isFinite(value) ? `${Math.floor(value / 60)}:${String(Math.floor(value % 60)).padStart(2, '0')}` : '0:00' }
function formatDuration(value: number | null) { return value ? seconds(value / 1_000) : 'Длительность уточняется' }
