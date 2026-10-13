import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react'
import useEmblaCarousel from 'embla-carousel-react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { maxVideoPosterReadinessSchema, maxVideoReadinessSchema, type MaxVideoReadiness, type MemoryAttachment, type MemoryDto } from '@web-app-demo/contracts'

import { useFeedQuery, feedQueryKeys } from '@/features/feed/queries'
import { maxVideoPosterPath, maxVideoPosterReadinessInterval, maxVideoPosterReadinessPath, maxVideoReadinessInterval, maxVideoReadinessPath, withMaxVideoReadinessSlot } from '@/features/feed/max-video-readiness'
import { openTelegramVideo } from '@/features/feed/api'
import { navigateToTelegramVideo, useSingleFlightTelegramVideoHandoff } from '@/features/feed/telegram-video-handoff'
import { usePrivateImageUrl } from '@/platform/media/use-private-image-url'
import { privateMediaSource } from '@/platform/media/private-media-access'
import type { HostBridge } from '@/platform/host-bridge'
import { ApiRequestError, type AuthenticatedTransport } from '@/platform/api'

export function DiagnosticFeed({ familyId, hostBridge, membershipEpoch, userId, transport, onAccessRevoked }: {
  familyId: string
  hostBridge: HostBridge
  membershipEpoch: number
  userId: string
  transport: AuthenticatedTransport
  onAccessRevoked: () => void
}) {
  const feed = useFeedQuery(transport, familyId, 'all', false, userId, membershipEpoch)
  const sentinel = useRef<HTMLDivElement | null>(null)
  const reportedRevocation = useRef(false)
  useEffect(() => {
    if (!sentinel.current || !feed.hasNextPage || feed.isFetchingNextPage) return
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting) && !feed.isFetchingNextPage) void feed.fetchNextPage()
    }, { rootMargin: '500px 0px' })
    observer.observe(sentinel.current)
    return () => observer.disconnect()
  }, [feed.fetchNextPage, feed.hasNextPage, feed.isFetchingNextPage])
  useEffect(() => {
    if (feed.error instanceof ApiRequestError && [403, 404].includes(feed.error.status) && !reportedRevocation.current) {
      reportedRevocation.current = true
      onAccessRevoked()
    }
  }, [feed.error, onAccessRevoked])

  const memories = feed.data?.pages.flatMap((page) => page.items) ?? []
  if (feed.isPending) return <p className="diagnostic-state" role="status">Загружаем воспоминания…</p>
  if (feed.error) return <p className="diagnostic-error" role="alert">Не удалось загрузить ленту.</p>
  return <>
    {memories.map((memory) => <Memory key={memory.id} familyId={familyId} hostBridge={hostBridge} membershipEpoch={membershipEpoch} memory={memory} userId={userId} transport={transport} />)}
    {memories.length === 0 ? <p>Воспоминаний пока нет.</p> : null}
    <div aria-hidden="true" ref={sentinel} />
    {feed.hasNextPage ? <button className="diagnostic-load-more" disabled={feed.isFetchingNextPage} onClick={() => void feed.fetchNextPage()} type="button">{feed.isFetchingNextPage ? 'Загружаем…' : 'Загрузить ещё'}</button> : null}
  </>
}

function Memory({ familyId, hostBridge, membershipEpoch, memory, userId, transport }: { familyId: string; hostBridge: HostBridge; membershipEpoch: number; memory: MemoryDto; userId: string; transport: AuthenticatedTransport }) {
  return <article className="diagnostic-memory">
    <div className="diagnostic-author-row">
      <AuthorAvatar avatarPath={memory.author.avatarPath} name={memory.author.name} transport={transport} userId={userId} />
      <div className="diagnostic-author-details">
        <h2>{memory.author.name}</h2>
        <p className="diagnostic-meta"><time dateTime={memory.occurredAt}>{new Date(memory.occurredAt).toLocaleString('ru-RU')}</time>{memory.kind === 'note' ? ' · заметка' : ` · ${memory.kind}`}</p>
      </div>
    </div>
    {memory.body ? <p className="diagnostic-note">{memory.body}</p> : null}
    {memory.attachments.length ? <Carousel attachments={memory.attachments} familyId={familyId} hostBridge={hostBridge} membershipEpoch={membershipEpoch} memoryId={memory.id} userId={userId} transport={transport} /> : null}
  </article>
}

function AuthorAvatar({ avatarPath, name, transport, userId }: { avatarPath: string | null; name: string; transport: AuthenticatedTransport; userId: string }) {
  const url = usePrivateImageUrl(userId, avatarPath, transport)
  return <span aria-hidden="true" className="diagnostic-author-avatar">
    {url ? <img alt="" src={url} /> : name.trim().charAt(0).toLocaleUpperCase('ru-RU')}
  </span>
}

type AttachmentProps = { attachment: MemoryAttachment; active: boolean; membershipEpoch: number; userId: string; transport: AuthenticatedTransport; onDimensions: (id: string, width: number, height: number) => void }

function Carousel({ attachments, familyId, hostBridge, membershipEpoch, memoryId, userId, transport }: { attachments: MemoryAttachment[]; familyId: string; hostBridge: HostBridge; membershipEpoch: number; memoryId: string; userId: string; transport: AuthenticatedTransport }) {
  const [viewportRef, embla] = useEmblaCarousel({ align: 'start', containScroll: 'trimSnaps', watchResize: (_api, entries) => entries.every((entry) => entry.target.getClientRects().length > 0 && entry.target.getBoundingClientRect().width > 0 && entry.target.getBoundingClientRect().height > 0) })
  const [selected, setSelected] = useState(0)
  const [dimensions, setDimensions] = useState<Record<string, { width: number; height: number }>>(() => Object.fromEntries(attachments.flatMap((attachment) => attachment.width && attachment.height ? [[attachment.id, { width: attachment.width, height: attachment.height }]] : [])))
  const lastKnownRatio = useRef<number | null>(null)
  const selectedSize = dimensions[attachments[selected]?.id]
  if (selectedSize) lastKnownRatio.current = selectedSize.width / selectedSize.height
  const activeRatio = selectedSize ? `${selectedSize.width} / ${selectedSize.height}` : lastKnownRatio.current ? String(lastKnownRatio.current) : undefined
  const rememberDimensions = useCallback((id: string, width: number, height: number) => {
    if (width <= 0 || height <= 0) return
    setDimensions((current) => current[id] ? current : { ...current, [id]: { width, height } })
  }, [])
  const syncSelection = useCallback(() => { if (embla) setSelected(embla.selectedScrollSnap()) }, [embla])
  useEffect(() => {
    if (!embla) return
    embla.on('select', syncSelection)
    embla.on('reInit', syncSelection)
    return () => { embla.off('select', syncSelection); embla.off('reInit', syncSelection) }
  }, [embla, syncSelection])
  const scrollToSlide = (index: number) => { embla?.scrollTo(index, true) }
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget) return
    if (event.key === 'ArrowRight' && selected < attachments.length - 1) { event.preventDefault(); scrollToSlide(selected + 1) }
    if (event.key === 'ArrowLeft' && selected > 0) { event.preventDefault(); scrollToSlide(selected - 1) }
  }
  return <>
    <div aria-label="Медиа воспоминания" className={`diagnostic-carousel${attachments.length === 1 ? ' diagnostic-carousel-single' : ''}`} onKeyDown={onKeyDown} ref={viewportRef} role="group" tabIndex={attachments.length > 1 ? 0 : -1}>
      <div className="diagnostic-carousel-track">
      {attachments.map((attachment, index) => {
        return <div className="diagnostic-carousel-slide" data-carousel-slide="" key={attachment.id}>
          <div className="diagnostic-media-stage" data-attachment-id={attachment.id} style={activeRatio ? { aspectRatio: activeRatio } : undefined}>
            <Attachment active={index === selected} attachment={attachment} membershipEpoch={membershipEpoch} onDimensions={rememberDimensions} userId={userId} transport={transport} />
          </div>
          {attachment.source === 'telegram' ? <TelegramVideoAction active={index === selected} familyId={familyId} hostBridge={hostBridge} memoryId={memoryId} transport={transport} /> : null}
        </div>
      })}
      </div>
    </div>
    {attachments.length > 1 ? <div aria-label="Выбор медиа" className="diagnostic-carousel-dots" role="group">
      {attachments.map((attachment, index) => <button aria-current={selected === index ? 'true' : undefined} aria-label={`Медиа ${index + 1} из ${attachments.length}`} className="diagnostic-carousel-dot" key={attachment.id} onClick={() => scrollToSlide(index)} type="button" />)}
    </div> : null}
  </>
}

function Attachment({ attachment, active, membershipEpoch, userId, transport, onDimensions }: AttachmentProps) {
  if (attachment.source === 'telegram') return <TelegramVideo active={active} attachment={attachment} onDimensions={onDimensions} userId={userId} transport={transport} />
  if (attachment.source === 'max') return <MaxVideo active={active} attachment={attachment} membershipEpoch={membershipEpoch} onDimensions={onDimensions} transport={transport} userId={userId} />
  if (attachment.kind === 'photo') {
    const path = attachment.displayPath ?? attachment.previewPath ?? attachment.originalDownloadPath
    return <div className="diagnostic-attachment">{path ? <PrivatePhoto path={path} onDimensions={(width, height) => onDimensions(attachment.id, width, height)} userId={userId} transport={transport} /> : null}</div>
  }
  if (attachment.kind === 'video') {
    const posterPath = attachment.displayPath ?? attachment.previewPath
    return <PrivateVideo active={active} path={attachment.playbackPath} posterPath={posterPath} onDimensions={(width, height) => onDimensions(attachment.id, width, height)} userId={userId} transport={transport} />
  }
  return attachment.playbackPath
    ? <PrivateMedia active={active} path={attachment.playbackPath} kind={attachment.kind} />
    : <p className="diagnostic-meta">Медиа ещё готовится.</p>
}

function TelegramVideo({ attachment, active, userId, transport, onDimensions }: { attachment: Extract<MemoryAttachment, { source: 'telegram' }>; active: boolean; userId: string; transport: AuthenticatedTransport; onDimensions: AttachmentProps['onDimensions'] }) {
  return <div className="diagnostic-attachment">{active && attachment.thumbnailPath ? <PrivatePhoto path={attachment.thumbnailPath} onDimensions={(width, height) => onDimensions(attachment.id, width, height)} userId={userId} transport={transport} /> : null}
  </div>
}

function TelegramVideoAction({ active, familyId, hostBridge, memoryId, transport }: { active: boolean; familyId: string; hostBridge: HostBridge; memoryId: string; transport: AuthenticatedTransport }) {
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)
  const handoff = useSingleFlightTelegramVideoHandoff(async () => {
    setBusy(true); setFailed(false)
    try { await navigateToTelegramVideo(hostBridge, () => openTelegramVideo(transport, familyId, memoryId)) }
    catch (error) { setFailed(true); setBusy(false); throw error }
  })
  return <div className="diagnostic-telegram-action">
    <button className="diagnostic-load-more" disabled={busy || !active} onClick={() => void handoff().catch(() => undefined)} type="button">{busy ? 'Открываем Telegram…' : 'Открыть видео в Telegram'}</button>
    {failed ? <p className="diagnostic-error" role="alert">Не удалось открыть видео в Telegram. Попробуйте ещё раз.</p> : null}
  </div>
}

function PrivatePhoto({ path, userId, transport, onDimensions }: { path: string; userId: string; transport: AuthenticatedTransport; onDimensions?: (width: number, height: number) => void }) {
  const url = usePrivateImageUrl(userId, path, transport)
  return url ? <img alt="Фотография воспоминания" className="diagnostic-photo" loading="lazy" onLoad={(event) => onDimensions?.(event.currentTarget.naturalWidth, event.currentTarget.naturalHeight)} src={url} /> : <span>Загружаем фотографию…</span>
}

function PrivateMedia({ path, kind, active }: { path: string; kind: 'video' | 'voice'; active: boolean }) {
  const video = useRef<HTMLVideoElement | null>(null)
  const [source, setSource] = useState<string | null>(null)
  useEffect(() => {
    let current = true
    setSource(null)
    if (active) void privateMediaSource(path).then((readyPath) => { if (current) setSource(readyPath) })
    return () => { current = false }
  }, [active, path])
  useEffect(() => {
    const element = video.current
    if (!element) return
    return () => { element.pause(); element.removeAttribute('src'); element.load() }
  }, [active, source])
  if (!source) return <p className="diagnostic-meta">{active ? 'Подготавливаем медиа…' : 'Видео не загружено.'}</p>
  return kind === 'voice'
    ? <audio className="diagnostic-attachment" controls preload="metadata" src={source} />
    : <video aria-label="Видео воспоминания" className="diagnostic-video" controls playsInline preload="metadata" ref={video} src={source} />
}

function PrivateVideo({ path, posterPath, active, userId, transport, onDimensions }: { path: string | null; posterPath: string | null; active: boolean; userId: string; transport: AuthenticatedTransport; onDimensions: (width: number, height: number) => void }) {
  const video = useRef<HTMLVideoElement | null>(null)
  const [source, setSource] = useState<string | null>(null)
  const posterUrl = usePrivateImageUrl(userId, posterPath, transport, active)
  useEffect(() => {
    let current = true
    setSource(null)
    if (active && path) void privateMediaSource(path).then((readyPath) => { if (current) setSource(readyPath) })
    return () => { current = false }
  }, [active, path])
  useEffect(() => {
    const element = video.current
    if (!element) return
    return () => { element.pause(); element.removeAttribute('src'); element.load() }
  }, [active, source])
  useEffect(() => {
    if (!active || !posterUrl) return
    const image = new Image()
    image.src = posterUrl
    void image.decode().then(() => onDimensions(image.naturalWidth, image.naturalHeight)).catch(() => undefined)
  }, [active, onDimensions, posterUrl])
  return source ? <video aria-label="Видео воспоминания" className="diagnostic-video" controls playsInline preload="metadata" poster={posterUrl ?? undefined} ref={video} onLoadedMetadata={(event) => onDimensions(event.currentTarget.videoWidth, event.currentTarget.videoHeight)} src={source} /> : posterUrl ? <img alt="Кадр видео" className="diagnostic-photo" onLoad={(event) => onDimensions(event.currentTarget.naturalWidth, event.currentTarget.naturalHeight)} src={posterUrl} /> : <p className="diagnostic-meta">{active ? 'Подготавливаем медиа…' : 'Видео не загружено.'}</p>
}

function MaxVideo({ attachment, active, membershipEpoch, transport, userId, onDimensions }: { attachment: Extract<MemoryAttachment, { source: 'max' }>; active: boolean; membershipEpoch: number; transport: AuthenticatedTransport; userId: string; onDimensions: AttachmentProps['onDimensions'] }) {
  const root = useRef<HTMLDivElement | null>(null)
  const video = useRef<HTMLVideoElement | null>(null)
  const [nearViewport, setNearViewport] = useState(false)
  const [readinessClock, setReadinessClock] = useState(() => Date.now())
  const queryClient = useQueryClient()
  const readinessPath = maxVideoReadinessPath(attachment.playbackPath)
  const posterReadinessPath = maxVideoPosterReadinessPath(attachment.playbackPath)
  const posterKey = [...feedQueryKeys.all, 'max-video-poster-readiness', userId, membershipEpoch, posterReadinessPath] as const
  const posterReadiness = useQuery({
    queryKey: posterKey,
    queryFn: ({ signal }) => withMaxVideoReadinessSlot(signal, () => transport.request(posterReadinessPath!, maxVideoPosterReadinessSchema, { signal })),
    enabled: active && nearViewport && Boolean(posterReadinessPath) && attachment.posterState === 'pending',
    refetchInterval: (query) => maxVideoPosterReadinessInterval(query.state), refetchIntervalInBackground: false, retry: false, refetchOnMount: false, refetchOnWindowFocus: false,
  })
  const posterPath = attachment.posterState === undefined ? maxVideoPosterPath(attachment.playbackPath) : attachment.posterState === 'ready' ? attachment.posterPath ?? null : posterReadiness.data?.state === 'ready' ? posterReadiness.data.posterPath : null
  const posterUrl = usePrivateImageUrl(userId, posterPath, transport, active)
  const readinessKey = [...feedQueryKeys.all, 'max-video-readiness', userId, membershipEpoch, readinessPath] as const
  const cachedReadiness = queryClient.getQueryState<MaxVideoReadiness>(readinessKey)
  const checkInterval = cachedReadiness ? maxVideoReadinessInterval(cachedReadiness) : 0
  const nextCheckAt = checkInterval === false ? null : Math.max(cachedReadiness?.dataUpdatedAt ?? 0, cachedReadiness?.errorUpdatedAt ?? 0) + checkInterval
  useEffect(() => {
    const element = root.current
    if (!element || typeof IntersectionObserver === 'undefined') return
    const observer = new IntersectionObserver(([entry]) => setNearViewport(Boolean(entry?.isIntersecting)), { rootMargin: '600px 0px' })
    observer.observe(element)
    return () => observer.disconnect()
  }, [])
  useEffect(() => {
    if (!active || !nearViewport || nextCheckAt === null || nextCheckAt <= readinessClock) return
    const timer = window.setTimeout(() => setReadinessClock(Date.now()), Math.max(0, nextCheckAt - Date.now()))
    return () => window.clearTimeout(timer)
  }, [active, nearViewport, nextCheckAt, readinessClock])
  const readiness = useQuery({
    queryKey: readinessKey,
    queryFn: ({ signal }) => withMaxVideoReadinessSlot(signal, () => transport.request(readinessPath!, maxVideoReadinessSchema, { signal })),
    enabled: active && nearViewport && Boolean(readinessPath) && nextCheckAt !== null && nextCheckAt <= readinessClock,
    retry: false, refetchOnMount: false, refetchOnWindowFocus: false,
  })
  const state = !readinessPath ? 'unknown' : readiness.data?.state ?? (readiness.isError ? 'check-error' : 'checking')
  const [src, setSrc] = useState<string | null>(null)
  useEffect(() => {
    let current = true
    setSrc(null)
    if (active && state === 'ready') void privateMediaSource(attachment.playbackPath).then((readyPath) => { if (current) setSrc(readyPath) })
    return () => { current = false }
  }, [active, attachment.playbackPath, state])
  useEffect(() => {
    const element = video.current
    if (!element) return
    return () => { element.pause(); element.removeAttribute('src'); element.load() }
  }, [active, src])
  const status = state === 'processing' || state === 'checking' ? 'Видео сохранено. Готовим просмотр.' : state === 'ready' ? 'Видео готово к просмотру.' : state === 'unavailable' || state === 'check-error' ? 'Не удалось подготовить просмотр.' : 'Проверяем видео…'
  useEffect(() => {
    if (!active || !posterUrl) return
    const image = new Image()
    image.src = posterUrl
    void image.decode().then(() => onDimensions(attachment.id, image.naturalWidth, image.naturalHeight)).catch(() => undefined)
  }, [active, attachment.id, onDimensions, posterUrl])
  return <div className="diagnostic-attachment" data-max-video-state={state} ref={root}>
    {src ? <video aria-label="Видео воспоминания" className="diagnostic-video" controls playsInline preload="metadata" poster={posterUrl ?? undefined} ref={video} onLoadedMetadata={(event) => onDimensions(attachment.id, event.currentTarget.videoWidth, event.currentTarget.videoHeight)} src={src} /> : posterUrl ? <img alt="Кадр видео" className="diagnostic-photo" onLoad={(event) => onDimensions(attachment.id, event.currentTarget.naturalWidth, event.currentTarget.naturalHeight)} src={posterUrl} /> : <p className="diagnostic-meta" role="status">{status}</p>}
  </div>
}
