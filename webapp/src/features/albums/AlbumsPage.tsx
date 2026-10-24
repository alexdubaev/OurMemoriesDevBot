/* eslint-disable typographyPolicy/use-typography-component -- album screens retain semantic headings and native controls. */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { AlbumDto, AlbumEntryDto, MemoryDto } from '@web-app-demo/contracts'
import { BottomNavigation } from '@/components/BottomNavigation'
import { ChildHeader } from '@/components/ChildHeader'
import { WebpIcon } from '@/components/WebpIcon'
import { useMemolyTheme } from '@/features/theme'
import { ApiRequestError, type AuthenticatedTransport } from '@/platform/api'
import type { HostBridge } from '@/platform/telegram'
import { albumsApi, createAlbumRequestScope, createAlbumScopeFailureSink, isAlbumScopeFailure, type AlbumFilter } from './api'
import { AlbumForm } from './AlbumForms'
import { AlbumEntryDetail } from './AlbumEntryDetail'
import { EntryEditor } from './EntryEditor'
import { WorkshopGallery } from './WorkshopGallery'
import { ComposerHost } from './ComposerHost'
import { coverSource, dateLabel, filled, kindNames, categories, suggestions, monthAgeLabel, type AlbumSource } from './model'
import { SourcePreview } from './SourcePreview'
import './albums.css'

type Route = 'catalog' | 'create' | 'album' | 'overview' | 'entry' | 'edit-entry' | 'edit-album' | 'cover'
export type AlbumsPageProps = {
  accountId: string; familyId: string; familyName: string; timezone: string; membershipEpoch: number; active: boolean
  child: { id: string; name: string; birthDate: string | null; avatarCrop?: { x: number; y: number; width: number; height: number } | null } | null
  childSubtitle: string; childAvatar?: { url: string | null; status: 'absent' | 'loading' | 'ready' | 'error' }
  role: 'full' | 'viewer'; transport: AuthenticatedTransport; hostBridge: HostBridge; onFeed: () => void; onFamily: () => void; onGifts: () => void; onAllFamilies: () => void; onAdd: () => void; onAccessLost: () => void
}
export function AlbumsPage(props: AlbumsPageProps) {
  const { accountId, familyId, membershipEpoch, active, role, transport, hostBridge } = props
  const scopeKey = `${accountId}:${familyId}:${membershipEpoch}`
  const { theme } = useMemolyTheme()
  const scopeController = useMemo(() => createAlbumRequestScope(), [])
  const scopeFailureSink = useMemo(() => createAlbumScopeFailureSink(), [])
  const api = useMemo(() => albumsApi(transport, familyId, scopeController.signal, scopeFailureSink.notify), [transport, familyId, scopeController, scopeFailureSink])
  useEffect(() => {
    // StrictMode replays effect cleanup/setup in development. Renew the scoped
    // controller after cleanup so the replayed reads are not born aborted.
    scopeController.renewIfAborted()
    return () => scopeController.abort()
  }, [scopeController])
  const [route, setRoute] = useState<Route>('catalog')
  const [filter, setFilter] = useState<AlbumFilter>('all')
  const [albums, setAlbums] = useState<AlbumDto[]>([])
  const [catalogCursor, setCatalogCursor] = useState<string | null>(null)
  const [album, setAlbum] = useState<AlbumDto | null>(null)
  const [entries, setEntries] = useState<AlbumEntryDto[]>([])
  const [entryCursor, setEntryCursor] = useState<string | null>(null)
  const [entry, setEntry] = useState<AlbumEntryDto | null>(null)
  const [suggestedTitle, setSuggestedTitle] = useState('')
  const [hiddenSuggestions, setHiddenSuggestions] = useState<string[]>([])
  const [category, setCategory] = useState<string | undefined>()
  const [year, setYear] = useState<number | undefined>()
  const [workshopLevel, setWorkshopLevel] = useState(1)
  const [workshopFocusId, setWorkshopFocusId] = useState<string | null>(null)
  const [workshopFocusTop, setWorkshopFocusTop] = useState<number | null>(null)
  const [groups, setGroups] = useState<{ year: number | null; month: number | null; count: number }[]>([])
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [conflict, setConflict] = useState(false)
  const [savedRefreshFailed, setSavedRefreshFailed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [offline, setOffline] = useState(() => !navigator.onLine)
  const [upload, setUpload] = useState<{ attach: (memory: MemoryDto) => Promise<void>; attachPhotos: (mediaIds: string[]) => Promise<void> } | null>(null)
  const [revision, setRevision] = useState(0)
  const pending = useRef(false)
  const paging = useRef(false)
  const requestGeneration = useRef(0)
  const activeAlbumId = useRef<string | null>(null)
  const albumRead = useRef(0)
  const scrolls = useRef<Partial<Record<Route, number>>>({ catalog: 0 })
  const focus = useRef<Partial<Record<Route, HTMLElement>>>({})
  const routeRef = useRef(route)
  const clearWorkshopFocus = useCallback(() => { setWorkshopFocusId(null); setWorkshopFocusTop(null) }, [])
  const backRef = useRef<() => void>(() => undefined)
  useLayoutEffect(() => { routeRef.current = route }, [route])
  const navigate = useCallback((next: Route) => {
    const previous = routeRef.current
    scrolls.current[previous] = window.scrollY
    if (document.activeElement instanceof HTMLElement) focus.current[previous] = document.activeElement
    setRoute(next)
  }, [])
  useLayoutEffect(() => {
    if (!active) return
    window.scrollTo(0, scrolls.current[route] ?? 0)
    const target = focus.current[route]
    if (target?.isConnected) target.focus({ preventScroll: true })
  }, [active, route])
  useEffect(() => { const online = () => setOffline(!navigator.onLine); window.addEventListener('online', online); window.addEventListener('offline', online); return () => { window.removeEventListener('online', online); window.removeEventListener('offline', online) } }, [])
  const fail = useCallback((reason: unknown) => {
    if (scopeController.isAborted()) return
    if (isAlbumScopeFailure(reason)) {
      requestGeneration.current += 1
      albumRead.current += 1
      activeAlbumId.current = null
      pending.current = false
      paging.current = false
      scopeController.abort()
      setAlbums([]); setCatalogCursor(null); setAlbum(null); setEntries([]); setEntryCursor(null); setEntry(null)
      setGroups([]); setUpload(null); setSuggestedTitle(''); setHiddenSuggestions([]); setCategory(undefined); setYear(undefined)
      setWorkshopFocusId(null); setWorkshopFocusTop(null); setRoute('catalog')
      setLoading(false); setLoadingMore(false); setBusy(false); setError(null); setConflict(false); setSavedRefreshFailed(false)
      scrolls.current = { catalog: 0 }; focus.current = {}
      props.onAccessLost()
      return
    }
    setConflict(reason instanceof ApiRequestError && reason.status === 409)
    setError(reason instanceof ApiRequestError && reason.status === 409 ? 'Альбом уже изменили. Обновите данные перед новым действием.' : 'Не удалось загрузить альбомы. Проверьте соединение и повторите.')
  }, [scopeController, props])
  useLayoutEffect(() => { scopeFailureSink.setHandler(fail) }, [scopeFailureSink, fail])
  useEffect(() => {
    if (album) return
    const generation = ++requestGeneration.current
    void api.list(filter).then((page) => { if (generation !== requestGeneration.current || scopeController.isAborted()) return; setAlbums(page.items); setCatalogCursor(page.nextCursor) }).catch((reason) => { if (generation === requestGeneration.current) fail(reason) }).finally(() => { if (generation === requestGeneration.current && !scopeController.isAborted()) setLoading(false) })
    return () => { requestGeneration.current += 1 }
    // fail only interprets the current scope; filter/revision are the read identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, filter, revision, album?.id])
  async function refreshAlbum(id: string, refreshEntry = false) {
    const generation = ++albumRead.current
    const [fresh, page, summary] = await Promise.all([api.album(id), api.entries(id, undefined, category, year), album?.kind === 'workshop' ? api.groups(id) : Promise.resolve(null)])
    const detail = refreshEntry && entry ? await api.entry(id, entry.id) : null
    if (scopeController.isAborted() || activeAlbumId.current !== id || generation !== albumRead.current) return
    setAlbum(fresh.album); setEntries(page.items); setEntryCursor(page.nextCursor)
    if (summary) setGroups(summary.groups)
    if (detail) setEntry(detail.entry)
    setSavedRefreshFailed(false); setError(null); setConflict(false)
  }
  useEffect(() => {
    if (!album) return
    const id = album.id; const generation = ++requestGeneration.current
    void Promise.all([api.entries(id, undefined, category, year), album.kind === 'workshop' ? api.groups(id) : Promise.resolve(null)]).then(([page, summary]) => {
      if (generation !== requestGeneration.current || scopeController.isAborted()) return
      setEntries(page.items); setEntryCursor(page.nextCursor); if (summary) setGroups(summary.groups)
    }).catch((reason) => { if (generation === requestGeneration.current) fail(reason) }).finally(() => { if (generation === requestGeneration.current && !scopeController.isAborted()) setLoading(false) })
    return () => { requestGeneration.current += 1 }
    // Album version changes do not restart the paginated window; only scope/filter does.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, album?.id, category, year])
  const back = useCallback(() => {
    if (pending.current) return
    if (upload) return
    if (route === 'edit-entry') { navigate(entry ? 'entry' : 'album'); return }
    if (route === 'entry' || route === 'overview' || route === 'edit-album' || route === 'cover') { navigate('album'); return }
    if (route === 'album') { activeAlbumId.current = null; albumRead.current += 1; setLoading(true); setError(null); setAlbum(null); setEntry(null); setCategory(undefined); setYear(undefined); setWorkshopFocusId(null); navigate('catalog'); return }
    if (route === 'create') { navigate('catalog'); return }
    props.onFeed()
  }, [upload, route, entry, navigate, props])
  useLayoutEffect(() => { backRef.current = back }, [back])
  useEffect(() => { if (active) return hostBridge.onBack(() => backRef.current()) }, [active, hostBridge])
  async function openAlbum(item: AlbumDto) {
    if (pending.current) return
    activeAlbumId.current = item.id; const generation = ++albumRead.current; setLoading(true); setWorkshopLevel(1); setWorkshopFocusId(null); setWorkshopFocusTop(null)
    setCategory(undefined); setYear(undefined); setEntries([]); setEntryCursor(null); setEntry(null); setAlbum(item); setError(null); setConflict(false); scrolls.current.album = 0; navigate('album')
    try { const result = await api.album(item.id); if (!scopeController.isAborted() && generation === albumRead.current && activeAlbumId.current === item.id) setAlbum(result.album) } catch (reason) { if (generation === albumRead.current && activeAlbumId.current === item.id) fail(reason) }
  }
  async function openEntry(item: AlbumEntryDto, trigger?: HTMLElement) {
    if (!album || pending.current) return
    pending.current = true; setBusy(true); setError(null)
    try {
      const result = await api.entry(album.id, item.id)
      if (scopeController.isAborted() || activeAlbumId.current !== album.id) return
      setEntry(result.entry); setAlbum((current) => current ? { ...current, version: result.entry.aggregateVersion } : current)
      if (album.kind === 'workshop' && trigger?.dataset.albumTile) { setWorkshopFocusId(trigger.dataset.albumTile); setWorkshopFocusTop(trigger.getBoundingClientRect().top) }
      // Workshop tiles are virtualized. Restore them by logical ID after the
      // gallery has measured and remounted the tile, never by an old node ref.
      if (trigger && album.kind !== 'workshop') focus.current[route] = trigger
      scrolls.current.entry = 0; navigate(result.entry.kind === 'month' && !filled(result.entry) && result.entry.capabilities.edit ? 'edit-entry' : 'entry')
    } catch (reason) { fail(reason) }
    finally { pending.current = false; if (!scopeController.isAborted()) setBusy(false) }
  }
  async function more() {
    if (paging.current || loading || conflict) return
    paging.current = true; setLoadingMore(true); const generation = requestGeneration.current
    try {
      if (album && entryCursor) { const page = await api.entries(album.id, entryCursor, category, year); if (generation === requestGeneration.current && !scopeController.isAborted()) { setEntries((old) => [...new Map([...old, ...page.items].map((item) => [item.id, item])).values()]); setEntryCursor(page.nextCursor) } }
      else if (!album && catalogCursor) { const page = await api.list(filter, catalogCursor); if (generation === requestGeneration.current && !scopeController.isAborted()) { setAlbums((old) => [...new Map([...old, ...page.items].map((item) => [item.id, item])).values()]); setCatalogCursor(page.nextCursor) } }
    } catch (reason) { fail(reason) } finally { paging.current = false; if (!scopeController.isAborted()) setLoadingMore(false) }
  }
  const sentinel = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!active || route !== 'album' || album?.kind !== 'workshop' || !entryCursor || loadingMore || loading || error || !sentinel.current) return
    const observer = new IntersectionObserver(([entry]) => { if (entry.isIntersecting) void more() }, { rootMargin: '500px' }); observer.observe(sentinel.current)
    return () => observer.disconnect()
    // more reads exactly this page/filter snapshot, rebind after each appended page.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, route, album?.id, entryCursor, loadingMore, loading, error])
  async function mutation(action: () => Promise<unknown>, after?: () => void) {
    if (pending.current || conflict) return
    pending.current = true; setBusy(true); setError(null)
    try {
      await action(); if (scopeController.isAborted()) return false
      after?.()
      try { if (album && !after) await refreshAlbum(album.id, route === 'entry'); else reloadCatalog() }
      catch (reason) { if (isAlbumScopeFailure(reason)) { fail(reason); return false } setSavedRefreshFailed(true) }
      return true
    } catch (reason) { fail(reason); return false }
    finally { pending.current = false; if (!scopeController.isAborted()) setBusy(false) }
  }
  function saved(version: number) {
    if (!album || scopeController.isAborted()) return
    setAlbum({ ...album, version }); setUpload(null); navigate('album')
    void refreshAlbum(album.id).catch((reason) => { if (isAlbumScopeFailure(reason)) fail(reason); else setSavedRefreshFailed(true) })
  }
  function reloadCatalog() { setLoading(true); setError(null); setConflict(false); setRevision((value) => value + 1) }
  function retryRead() {
    setLoading(true); setError(null); setConflict(false); setSavedRefreshFailed(false)
    if (album) void refreshAlbum(album.id, route === 'entry').catch(fail)
    else setRevision((value) => value + 1)
  }
  function changeCategory(value: string | undefined) { if (value === category) return; setLoading(true); setError(null); setCategory(value) }
  function changeYear(value: number | undefined) { if (value === year) return; setLoading(true); setError(null); setYear(value) }
  function changeCatalogFilter(value: AlbumFilter) { if (value === filter) return; setLoading(true); setError(null); setFilter(value) }
  const newEntry = (title = '') => { setEntry(null); setSuggestedTitle(title); scrolls.current['edit-entry'] = 0; navigate('edit-entry') }
  const image = (source: AlbumSource | null) => <SourcePreview accountId={accountId} active={active} scopeKey={scopeKey} source={source} transport={transport} />
  const editable = role === 'full' && album?.capabilities.edit
  const years = [...new Set(groups.map((group) => group.year).filter((year): year is number => year !== null))].sort((a, b) => b - a)
  const showNav = !upload
  return <div className="albums-surface" data-albums-route={route}>
    <div hidden={Boolean(upload)}>
      {route === 'catalog' ? <ChildHeader childAvatarCrop={props.child?.avatarCrop} childAvatarStatus={props.childAvatar?.status} childAvatarUrl={props.childAvatar?.url} childName={props.child?.name ?? props.familyName} childSubtitle={props.childSubtitle} mode="feed" onAllFamilies={props.onAllFamilies} theme={theme} /> : null}
      <main className="albums-main">
        {offline ? <p className="albums-error" role="status">Нет соединения. Изменения не сохраняются без подтверждения сервера.</p> : null}
        {savedRefreshFailed ? <div className="albums-error" role="alert"><p>Изменение сохранено. Обновить список пока не удалось.</p><button onClick={retryRead} type="button">Обновить данные</button></div> : null}
        {error ? <div className="albums-error" role="alert"><p>{error}</p><button disabled={busy} onClick={retryRead} type="button">Обновить данные</button></div> : null}
        {route === 'catalog' ? <><div className="albums-heading"><h1>Альбомы</h1>{role === 'full' ? <button aria-label="Создать альбом" className="albums-icon-button" onClick={() => navigate('create')} type="button"><WebpIcon decorative name="plus" size={24} /></button> : null}</div><p className="albums-muted">Истории, к которым хочется возвращаться</p><div aria-label="Фильтр альбомов" className="albums-chips">{(['all', 'template', 'custom'] as const).map((value, index) => <button aria-pressed={filter === value} key={value} onClick={() => changeCatalogFilter(value)} type="button">{['Все', 'По шаблону', 'Свои'][index]}</button>)}</div>
          {loading ? <Loading /> : <div className="albums-catalog">{albums.map((item) => <button className="albums-card" key={item.id} onClick={() => void openAlbum(item)} type="button"><span className={`albums-cover albums-kind-${item.kind}`}>{item.cover ? image(item.cover) : <><WebpIcon decorative name={item.kind === 'workshop' ? 'photo' : 'archive-box'} size={42} /><span>{kindNames[item.kind]}</span></>}<span className="albums-book-spine" /></span><strong>{item.title}</strong><small>{item.entryCount}{item.kind === 'year' ? ' из 12 месяцев' : item.kind === 'workshop' ? ' работ' : ' историй'}</small></button>)}</div>}
          {!loading && !error && !albums.length ? <div className="albums-empty"><WebpIcon decorative name="archive-box" size={48} /><h2>Соберите свою первую историю</h2><p>Здесь будут моменты первого года, открытия и маленькие творения.</p>{role === 'full' ? <button className="albums-primary" onClick={() => navigate('create')} type="button">Создать альбом</button> : <p>Альбомы появятся, когда семья их создаст.</p>}</div> : null}
          {catalogCursor && !loading ? <button className="albums-secondary" disabled={loadingMore} onClick={() => void more()} type="button">Ещё альбомы</button> : null}
        </> : null}
        {route === 'create' ? <AlbumForm api={api} child={props.child} onCancel={back} onSaved={(next) => { setAlbums((old) => [next, ...old]); void openAlbum(next) }} /> : null}
        {album && route === 'edit-album' ? <><AlbumForm album={album} api={api} child={props.child} onCancel={back} onSaved={(next) => { setAlbum(next); navigate('album') }} /><button className="albums-secondary" onClick={() => navigate('cover')} type="button">Выбрать обложку</button><button className="albums-danger" disabled={busy || conflict} onClick={() => { if (window.confirm('Удалить альбом? Исходные материалы сохранятся.')) void mutation(() => api.remove(album.id, album.version), () => { setAlbums((old) => old.filter((item) => item.id !== album.id)); activeAlbumId.current = null; setAlbum(null); navigate('catalog') }) }} type="button">Удалить альбом</button></> : null}
        {album && route === 'cover' ? <><header className="albums-toolbar"><button onClick={back} type="button">‹ Назад</button><h1>Обложка альбома</h1></header><p className="albums-muted">Выберите один из доступных кадров этого альбома.</p><button className="albums-secondary" disabled={busy || conflict} onClick={() => void mutation(async () => { const result = await api.update(album.id, { expectedVersion: album.version, coverSourceId: null }); setAlbum(result.album) })} type="button">Автоматическая обложка</button><div className="albums-picker-grid">{entries.flatMap((entry) => entry.sources).filter((source) => source.available && (source.kind === 'photo' || source.kind === 'video')).map((source) => <button aria-label="Выбрать этот кадр обложкой" className="albums-picker-item" disabled={busy || conflict} key={source.id} onClick={() => void mutation(async () => { const result = await api.update(album.id, { expectedVersion: album.version, coverSourceId: source.id }); setAlbum(result.album) })} type="button">{image(source)}</button>)}</div>{entryCursor ? <button onClick={() => void more()} type="button">Ещё кадры</button> : null}</> : null}
        {album && (route === 'album' || route === 'overview') ? <>
          <header className="albums-toolbar"><button onClick={back} type="button">‹ {route === 'overview' ? 'Альбом' : 'Альбомы'}</button><span>{kindNames[album.kind]}</span>{editable ? <button aria-label="Настройки альбома" onClick={() => navigate('edit-album')} type="button">•••</button> : null}</header>
          <section className={`albums-intro albums-kind-${album.kind}`}><div><p className="albums-kicker">{album.kind === 'free' ? 'Семейная история' : props.child?.name}</p><h1>{album.title}</h1>{album.description ? <p>{album.description}</p> : <p>{album.kind === 'year' ? 'Двенадцать глав, которые останутся с вами' : album.kind === 'workshop' ? 'Маленькие руки создают целый мир' : album.kind === 'events' ? 'Важные открытия — в своём ритме' : 'Самое дорогое — рядом'}</p>}<small>{album.entryCount}{album.kind === 'year' ? ' из 12 месяцев заполнено' : album.kind === 'workshop' ? ' работ' : ' историй'}</small></div></section>
          {album.kind === 'year' ? <div className="albums-chips"><button aria-pressed={route === 'album'} onClick={() => navigate('album')} type="button">Линия времени</button><button aria-pressed={route === 'overview'} onClick={() => navigate('overview')} type="button">Все 12 месяцев</button></div> : editable ? <button className="albums-primary" disabled={busy || conflict} onClick={() => newEntry()} type="button">{album.kind === 'workshop' ? 'Добавить работу' : 'Добавить историю'}</button> : null}
          {album.kind === 'workshop' ? <><div aria-label="Категории работ" className="albums-chips"><button aria-pressed={!category} onClick={() => changeCategory(undefined)} type="button">Все</button>{Object.entries(categories).map(([key, label]) => <button aria-pressed={category === key} key={key} onClick={() => changeCategory(key)} type="button">{label}</button>)}</div><div aria-label="Переход к году" className="albums-chips albums-year-jump"><button aria-pressed={year === undefined} onClick={() => changeYear(undefined)} type="button">Все годы</button>{years.map((value) => <button aria-pressed={year === value} key={value} onClick={() => { changeYear(value); window.scrollTo(0, 0) }} type="button">{value}</button>)}</div></> : null}
          {loading ? <Loading /> : album.kind === 'workshop' ? <WorkshopGallery accountId={accountId} active={active} entries={entries} focusId={route === 'album' ? workshopFocusId : null} focusTop={workshopFocusTop} level={workshopLevel} onFocusRestored={clearWorkshopFocus} onLevelChange={setWorkshopLevel} onOpen={(item, trigger) => void openEntry(item, trigger)} scopeKey={scopeKey} transport={transport} /> : <div className={route === 'overview' ? 'albums-month-overview' : album.kind === 'year' ? 'albums-timeline' : album.kind === 'free' ? 'albums-free-grid' : 'albums-event-list'}>{entries.map((item, index) => <div className={`albums-entry-row${filled(item) ? ' is-filled' : ''}`} key={item.id}>
            {album.kind === 'events' && item.date.precision === 'unknown' && entries[index - 1]?.date.precision !== 'unknown' ? <h2>Без даты</h2> : null}
            <button aria-label={item.monthNumber ? monthAgeLabel(item.monthNumber) : item.title || 'Открыть историю'} className="albums-entry-card" data-entry-id={item.id} disabled={busy} onClick={(event) => void openEntry(item, event.currentTarget)} type="button">{item.monthNumber ? <span className="albums-month-marker">{item.monthNumber}</span> : null}{filled(item) && coverSource(item.sources) ? <span className="albums-entry-image">{image(coverSource(item.sources))}</span> : null}<span className="albums-entry-copy"><strong>{item.title || (item.monthNumber ? monthAgeLabel(item.monthNumber) : 'Семейная история')}</strong>{item.caption ? <span>{item.caption.slice(0, 160)}</span> : null}<small>{item.monthNumber && !filled(item) ? role === 'full' ? 'Добавить тёплый момент' : 'Пока нет воспоминаний' : dateLabel(item.date)}{item.sourceCount ? ` · ${item.sourceCount} материалов` : ''}</small></span><span aria-hidden>›</span></button>
            {album.kind === 'free' && editable ? <div className="albums-order-actions"><button aria-label={`Переместить историю ${index + 1} вверх`} disabled={busy || conflict || index === 0} onClick={() => void mutation(() => api.reorder(album.id, item.id, entries[index - 1].id, album.version))} type="button">↑ Вверх</button><button aria-label={`Переместить историю ${index + 1} вниз`} disabled={busy || conflict || index === entries.length - 1} onClick={() => void mutation(() => api.reorder(album.id, item.id, entries[index + 2]?.id ?? null, album.version))} type="button">↓ Вниз</button></div> : null}
          </div>)}</div>}
          {!loading && !entries.length && !error ? <div className="albums-empty"><h2>{album.kind === 'workshop' ? 'Каждая работа — маленький мир' : 'История только начинается'}</h2><p>{category || year ? 'По этому фильтру пока нет работ.' : 'Добавьте первый момент из воспоминаний или загрузите новый.'}</p></div> : null}
          {album.kind === 'events' && editable ? <section className="albums-suggestions"><h2>С чего начать</h2><p className="albums-muted">Только идеи — у каждого свой путь</p>{suggestions.filter((title) => !hiddenSuggestions.includes(title) && !entries.some((entry) => entry.title === title)).map((title) => <div key={title}><button onClick={() => newEntry(title)} type="button">+ {title}</button><button aria-label={`Скрыть предложение ${title}`} onClick={() => setHiddenSuggestions((old) => [...old, title])} type="button">×</button></div>)}</section> : null}
          <div ref={sentinel} />{entryCursor && !loading ? <button className="albums-secondary" disabled={loadingMore || conflict} onClick={() => void more()} type="button">{loadingMore ? 'Загружаем…' : 'Ещё истории'}</button> : null}
        </> : null}
        {album && route === 'edit-entry' ? <EntryEditor accountId={accountId} album={album} api={api} birthDate={props.child?.birthDate} canUpload={role === 'full' && album.capabilities.edit} entry={entry} key={`${album.id}:${entry?.id ?? 'new'}:${suggestedTitle}`} onCancel={back} onSaved={saved} onUpload={(attach, attachPhotos) => setUpload({ attach, attachPhotos })} scopeKey={scopeKey} timezone={props.timezone} title={suggestedTitle} transport={transport} /> : null}
          {active && album && route === 'entry' && entry ? <AlbumEntryDetail accountId={accountId} active busy={busy} childName={props.child?.name ?? props.familyName} entry={entry} familyId={familyId} hostBridge={hostBridge} membershipEpoch={membershipEpoch} onBack={back} onEdit={() => navigate('edit-entry')} onRemove={() => { if (window.confirm(entry.kind === 'month' ? 'Очистить эту главу? Номер месяца и оригиналы сохранятся.' : 'Убрать историю из альбома? Оригиналы сохранятся.')) void mutation(() => entry.kind === 'month' ? api.clear(album.id, entry.id, album.version) : api.removeEntry(album.id, entry.id, album.version)).then((committed) => { if (committed && !scopeController.isAborted()) navigate('album') }) }} scopeKey={scopeKey} timezone={props.timezone} transport={transport} /> : null}
      </main>
    </div>
    {upload ? <ComposerHost active={active} attach={upload.attach} attachPhotos={upload.attachPhotos} childId={props.child?.id} familyId={familyId} familyTimezone={props.timezone} hostBridge={hostBridge} onClose={() => setUpload(null)} transport={transport} /> : null}
    {showNav ? <BottomNavigation active="albums" appearance="memoly" onAdd={props.child ? props.onAdd : undefined} onAlbums={() => undefined} onFamily={props.onFamily} onFeed={props.onFeed} onGifts={props.onGifts} role={role} /> : null}
  </div>
}
function Loading() { return <div aria-label="Загрузка альбомов" className="albums-loading" role="status"><span /><span /><span /><span /></div> }
