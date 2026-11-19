/* eslint-disable typographyPolicy/use-typography-component -- album gallery controls use the album stylesheet. */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { AlbumEntryDto, MemoryDto } from '@web-app-demo/contracts'
import { MediaPlaybackCoordinator, MemoryMediaScope, MixedMediaViewer } from '@/features/feed'
import { ApiRequestError, type AuthenticatedTransport } from '@/platform/api'
import type { HostBridge } from '@/platform/telegram'
import type { AlbumOpenState } from './album-open-state'
import type { AlbumsApi } from './api'
import { MonthPhotoCollage } from './MonthPhotoCollage'
import { dateLabel, sourceDate, type AlbumSource } from './model'

type Props = {
  api: AlbumsApi; albumId: string; entries: AlbumEntryDto[]; entryCursor: string | null; openState: AlbumOpenState
  accountId: string; membershipEpoch: number; scopeKey: string; transport: AuthenticatedTransport
  familyId: string; timezone: string; childName: string; hostBridge: HostBridge
  onViewerOpenChange: (open: boolean) => void; onRefresh: () => void
}

const photoTotal = (entries: AlbumEntryDto[]) => entries.reduce((count, entry) => count + (entry.collection?.photoCount ?? entry.sources.filter((source) => source.available && source.kind === 'photo').length), 0)
const hasPhotos = (entry: AlbumEntryDto) => Boolean(entry.collection?.photoCount ?? entry.sourceCount)
const photoVersion = (entry: AlbumEntryDto) => `free:${entry.aggregateVersion}:${entry.version}`

export function FreeAlbumGalleryLoading() {
  return <div aria-label="Загружаем фотографии…" className="month-collage-cover albums-free-gallery-loading" role="status" />
}

// Read the existing entries in their saved order, one bounded source page at a time.
// Their identities, discussions and source links remain untouched.
export function FreeAlbumGallery(props: Props) {
  const { api, albumId, accountId, membershipEpoch, scopeKey, transport, familyId, timezone, childName, hostBridge, onViewerOpenChange, onRefresh, openState } = props
  const firstIndex = props.entries.findIndex(hasPhotos)
  const firstEntry = props.entries[firstIndex]
  const [pages, setPages] = useState<AlbumSource[][]>(() => {
    const cached = firstEntry && openState.photoPage(albumId, firstEntry.id, photoVersion(firstEntry))
    return cached && cached.items.length ? [cached.items] : []
  })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(false)
  const [hasMore, setHasMore] = useState(Boolean(firstEntry || props.entryCursor))
  const [totalInfo, setTotalInfo] = useState(() => ({ known: photoTotal(props.entries), moreEntries: Boolean(props.entryCursor) }))
  const position = useRef({ entries: props.entries, entryCursor: props.entryCursor, index: firstEntry ? firstIndex : props.entries.length, sourceCursor: undefined as string | undefined, done: !firstEntry && !props.entryCursor, firstEntryId: firstEntry?.id })
  const request = useRef<AbortController | null>(null)
  const sentinel = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLElement | null>(null)
  const [viewer, setViewer] = useState<{ index: number; start: number } | null>(null)

  const more = useCallback(async () => {
    const state = position.current
    if (request.current || state.done) return
    const controller = new AbortController()
    request.current = controller; setLoading(true); setError(false)
    let refreshingFirst: AlbumEntryDto | undefined
    try {
      while (state.index < state.entries.length && !hasPhotos(state.entries[state.index])) state.index += 1
      if (state.index === state.entries.length && state.entryCursor) {
        const page = await api.entries(albumId, state.entryCursor)
        if (controller.signal.aborted) return
        state.entries = [...state.entries, ...page.items]; state.entryCursor = page.nextCursor
        while (state.index < state.entries.length && !hasPhotos(state.entries[state.index])) state.index += 1
      }
      if (state.index < state.entries.length) {
        const entry = state.entries[state.index]
        if (entry.id === state.firstEntryId && !state.sourceCursor) refreshingFirst = entry
        const page = await api.monthSources(albumId, entry.id, 'photo', state.sourceCursor, controller.signal)
        if (controller.signal.aborted) return
        if (refreshingFirst) {
          openState.rememberPhotos(albumId, entry.id, photoVersion(entry), page)
          setPages(page.items.length ? [page.items] : [])
        } else if (page.items.length) setPages((old) => [...old, page.items])
        state.sourceCursor = page.nextCursor ?? undefined
        if (!page.nextCursor) state.index += 1
      }
      state.done = state.index >= state.entries.length && !state.entryCursor
      setHasMore(!state.done)
      setTotalInfo({ known: photoTotal(state.entries), moreEntries: Boolean(state.entryCursor) })
    } catch (reason) {
      if (controller.signal.aborted) return
      if (refreshingFirst && reason instanceof ApiRequestError && reason.status === 404) {
        openState.rememberPhotos(albumId, refreshingFirst.id, photoVersion(refreshingFirst), null)
        setPages([])
      }
      setError(true)
    }
    finally { if (request.current === controller) { request.current = null; setLoading(false) } }
  }, [api, albumId, openState])

  useEffect(() => { void more(); return () => { request.current?.abort(); request.current = null } }, [more])
  useEffect(() => () => onViewerOpenChange(false), [onViewerOpenChange])
  useEffect(() => {
    if (!sentinel.current || !hasMore || loading || error) return
    const observer = new IntersectionObserver(([item]) => { if (item.isIntersecting) void more() }, { rootMargin: '320px' })
    observer.observe(sentinel.current)
    return () => observer.disconnect()
  }, [more, hasMore, loading, error, pages])
  const order = useMemo(() => pages.flat(), [pages])
  const total = Math.max(order.length + Number(hasMore), totalInfo.known + Number(totalInfo.moreEntries))
  useEffect(() => {
    if (!viewer || viewer.index < order.length - 3 || !hasMore || loading || error) return
    void more()
  }, [viewer, order.length, hasMore, loading, error, more])
  const cover = order[0] ?? null
  const collagePages = useMemo(() => pages.map((page, index) => index === 0 ? page.slice(1) : page), [pages])
  const start = viewer?.start ?? 0
  const attachments = viewer ? order.slice(start, start + 17).flatMap(({ attachment }) => attachment ? [attachment] : []) : []
  const memory: MemoryDto | null = viewer && attachments.length ? {
    id: albumId, familyId, childId: familyId, author: { id: accountId, name: 'Фото в альбоме', avatarPath: null },
    kind: 'photo', body: '', occurredAt: '1970-01-01T00:00:00.000Z', createdAt: '1970-01-01T00:00:00.000Z',
    firstPublishedAt: null, sourcePublishedAt: null, status: 'published', version: 1, attachments,
    reactionCounts: {}, currentUserReaction: null, likes: { count: 0, likedByMe: false }, capabilities: { edit: false, delete: false, like: false },
  } : null
  return <MemoryMediaScope accountId={accountId} membershipEpoch={membershipEpoch}><MediaPlaybackCoordinator active>
    {!cover && hasMore && !error ? <FreeAlbumGalleryLoading /> : null}
    <MonthPhotoCollage accountId={accountId} cover={cover} keepWarm label="Фотографии альбома" onOpen={(index, element) => {
      if (!order[index]?.attachment) return
      trigger.current = element; onViewerOpenChange(true); setViewer({ index, start: Math.max(0, index - 8) })
    }} pages={collagePages} scopeKey={scopeKey} showCoverIcon={false} transport={transport} />
    <div ref={sentinel} />
    {loading && cover ? <p role="status">Загружаем фотографии…</p> : null}
    {error ? <p className="albums-error" role="alert">Не удалось загрузить фотографии. <button onClick={() => { if (viewer) { setViewer(null); onViewerOpenChange(false) } onRefresh() }} type="button">Обновить альбом</button></p> : null}
    {hasMore ? <button className="albums-secondary" disabled={loading || error} onClick={() => void more()} type="button">Ещё фотографии</button> : !order.length && !error ? <p className="albums-muted">Добавьте первые фотографии в этот альбом.</p> : null}
    {viewer && memory ? <MixedMediaViewer childName={childName} familyTimezone={timezone} hostBridge={hostBridge} index={viewer.index - start} memory={memory} onClose={() => { setViewer(null); onViewerOpenChange(false) }} onIndexChange={(index) => {
      const next = start + index
      setViewer({ index: next, start: next <= start + 2 && start > 0 || next >= start + 15 && start + 17 < order.length ? Math.max(0, next - 8) : start })
    }} pageWindow={{ offset: start, total, onRequestNext: () => { void more() } }} preferReturnFocus returnFocusRef={trigger} sourcePresentation={Object.fromEntries(order.slice(start, start + 17).flatMap((source) => source.attachment ? [[source.attachment.id, { authorLabel: 'Фото в альбоме', dateLabel: source.occurredAt ? dateLabel(sourceDate(source, timezone)) : 'Без даты' }]] : []))} transport={transport} /> : null}
  </MediaPlaybackCoordinator></MemoryMediaScope>
}
