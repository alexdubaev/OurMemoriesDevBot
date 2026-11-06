/* eslint-disable typographyPolicy/use-typography-component -- semantic gallery controls use the album stylesheet. */
import { useEffect, useMemo, useRef, useState } from 'react'
import type { AlbumEntryDto, MemoryDto } from '@web-app-demo/contracts'
import { WebpIcon } from '@/components/WebpIcon'
import { loadMemory, MediaPlaybackCoordinator, MemoryMediaScope, MixedMediaViewer } from '@/features/feed'
import type { ApiRequestError, AuthenticatedTransport } from '@/platform/api'
import type { HostBridge } from '@/platform/telegram'
import { AlbumEntrySocial } from './AlbumEntrySocial'
import { MonthPhotoCollage } from './MonthPhotoCollage'
import { SourcePreview } from './SourcePreview'
import type { AlbumsApi } from './api'
import { dateLabel, filled, monthAgeLabel, type AlbumSource } from './model'
import { useMonthSourcePages } from './useMonthSourcePages'

type Props = {
  api: AlbumsApi; albumId: string; entry: AlbumEntryDto; accountId: string; membershipEpoch: number; scopeKey: string
  transport: AuthenticatedTransport; familyId: string; timezone: string; childName: string; hostBridge: HostBridge
  busy: boolean; onBack: () => void; onEdit: () => void; onClear: () => void; onAdd: () => void; onCover: () => void
  onRemovePhoto: () => void; onRefresh: () => void; onViewerOpenChange: (open: boolean) => void
  onDiscussionInvalidated: (reason: ApiRequestError) => void
}
type Viewer = { kind: 'photos'; index: number; start: number } | { kind: 'original'; memory: MemoryDto }
const viewerWindowSize = 17
const windowStart = (index: number) => Math.max(0, index - 8)

function reveal(element: HTMLElement) {
  element.scrollIntoView({ block: 'start' })
  element.focus({ preventScroll: true })
}

function photoCountLabel(count: number) {
  const suffix = count % 100 >= 11 && count % 100 <= 14 ? 'фотографий'
    : count % 10 === 1 ? 'фотография' : count % 10 >= 2 && count % 10 <= 4 ? 'фотографии' : 'фотографий'
  return `${count} ${suffix}`
}

export function MonthEntryDetail({ api, albumId, entry, accountId, membershipEpoch, scopeKey, transport, familyId, timezone, childName, hostBridge, busy, onBack, onEdit, onClear, onAdd, onCover, onRemovePhoto, onRefresh, onViewerOpenChange, onDiscussionInvalidated }: Props) {
  const cover = entry.month?.cover ?? null
  const photoCount = entry.month?.photoCount ?? 0
  const otherCount = entry.month?.otherCount ?? 0
  const photos = useMonthSourcePages(api, albumId, entry.id, 'photo', photoCount > Number(Boolean(cover)))
  const { more: morePhotos, nextCursor: photoCursor, loading: photosLoading, error: photosError } = photos
  const others = useMonthSourcePages(api, albumId, entry.id, 'other', otherCount > 0)
  const photoPages = useMemo(() => photos.pages.map((page) => page.filter(({ id }) => id !== cover?.id)), [cover, photos.pages])
  const photoOrder = useMemo(() => [...(cover ? [cover] : []), ...photoPages.flat()], [cover, photoPages])
  const [otherPage, setOtherPage] = useState(0)
  const [viewer, setViewer] = useState<Viewer | null>(null)
  const [openingOriginal, setOpeningOriginal] = useState(false)
  const [viewerError, setViewerError] = useState(false)
  const originalRequest = useRef<AbortController | null>(null)
  const trigger = useRef<HTMLElement | null>(null)
  const sentinel = useRef<HTMLDivElement>(null)
  const menu = useRef<HTMLDetailsElement>(null)
  const autoPaging = useRef(true)
  const pendingJump = useRef<HTMLElement | null>(null)
  const storyAndDiscussion = useRef<HTMLDivElement>(null)
  const otherMaterials = useRef<HTMLElement>(null)
  const viewerIndex = viewer?.kind === 'photos' ? viewer.index : null
  const viewerStart = viewer?.kind === 'photos'
    ? (viewer.index >= viewer.start + viewerWindowSize - 2 && photoOrder.length > viewer.start + viewerWindowSize ? windowStart(viewer.index) : viewer.start)
    : 0

  useEffect(() => () => { originalRequest.current?.abort(); onViewerOpenChange(false) }, [onViewerOpenChange])
  useEffect(() => {
    if (!sentinel.current || !photoCursor || photosLoading || photosError) return
    const observer = new IntersectionObserver(([target]) => { if (autoPaging.current && target.isIntersecting) morePhotos() }, { rootMargin: '320px' })
    observer.observe(sentinel.current)
    return () => observer.disconnect()
  }, [photoCursor, photosLoading, photosError, morePhotos])
  useEffect(() => {
    if (viewerIndex === null || viewerIndex < photoOrder.length - 3 || !photoCursor || photosLoading || photosError) return
    const frame = requestAnimationFrame(morePhotos)
    return () => cancelAnimationFrame(frame)
  }, [viewerIndex, photoOrder.length, photoCursor, photosLoading, photosError, morePhotos])
  useEffect(() => {
    if (!photosLoading && pendingJump.current) {
      reveal(pendingJump.current)
      pendingJump.current = null
    }
  }, [photosLoading])

  function openPhoto(index: number, element: HTMLElement) {
    if (!photoOrder[index]?.attachment) return
    originalRequest.current?.abort()
    setOpeningOriginal(false)
    setViewerError(false)
    trigger.current = element
    onViewerOpenChange(true)
    setViewer({ kind: 'photos', index, start: windowStart(index) })
  }
  async function openOther(source: AlbumSource, element: HTMLElement) {
    if (!source.memoryId || !source.available) return
    originalRequest.current?.abort()
    const controller = new AbortController()
    originalRequest.current = controller
    trigger.current = element
    setOpeningOriginal(true)
    setViewerError(false)
    try {
      const memory = await loadMemory(transport, familyId, source.memoryId, controller.signal)
      if (controller.signal.aborted) return
      const media = memory.attachments.find((attachment) => source.sourceKind === 'memory' ? attachment.kind === 'voice' : attachment.id === source.sourceId)
      if (!media) { setViewerError(true); return }
      onViewerOpenChange(true)
      setViewer({ kind: 'original', memory: { ...memory, attachments: [media] } })
    } catch {
      if (!controller.signal.aborted) setViewerError(true)
    } finally {
      if (!controller.signal.aborted) setOpeningOriginal(false)
    }
  }
  function closeViewer() {
    onViewerOpenChange(false)
    setViewer(null)
  }
  function requestViewerNext() {
    if (photosError === 'stale') { closeViewer(); onRefresh() }
    else if (photosError === 'network') photos.retry()
    else morePhotos()
  }
  function movePhoto(index: number) {
    if (viewer?.kind !== 'photos') return
    const next = viewerStart + index
    const last = Math.min(photoOrder.length, viewerStart + viewerWindowSize) - 1
    const start = (viewerStart > 0 && next <= viewerStart + 2 || last < photoOrder.length - 1 && next >= last - 2) ? windowStart(next) : viewerStart
    setViewer({ kind: 'photos', index: next, start })
  }
  function chooseAction(action: () => void) {
    if (menu.current) menu.current.open = false
    action()
  }
  function jumpTo(target: HTMLElement | null) {
    if (!target) return
    autoPaging.current = false
    if (photosLoading) pendingJump.current = target
    else reveal(target)
  }

  const windowPhotos = viewer?.kind === 'photos' ? photoOrder.slice(viewerStart, viewerStart + viewerWindowSize) : []
  const windowAttachments = windowPhotos.flatMap(({ attachment }) => attachment ? [attachment] : [])
  const photosMemory: MemoryDto | null = viewer?.kind === 'photos' && windowAttachments.length ? {
    id: entry.id, familyId, childId: familyId, author: { id: accountId, name: 'Фото в альбоме', avatarPath: null },
    kind: 'photo', body: '', occurredAt: '1970-01-01T00:00:00.000Z', createdAt: '1970-01-01T00:00:00.000Z',
    firstPublishedAt: null, sourcePublishedAt: null, status: 'published', version: 1, attachments: windowAttachments,
    reactionCounts: {}, currentUserReaction: null, likes: { count: 0, likedByMe: false }, capabilities: { edit: false, delete: false, like: false },
  } : null
  const date = entry.date.precision === 'unknown' ? '' : dateLabel(entry.date)

  return <MemoryMediaScope accountId={accountId} membershipEpoch={membershipEpoch}><MediaPlaybackCoordinator active>
    <section className="albums-entry-detail month-entry-detail">
      <header className="albums-toolbar month-entry-toolbar">
        <button disabled={busy} onClick={onBack} type="button">‹ Назад</button>
        <h1>{monthAgeLabel(entry.monthNumber!)}</h1>
        {entry.capabilities.edit || filled(entry) ? <details className="albums-menu" ref={menu}>
          <summary aria-label="Меню месяца">⋯</summary>
          <div className="albums-menu-content">
            {entry.capabilities.edit ? <><button disabled={busy} onClick={() => chooseAction(onAdd)} type="button">Добавить фотографии</button>
            <button disabled={busy} onClick={() => chooseAction(onCover)} type="button">Обложка месяца</button>
            <button disabled={busy} onClick={() => chooseAction(onEdit)} type="button">Редактировать историю</button>
            {photoCount ? <button disabled={busy} onClick={() => chooseAction(onRemovePhoto)} type="button">Убрать фотографию</button> : null}
            <button disabled={busy} onClick={() => chooseAction(onClear)} type="button">Очистить главу</button></> : null}
            {filled(entry) ? <button onClick={() => chooseAction(() => jumpTo(storyAndDiscussion.current))} type="button">История и обсуждение</button> : null}
            {otherCount ? <button onClick={() => chooseAction(() => jumpTo(otherMaterials.current))} type="button">Другие материалы</button> : null}
          </div>
        </details> : null}
      </header>
      <div className="month-entry-meta">
        <p>{[date, photoCountLabel(photoCount), otherCount ? `Другие материалы: ${otherCount}` : ''].filter(Boolean).join(' · ')}</p>
        {entry.capabilities.edit ? <button className="month-entry-add" disabled={busy} onClick={onAdd} type="button"><WebpIcon decorative name="plus" size={16} />Добавить фотографии</button> : null}
      </div>
      {photoCount ? <MonthPhotoCollage accountId={accountId} cover={cover} onOpen={openPhoto} pages={photoPages} scopeKey={scopeKey} transport={transport} />
        : <div className="month-photo-empty"><SourcePreview accountId={accountId} scopeKey={scopeKey} transport={transport} /><p>Фотографий пока нет</p></div>}
      <div ref={sentinel} />
      {photos.loading ? <p className="albums-muted" role="status">Загружаем фотографии…</p> : null}
      {photos.error ? <p className="albums-error" role="alert">{photos.error === 'stale' ? 'Список фотографий изменился.' : 'Не удалось загрузить фотографии.'} <button onClick={photos.error === 'stale' ? onRefresh : photos.retry} type="button">{photos.error === 'stale' ? 'Обновить фотографии' : 'Повторить'}</button></p> : null}
      {photos.nextCursor && !photos.error && !photos.loading ? <button className="albums-secondary" onClick={photos.more} type="button">Ещё фотографии</button> : null}
      {filled(entry) || entry.title || entry.childQuote ? <div ref={storyAndDiscussion} tabIndex={-1}>
        {entry.title || entry.caption || entry.childQuote ? <section className="month-entry-story">
        {entry.title ? <h2>{entry.title}</h2> : null}
        {entry.caption ? <p className="albums-story">{entry.caption}</p> : null}
        {entry.childQuote ? <blockquote>«{entry.childQuote}»</blockquote> : null}
        </section> : null}
        {filled(entry) ? <AlbumEntrySocial accountId={accountId} albumId={albumId} entryId={entry.id} familyId={familyId} hostBridge={hostBridge} membershipEpoch={membershipEpoch} onInvalidated={onDiscussionInvalidated} timezone={timezone} transport={transport} /> : null}
      </div> : null}
      {otherCount ? <section className="month-other-materials" ref={otherMaterials} tabIndex={-1}>
        <h2>Другие материалы</h2>
        <div className="albums-detail-sources">
          {(others.pages[otherPage] ?? []).map((source, index) => <article key={source.id}>
            {source.kind === 'note' ? <p className="albums-note">{source.body || 'Заметка без текста'}</p>
              : <button aria-label={`Открыть ${source.kind === 'voice' ? 'голосовое' : 'видео'} ${index + 1}`} disabled={openingOriginal} onClick={(event) => void openOther(source, event.currentTarget)} type="button"><SourcePreview accountId={accountId} scopeKey={scopeKey} source={source} transport={transport} /></button>}
          </article>)}
        </div>
        {others.loading || openingOriginal ? <p role="status">{openingOriginal ? 'Открываем оригинал…' : 'Загружаем материалы…'}</p> : null}
        {viewerError ? <p className="albums-error" role="alert">Не удалось открыть оригинал. Проверьте соединение и повторите.</p> : null}
        {others.error ? <p className="albums-error" role="alert">Не удалось загрузить материалы. <button onClick={others.retry} type="button">Повторить</button></p> : null}
        <div className="albums-form-actions">
          {otherPage > 0 ? <button onClick={() => setOtherPage(otherPage - 1)} type="button">Предыдущие материалы</button> : null}
          {otherPage + 1 < others.pages.length || others.nextCursor && otherPage < others.pages.length ? <button disabled={others.loading || Boolean(others.error)} onClick={() => { if (otherPage + 1 >= others.pages.length) others.more(); setOtherPage(otherPage + 1) }} type="button">Следующие материалы</button> : null}
        </div>
      </section> : null}
    </section>
    {viewer?.kind === 'photos' && photosMemory ? <MixedMediaViewer childName={childName} familyTimezone={timezone} hostBridge={hostBridge} index={viewer.index - viewerStart} memory={photosMemory} onClose={closeViewer} onIndexChange={movePhoto} pageWindow={{ offset: viewerStart, total: photoCount, onRequestNext: requestViewerNext }} preferReturnFocus returnFocusRef={trigger} sourcePresentation={Object.fromEntries(windowAttachments.map(({ id }) => [id, { authorLabel: 'Фото в альбоме', dateLabel: date || 'Без даты' }]))} transport={transport} /> : null}
    {viewer?.kind === 'original' ? <MixedMediaViewer childName={childName} familyTimezone={timezone} hostBridge={hostBridge} index={0} memory={viewer.memory} onClose={closeViewer} onIndexChange={() => undefined} preferReturnFocus returnFocusRef={trigger} transport={transport} /> : null}
  </MediaPlaybackCoordinator></MemoryMediaScope>
}
