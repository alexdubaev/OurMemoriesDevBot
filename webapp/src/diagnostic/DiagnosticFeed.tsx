import { useEffect, useRef, useState } from 'react'
import type { MemoryAttachment, MemoryDto } from '@web-app-demo/contracts'

import { useFeedQuery } from '@/features/feed/queries'
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
    {memories.map((memory) => <Memory key={memory.id} familyId={familyId} hostBridge={hostBridge} memory={memory} userId={userId} transport={transport} />)}
    {memories.length === 0 ? <p>Воспоминаний пока нет.</p> : null}
    <div aria-hidden="true" ref={sentinel} />
    {feed.hasNextPage ? <button className="diagnostic-load-more" disabled={feed.isFetchingNextPage} onClick={() => void feed.fetchNextPage()} type="button">{feed.isFetchingNextPage ? 'Загружаем…' : 'Загрузить ещё'}</button> : null}
  </>
}

function Memory({ familyId, hostBridge, memory, userId, transport }: { familyId: string; hostBridge: HostBridge; memory: MemoryDto; userId: string; transport: AuthenticatedTransport }) {
  return <article className="diagnostic-memory">
    <h2>{memory.author.name}</h2>
    <p className="diagnostic-meta"><time dateTime={memory.occurredAt}>{new Date(memory.occurredAt).toLocaleString('ru-RU')}</time>{memory.kind === 'note' ? ' · заметка' : ` · ${memory.kind}`}</p>
    {memory.body ? <p className="diagnostic-note">{memory.body}</p> : null}
    {memory.attachments.map((attachment) => <Attachment key={attachment.id} attachment={attachment} familyId={familyId} hostBridge={hostBridge} memoryId={memory.id} userId={userId} transport={transport} />)}
  </article>
}

function Attachment({ attachment, familyId, hostBridge, memoryId, userId, transport }: { attachment: MemoryAttachment; familyId: string; hostBridge: HostBridge; memoryId: string; userId: string; transport: AuthenticatedTransport }) {
  if (attachment.source === 'telegram') {
    return <TelegramVideo attachment={attachment} familyId={familyId} hostBridge={hostBridge} memoryId={memoryId} userId={userId} transport={transport} />
  }
  if (attachment.kind === 'photo') {
    const path = attachment.displayPath ?? attachment.previewPath ?? attachment.originalDownloadPath
    return path ? <div className="diagnostic-attachment"><PrivatePhoto path={path} userId={userId} transport={transport} /></div> : null
  }
  return attachment.playbackPath
    ? <PrivateMedia path={attachment.playbackPath} kind={attachment.kind} />
    : <p className="diagnostic-meta">Медиа ещё готовится.</p>
}

function TelegramVideo({ attachment, familyId, hostBridge, memoryId, userId, transport }: {
  attachment: Extract<MemoryAttachment, { source: 'telegram' }>
  familyId: string
  hostBridge: HostBridge
  memoryId: string
  userId: string
  transport: AuthenticatedTransport
}) {
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)
  const handoff = useSingleFlightTelegramVideoHandoff(async () => {
    setBusy(true)
    setFailed(false)
    try {
      await navigateToTelegramVideo(hostBridge, () => openTelegramVideo(transport, familyId, memoryId))
    } catch (error) {
      setFailed(true)
      setBusy(false)
      throw error
    }
  })
  return <div className="diagnostic-attachment">
    {attachment.thumbnailPath ? <PrivatePhoto path={attachment.thumbnailPath} userId={userId} transport={transport} /> : null}
    <button className="diagnostic-load-more" disabled={busy} onClick={() => void handoff().catch(() => undefined)} type="button">{busy ? 'Открываем Telegram…' : 'Открыть видео в Telegram'}</button>
    {failed ? <p className="diagnostic-error" role="alert">Не удалось открыть видео в Telegram. Попробуйте ещё раз.</p> : null}
  </div>
}

function PrivatePhoto({ path, userId, transport }: { path: string; userId: string; transport: AuthenticatedTransport }) {
  const url = usePrivateImageUrl(userId, path, transport)
  return url ? <img alt="Фотография воспоминания" className="diagnostic-photo" loading="lazy" src={url} /> : <span>Загружаем фотографию…</span>
}

function PrivateMedia({ path, kind }: { path: string; kind: 'video' | 'voice' }) {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    let active = true
    setUrl(null)
    void privateMediaSource(path).then((source) => { if (active) setUrl(source) })
    return () => { active = false }
  }, [path])
  if (!url) return <p className="diagnostic-meta">Подготавливаем медиа…</p>
  return kind === 'voice'
    ? <audio className="diagnostic-attachment" controls preload="metadata" src={url} />
    : <video className="diagnostic-attachment" controls playsInline preload="metadata" src={url} />
}
