/* eslint-disable typographyPolicy/use-typography-component -- album screens retain semantic headings and native controls. */
import { useCallback, useEffect, useEffectEvent, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { AlbumDto, AlbumEntryDto, ChildDto, MemoryDto } from '@web-app-demo/contracts'
import { BottomNavigation } from '@/components/BottomNavigation'
import { ChildHeader } from '@/components/ChildHeader'
import { FamilyHeaderV2 } from '@/components/ui-v2/FamilyHeaderV2'
import { FamilyChildAvatar } from '@/features/family'
import { WebpIcon } from '@/components/WebpIcon'
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog'
import { useMemolyTheme } from '@/features/theme'
import { ApiRequestError, type AuthenticatedTransport } from '@/platform/api'
import type { HostBridge } from '@/platform/telegram'
import { albumsApi, createAlbumRequestScope, createAlbumScopeFailureSink, isAlbumScopeFailure, type AlbumFilter } from './api'
import { AlbumForm } from './AlbumForms'
import { groupAlbumsByChild } from './child-groups'
import { AlbumEntryDetail } from './AlbumEntryDetail'
import { FreeAlbumGallery } from './FreeAlbumGallery'
import { MonthEntryDetail } from './MonthEntryDetail'
import { MonthAddPhotos } from './MonthAddPhotos'
import { MonthCoverPicker, AlbumCoverCandidates } from './MonthCoverPicker'
import { EntryEditor } from './EntryEditor'
import { WorkshopGallery } from './WorkshopGallery'
import { ComposerHost } from './ComposerHost'
import { entryCover, dateLabel, filled, kindNames, categories, suggestions, monthAgeLabel, type AlbumSource } from './model'
import { AlbumCatalogPresentation } from './AlbumCatalogPresentation'
import { AlbumWatercolor, AlbumWatercolorFooter } from './AlbumWatercolor'
import { SourcePreview } from './SourcePreview'
import './albums.css'

type Route = 'free-add' | 'stories' | 'catalog' | 'create' | 'album' | 'overview' | 'entry' | 'edit-entry' | 'edit-album' | 'cover' | 'month-cover' | 'month-add' | 'month-photo-remove'
type DeleteConfirmation = { kind: 'album' | 'entry' | 'month'; albumId: string; entryId?: string; version: number; scopeKey: string; route: Route }
export type AlbumsPageProps = {
  accountId: string; familyId: string; familyName: string; timezone: string; membershipEpoch: number; active: boolean
  child: { id: string; name: string; birthDate: string | null; avatarCrop?: { x: number; y: number; width: number; height: number } | null } | null
  childSubtitle: string; childAvatar?: { url: string | null; status: 'absent' | 'loading' | 'ready' | 'error' }
  role: 'full' | 'viewer'; transport: AuthenticatedTransport; hostBridge: HostBridge; onFeed: () => void; onFamily: () => void; onGifts: () => void; onAllFamilies: () => void; onAdd: () => void; onAccessLost: () => void
  /** Opens one album (from a child's page); `nonce` repeats a request for the same album. */
  openAlbumRequest?: { albumId: string; nonce: number } | null; onOpenAlbumRequestHandled?: () => void
  /** The family's children in server order. Two or more group the catalog by child and ask which child a new album is for. */
  childProfiles?: readonly ChildDto[]
  /** The child selected in the feed: new albums and uploads start with this child. */
  childFilter?: string | null
  childAvatarsEnabled?: boolean
  /** Tapping a child in the family header opens that child's page in the feed. */
  onOpenChild?: (childId: string) => void
}

function countLabel(count: number, words: readonly [string, string, string]) {
  const form = new Intl.PluralRules('ru').select(count)
  return `${count} ${words[form === 'one' ? 0 : form === 'few' ? 1 : 2]}`
}
function Loading() { return <div aria-label="Загрузка альбомов" className="albums-loading" role="status"><span /><span /><span /><span /></div> }
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
  const childList = useMemo(() => props.childProfiles ?? [], [props.childProfiles])
  const multiChild = childList.length >= 2
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
  const [deleteConfirmation, setDeleteConfirmation] = useState<DeleteConfirmation | null>(null)
  const [confirmationLifecycle, setConfirmationLifecycle] = useState({ scopeKey, active })
  if (confirmationLifecycle.scopeKey !== scopeKey || confirmationLifecycle.active !== active) {
    setConfirmationLifecycle({ scopeKey, active })
    setDeleteConfirmation(null)
  }
  const [offline, setOffline] = useState(() => !navigator.onLine)
  const [upload, setUpload] = useState<{ attach: (memory: MemoryDto) => Promise<void>; attachPhotos: (mediaIds: string[], batchId: string) => Promise<void>; complete: () => void; completeBatch: (batchId: string, signal: AbortSignal) => Promise<unknown> } | null>(null)
  const [revision, setRevision] = useState(0)
  const [monthRevision, setMonthRevision] = useState(0)
  const pending = useRef(false)
  const paging = useRef(false)
  const requestGeneration = useRef(0)
  const activeAlbumId = useRef<string | null>(null)
  const albumRead = useRef(0)
  const scrolls = useRef<Partial<Record<Route, number>>>({ catalog: 0 })
  const focus = useRef<Partial<Record<Route, HTMLElement>>>({})
  const routeRef = useRef(route)
  const entryReturn = useRef<'album' | 'overview' | 'stories'>('album')
  const monthViewerOpen = useRef(false)
  const photoAddReturn = useRef<'album' | 'entry'>('entry')
  const onMonthViewerOpenChange = useCallback((open: boolean) => { monthViewerOpen.current = open }, [])
  const clearWorkshopFocus = useCallback(() => { setWorkshopFocusId(null); setWorkshopFocusTop(null) }, [])
  const backRef = useRef<() => void>(() => undefined)
  useLayoutEffect(() => { routeRef.current = route }, [route])
  const navigate = useCallback((next: Route) => {
    const previous = routeRef.current
    scrolls.current[previous] = window.scrollY
    if (document.activeElement instanceof HTMLElement) focus.current[previous] = document.activeElement
    setDeleteConfirmation(null)
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
      setWorkshopFocusId(null); setWorkshopFocusTop(null); setDeleteConfirmation(null); setRoute('catalog')
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
    const month = album?.kind === 'year'
    const [fresh, page, summary] = await Promise.all([api.album(id), api.entries(id, undefined, category, year, month), album?.kind === 'workshop' ? api.groups(id) : Promise.resolve(null)])
    const detail = refreshEntry && entry ? await api.entry(id, entry.id, month) : null
    if (scopeController.isAborted() || activeAlbumId.current !== id || generation !== albumRead.current) return
    setAlbum(fresh.album); setEntries(page.items); setEntryCursor(page.nextCursor)
    if (summary) setGroups(summary.groups)
    if (detail) setEntry(detail.entry)
    setLoading(false); setSavedRefreshFailed(false); setError(null); setConflict(false)
  }
  useEffect(() => {
    if (!album) return
    const id = album.id; const generation = ++requestGeneration.current
    void Promise.all([api.entries(id, undefined, category, year, album.kind === 'year'), album.kind === 'workshop' ? api.groups(id) : Promise.resolve(null)]).then(([page, summary]) => {
      if (generation !== requestGeneration.current || scopeController.isAborted()) return
      setEntries(page.items); setEntryCursor(page.nextCursor); if (summary) setGroups(summary.groups)
    }).catch((reason) => { if (generation === requestGeneration.current) fail(reason) }).finally(() => { if (generation === requestGeneration.current && !scopeController.isAborted()) setLoading(false) })
    return () => { requestGeneration.current += 1 }
    // Album version changes do not restart the paginated window; only scope/filter does.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, album?.id, category, year])
  const back = useCallback(() => {
    if (deleteConfirmation) { setDeleteConfirmation(null); return }
    if (pending.current) return
    if (upload || route === 'month-add' || monthViewerOpen.current) return
    if (route === 'free-add' || route === 'stories') { navigate('album'); return }
    if (route === 'edit-entry') { navigate(entry ? 'entry' : 'album'); return }
    if (route === 'month-cover' || route === 'month-photo-remove') { navigate('entry'); return }
    if (route === 'entry') { navigate(entryReturn.current); return }
    if (route === 'overview' || route === 'edit-album' || route === 'cover') { navigate('album'); return }
    if (route === 'album') { activeAlbumId.current = null; albumRead.current += 1; setLoading(true); setError(null); setAlbum(null); setEntry(null); setCategory(undefined); setYear(undefined); setWorkshopFocusId(null); navigate('catalog'); return }
    if (route === 'create') { navigate('catalog'); return }
    props.onFeed()
  }, [deleteConfirmation, upload, route, entry, navigate, props])
  useLayoutEffect(() => { backRef.current = back }, [back])
  useEffect(() => { if (active) return hostBridge.onBack(() => backRef.current()) }, [active, hostBridge])
  async function openAlbum(item: AlbumDto) {
    if (pending.current) return
    activeAlbumId.current = item.id; const generation = ++albumRead.current; setLoading(true); setWorkshopLevel(1); setWorkshopFocusId(null); setWorkshopFocusTop(null)
    setCategory(undefined); setYear(undefined); setEntries([]); setEntryCursor(null); setEntry(null); setAlbum(item); setError(null); setConflict(false); scrolls.current.album = 0; navigate('album')
    try { const result = await api.album(item.id); if (!scopeController.isAborted() && generation === albumRead.current && activeAlbumId.current === item.id) setAlbum(result.album) } catch (reason) { if (generation === albumRead.current && activeAlbumId.current === item.id) fail(reason) }
  }
  const openRequestedAlbum = useEffectEvent((albumId: string) => {
    props.onOpenAlbumRequestHandled?.()
    void api.album(albumId).then((result) => { if (!scopeController.isAborted()) void openAlbum(result.album) }).catch(fail)
  })
  const requestedAlbumId = props.openAlbumRequest?.albumId
  const requestedAlbumNonce = props.openAlbumRequest?.nonce
  useEffect(() => {
    if (active && requestedAlbumId) openRequestedAlbum(requestedAlbumId)
  }, [active, requestedAlbumId, requestedAlbumNonce])
  async function openEntry(item: AlbumEntryDto, trigger?: HTMLElement) {
    if (!album || pending.current) return
    pending.current = true; setBusy(true); setError(null)
    try {
      const result = await api.entry(album.id, item.id, album.kind === 'year')
      if (scopeController.isAborted() || activeAlbumId.current !== album.id) return
      setEntry(result.entry); setAlbum((current) => current ? { ...current, version: result.entry.aggregateVersion } : current)
      if (album.kind === 'workshop' && trigger?.dataset.albumTile) { setWorkshopFocusId(trigger.dataset.albumTile); setWorkshopFocusTop(trigger.getBoundingClientRect().top) }
      // Workshop tiles are virtualized. Restore them by logical ID after the
      // gallery has measured and remounted the tile, never by an old node ref.
      if (trigger && album.kind !== 'workshop') focus.current[route] = trigger
      entryReturn.current = route === 'stories' ? 'stories' : route === 'overview' ? 'overview' : 'album'
      scrolls.current.entry = 0; navigate('entry')
    } catch (reason) { fail(reason) }
    finally { pending.current = false; if (!scopeController.isAborted()) setBusy(false) }
  }
  async function more() {
    if (paging.current || loading || conflict) return
    paging.current = true; setLoadingMore(true); const generation = requestGeneration.current
    try {
      if (album && entryCursor) { const page = await api.entries(album.id, entryCursor, category, year, album.kind === 'year'); if (generation === requestGeneration.current && !scopeController.isAborted()) { setEntries((old) => [...new Map([...old, ...page.items].map((item) => [item.id, item])).values()]); setEntryCursor(page.nextCursor) } }
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
  async function mutation(action: () => Promise<unknown>, after?: () => void, refreshEntry = route === 'entry') {
    if (pending.current || conflict) return
    pending.current = true; setBusy(true); setError(null)
    try {
      await action(); if (scopeController.isAborted()) return false
      after?.()
      try { if (album && !after) await refreshAlbum(album.id, refreshEntry); else reloadCatalog() }
      catch (reason) { if (isAlbumScopeFailure(reason)) { fail(reason); return false } setSavedRefreshFailed(true) }
      return true
    } catch (reason) { fail(reason); return false }
    finally { pending.current = false; if (!scopeController.isAborted()) setBusy(false) }
  }
  function selectCover(coverSourceId: string | null) {
    if (!album) return
    const albumId = album.id
    void mutation(async () => {
      const result = await api.update(albumId, { expectedVersion: album.version, coverSourceId })
      if (scopeController.isAborted() || activeAlbumId.current !== albumId) return
      setAlbum(result.album)
    }).then((committed) => {
      if (committed && !scopeController.isAborted() && activeAlbumId.current === albumId && routeRef.current === 'cover') navigate('album')
    })
  }
  function saved(version: number, monthEntry?: AlbumEntryDto) {
    if (!album || scopeController.isAborted()) return
    if (monthEntry) {
      setEntry(monthEntry)
      setEntries((items) => items.map((item) => item.id === monthEntry.id ? monthEntry : item))
    }
    setAlbum({ ...album, version }); setUpload(null); navigate(monthEntry ? 'entry' : 'album')
    void refreshAlbum(album.id).catch((reason) => { if (isAlbumScopeFailure(reason)) fail(reason); else setSavedRefreshFailed(true) })
  }
  function refreshMonth() {
    if (!album) return
    void refreshAlbum(album.id, true).then(() => {
      if (!scopeController.isAborted() && activeAlbumId.current === album.id) setMonthRevision((value) => value + 1)
    }).catch(fail)
  }
  function monthPhotoAction(sourceId: string | null) {
    if (!album || !entry || !editable) return
    const remove = route === 'month-photo-remove'
    if (remove && !sourceId) return
    void mutation(async () => {
      if (remove) await api.removeMonthPhoto(album.id, entry.id, sourceId!, entry.version)
      else {
        const { entry: updated } = await api.setMonthCover(album.id, entry.id, entry.version, sourceId)
        if (!scopeController.isAborted()) {
          setEntry(updated)
          setEntries((items) => items.map((item) => item.id === updated.id ? updated : item))
        }
      }
    }, undefined, true).then((committed) => {
      if (committed && !scopeController.isAborted()) navigate('entry')
    })
  }
  function reloadCatalog() { setLoading(true); setError(null); setConflict(false); setRevision((value) => value + 1) }
  function discussionInvalidated(reason: ApiRequestError) {
    if (isAlbumScopeFailure(reason)) { fail(reason); return }
    if (!album) return
    // An old chapter cannot keep its draft or replace a newly opened detail.
    // Return to the refreshed entry list; reopening obtains its current generation.
    setEntry(null); navigate('album')
    void refreshAlbum(album.id).catch(fail)
  }
  function retryRead() {
    setLoading(true); setError(null); setConflict(false); setSavedRefreshFailed(false)
    if (album && entry?.kind === 'month' && ['entry', 'month-cover', 'month-photo-remove'].includes(route)) refreshMonth()
    else if (album) void refreshAlbum(album.id, route === 'entry').catch(fail)
    else setRevision((value) => value + 1)
  }
  function changeCategory(value: string | undefined) { if (value === category) return; setLoading(true); setError(null); setCategory(value) }
  function changeYear(value: number | undefined) { if (value === year) return; setLoading(true); setError(null); setYear(value) }
  function changeCatalogFilter(value: AlbumFilter) { if (value === filter) return; setLoading(true); setError(null); setFilter(value) }
  function askDeleteAlbum() {
    if (!album || !editable || busy || conflict) return
    setDeleteConfirmation({ kind: 'album', albumId: album.id, version: album.version, scopeKey, route: 'edit-album' })
  }
  function askRemoveEntry() {
    if (!album || !entry || !editable || busy || conflict) return
    setDeleteConfirmation({ kind: entry.kind === 'month' ? 'month' : 'entry', albumId: album.id, entryId: entry.id, version: album.version, scopeKey, route: 'entry' })
  }
  function confirmDeletion() {
    const target = deleteConfirmation
    if (!target || pending.current || !active || scopeController.isAborted()) return
    const currentEntry = target.kind === 'album' ? null : entry
    if (target.scopeKey !== scopeKey || target.route !== route || !album || album.id !== target.albumId || album.version !== target.version || (target.kind !== 'album' && currentEntry?.id !== target.entryId)) {
      setDeleteConfirmation(null)
      setConflict(true)
      setError('Альбом или история уже изменились. Обновите данные перед новым действием.')
      return
    }
    setDeleteConfirmation(null)
    if (target.kind === 'album') {
      void mutation(() => api.remove(target.albumId, target.version), () => { setAlbums((old) => old.filter((item) => item.id !== target.albumId)); activeAlbumId.current = null; setAlbum(null); navigate('catalog') })
      return
    }
    void mutation(() => target.kind === 'month' ? api.clear(target.albumId, target.entryId!, target.version, true) : api.removeEntry(target.albumId, target.entryId!, target.version), undefined, target.kind === 'month').then((committed) => {
      if (committed && !scopeController.isAborted()) { setEntry(null); navigate('album') }
    })
  }
  async function addFreePhotos() {
    if (!album || pending.current) return
    if (!entries.length) { setEntry(null); navigate('free-add'); return }
    pending.current = true; setBusy(true)
    try {
      const result = await api.entry(album.id, entries[0].id)
      if (scopeController.isAborted() || activeAlbumId.current !== album.id) return
      setEntry(result.entry); setAlbum((current) => current ? { ...current, version: result.entry.aggregateVersion } : current)
      photoAddReturn.current = 'album'; navigate('month-add')
    } catch (reason) { fail(reason) }
    finally { pending.current = false; if (!scopeController.isAborted()) setBusy(false) }
  }
  const newEntry = (title = '') => { setEntry(null); setSuggestedTitle(title); scrolls.current['edit-entry'] = 0; navigate('edit-entry') }
  const image = (source: AlbumSource | null) => <SourcePreview accountId={accountId} active={active} scopeKey={scopeKey} source={source} transport={transport} />
  const editable = role === 'full' && album?.capabilities.edit
  // A child's album belongs to that child, whichever child the header shows.
  const albumChild = (multiChild && album?.childId ? childList.find((item) => item.id === album.childId) : undefined) ?? props.child
  const albumGroups = multiChild ? groupAlbumsByChild(albums, childList) : null
  const years = [...new Set(groups.map((group) => group.year).filter((year): year is number => year !== null))].sort((a, b) => b - a)
  const showNav = !upload && route !== 'month-add'
  return <div className="albums-surface" data-albums-kind={album?.kind} data-albums-route={route}>
    <div hidden={Boolean(upload)}>
      {route === 'catalog' ? multiChild ? <FamilyHeaderV2 childList={childList} familyName={props.familyName} mode="feed" onAllFamilies={props.onAllFamilies} onSelectChild={props.onOpenChild} renderChildAvatar={(item) => <FamilyChildAvatar child={item} enabled={props.childAvatarsEnabled ?? false} familyId={familyId} membershipEpoch={membershipEpoch} transport={transport} />} theme={theme} /> : <ChildHeader childAvatarCrop={props.child?.avatarCrop} childAvatarStatus={props.childAvatar?.status} childAvatarUrl={props.childAvatar?.url} childName={props.child?.name ?? props.familyName} childSubtitle={props.childSubtitle} mode="feed" onAllFamilies={props.onAllFamilies} theme={theme} /> : null}
      <main className="albums-main">
        {offline ? <p className="albums-error" role="status">Нет соединения. Изменения не сохраняются без подтверждения сервера.</p> : null}
        {savedRefreshFailed ? <div className="albums-error" role="alert"><p>Изменение сохранено. Обновить список пока не удалось.</p><button onClick={retryRead} type="button">Обновить данные</button></div> : null}
        {error ? <div className="albums-error" role="alert"><p>{error}</p><button disabled={busy} onClick={retryRead} type="button">Обновить данные</button></div> : null}
        {route === 'catalog' ? <AlbumCatalogPresentation albums={albums} catalogCursor={catalogCursor} error={Boolean(error)} filter={filter} groups={albumGroups} loading={loading} loadingMore={loadingMore} onCreate={() => navigate('create')} onFilterChange={changeCatalogFilter} onLoadMore={() => void more()} onOpenAlbum={(item) => void openAlbum(item)} renderCover={(item) => item.cover ? image(item.cover) : null} role={role} /> : null}
        {route === 'create' ? <AlbumForm api={api} child={props.child} childProfiles={childList} defaultChildId={props.childFilter} onCancel={back} onSaved={(next) => { setAlbums((old) => [next, ...old]); void openAlbum(next) }} /> : null}
        {album && route === 'edit-album' ? <><AlbumForm album={album} api={api} child={props.child} onCancel={back} onSaved={(next) => { setAlbum(next); navigate('album') }} /><button className="albums-secondary" onClick={() => navigate('cover')} type="button">Выбрать обложку</button><button className="albums-danger" disabled={busy || conflict} onClick={askDeleteAlbum} type="button">Удалить альбом</button></> : null}
        {album && route === 'cover' ? <><header className="albums-toolbar"><button onClick={back} type="button">‹ Назад</button><h1>Обложка альбома</h1></header><p className="albums-muted">Выберите один из доступных кадров этого альбома.</p><button className="albums-secondary" disabled={busy || conflict} onClick={() => selectCover(null)} type="button">Автоматическая обложка</button>{<AlbumCoverCandidates accountId={accountId} albumId={album.id} api={api} disabled={busy || conflict} entries={entries} key={[scopeKey, album.id, ...entries.map((item) => item.version)].join(':')} onSelect={selectCover} scopeKey={scopeKey} transport={transport} />}{entryCursor ? <button onClick={() => void more()} type="button">Ещё кадры</button> : null}</> : null}
        {album && (route === 'album' || route === 'overview' || route === 'stories') ? <>
          <header className="albums-toolbar albums-internal-toolbar"><button onClick={back} type="button">‹ {route === 'overview' || route === 'stories' ? 'Альбом' : 'Альбомы'}</button><h1>{album.title}</h1><details className="albums-menu" key={`${album.id}:${route}`}><summary aria-label="Меню альбома">•••</summary><div className="albums-menu-content"><strong>{kindNames[album.kind]}</strong>{album.description ? <p>{album.description}</p> : null}{album.kind === 'free' ? <button onClick={() => navigate(route === 'stories' ? 'album' : 'stories')} type="button">{route === 'stories' ? 'Фотографии' : 'Истории и обсуждения'}</button> : null}{editable ? <button onClick={() => navigate('edit-album')} type="button">Настройки альбома</button> : null}</div></details></header>
          {album.kind !== 'free' || route === 'stories' ? <section className={`albums-intro albums-kind-${album.kind}${album.kind === 'year' ? ' albums-year-intro' : ''}`}>
            {album.kind === 'year' && album.cover ? <span className="albums-year-cover">{image(album.cover)}</span> : <AlbumWatercolor className="albums-intro-art" name={album.kind === 'workshop' ? 'palette' : 'bear'} />}
            <div className="albums-year-copy"><p className="albums-intro-caption">{album.kind === 'workshop' ? 'Маленькие руки создают целый мир' : album.kind === 'year' ? 'Двенадцать глав первого года' : album.kind === 'events' ? 'Большие открытия маленького человека' : 'Самое дорогое — рядом'}</p>
              {album.kind === 'year' ? <div className="albums-year-progress"><small>{albumChild?.name ? `${albumChild.name} · ` : ''}{album.entryCount} из 12 месяцев заполнено</small><progress aria-label={`Заполнено ${album.entryCount} из 12 месяцев`} max={12} value={album.entryCount} /></div> : <small>{countLabel(album.entryCount, album.kind === 'workshop' ? ['работа', 'работы', 'работ'] : ['история', 'истории', 'историй'])}{albumChild?.name ? ` · ${albumChild.name}` : ''}</small>}
            </div>
            {album.kind !== 'year' && editable ? <button aria-label={album.kind === 'workshop' ? 'Добавить работу' : 'Добавить историю'} className="albums-compact-add" disabled={busy || conflict} onClick={() => newEntry()} type="button"><WebpIcon decorative name="plus" size={18} /><span>Добавить</span></button> : <AlbumWatercolor className="albums-intro-sprig" name="sprig" />}
          </section> : <div className="month-entry-actions">{editable ? <button className="albums-secondary" disabled={busy || conflict || loading} onClick={() => void addFreePhotos()} type="button">+ Добавить фотографии</button> : null}</div>}
          {album.kind === 'year' ? <div className="albums-year-modes"><button aria-pressed={route === 'album'} onClick={() => navigate('album')} type="button">Линия времени</button><button aria-pressed={route === 'overview'} onClick={() => navigate('overview')} type="button">Все 12 месяцев</button></div> : null}
          {loading ? <Loading /> : album.kind === 'free' && route === 'album' ? <FreeAlbumGallery accountId={accountId} albumId={album.id} api={api} childName={albumChild?.name ?? props.familyName} entries={entries} entryCursor={entryCursor} familyId={familyId} hostBridge={hostBridge} key={[scopeKey, album.id, album.version, monthRevision, ...entries.map((item) => `${item.id}:${item.version}`)].join(':')} membershipEpoch={membershipEpoch} onRefresh={() => { void refreshAlbum(album.id).then(() => setMonthRevision((value) => value + 1)).catch(fail) }} onViewerOpenChange={onMonthViewerOpenChange} scopeKey={scopeKey} timezone={props.timezone} transport={transport} /> : album.kind === 'workshop' ? <WorkshopGallery accountId={accountId} active={active} entries={entries} focusId={route === 'album' ? workshopFocusId : null} focusTop={workshopFocusTop} level={workshopLevel} onFocusRestored={clearWorkshopFocus} onLevelChange={setWorkshopLevel} onOpen={(item, trigger) => void openEntry(item, trigger)} controls={<details className="albums-workshop-filters"><summary>{category ? Object.entries(categories).find(([key]) => key === category)?.[1] : 'Все работы'}{year ? ` · ${year}` : ''}<span aria-hidden>⌄</span></summary><div className="albums-filter-options"><div aria-label="Категории работ" className="albums-chips"><button aria-pressed={!category} onClick={() => changeCategory(undefined)} type="button">Все</button>{Object.entries(categories).map(([key, label]) => <button aria-pressed={category === key} key={key} onClick={() => changeCategory(key)} type="button">{label}</button>)}</div><div aria-label="Переход к году" className="albums-chips albums-year-jump"><button aria-pressed={year === undefined} onClick={() => changeYear(undefined)} type="button">Все годы</button>{years.map((value) => <button aria-pressed={year === value} key={value} onClick={() => { changeYear(value); window.scrollTo(0, 0) }} type="button">{value}</button>)}</div><p className="albums-muted albums-gesture-hint">Два пальца меняют масштаб · один прокручивает</p></div></details>} scopeKey={scopeKey} transport={transport} /> : <div className={route === 'overview' ? 'albums-month-overview' : album.kind === 'year' ? 'albums-timeline albums-year-timeline' : album.kind === 'free' ? 'albums-free-grid' : 'albums-event-list'}>{entries.map((item, index) => <div className={`albums-entry-row${filled(item) ? ' is-filled' : ''}`} key={item.id}>
            {album.kind === 'events' && item.date.precision === 'unknown' && entries[index - 1]?.date.precision !== 'unknown' ? <h2>Без даты</h2> : null}
            <button aria-label={item.monthNumber ? monthAgeLabel(item.monthNumber) : item.title || 'Открыть историю'} className="albums-entry-card" data-entry-id={item.id} disabled={busy} onClick={(event) => void openEntry(item, event.currentTarget)} type="button">{item.monthNumber ? <span className="albums-month-marker">{item.monthNumber}</span> : null}{entryCover(item) ? <span className="albums-entry-image" data-entry-cover={entryCover(item)?.id}>{image(entryCover(item))}</span> : null}<span className="albums-entry-copy"><strong>{item.title || (item.monthNumber ? monthAgeLabel(item.monthNumber) : 'Семейная история')}</strong>{item.caption ? <span>{item.caption.slice(0, 160)}</span> : null}<small>{item.monthNumber && !filled(item) ? role === 'full' ? 'Добавить тёплый момент' : 'Пока нет воспоминаний' : dateLabel(item.date)}{item.sourceCount ? ` · ${countLabel(item.sourceCount, ['материал', 'материала', 'материалов'])}` : ''}</small></span>{album.kind === 'year' && route === 'album' && editable && item.monthNumber && !filled(item) ? <span aria-hidden className="albums-year-add"><WebpIcon decorative name="plus" size={18} /></span> : null}<span aria-hidden className="albums-entry-arrow">›</span></button>
            {album.kind === 'free' && editable ? <div className="albums-order-actions"><button aria-label={`Переместить историю ${index + 1} вверх`} disabled={busy || conflict || index === 0} onClick={() => void mutation(() => api.reorder(album.id, item.id, entries[index - 1].id, album.version))} type="button">↑ Вверх</button><button aria-label={`Переместить историю ${index + 1} вниз`} disabled={busy || conflict || index === entries.length - 1} onClick={() => void mutation(() => api.reorder(album.id, item.id, entries[index + 2]?.id ?? null, album.version))} type="button">↓ Вниз</button></div> : null}
          </div>)}</div>}
          {!(album.kind === 'free' && route === 'album') && !loading && !entries.length && !error ? <div className="albums-empty"><h2>{album.kind === 'workshop' ? 'Каждая работа — маленький мир' : 'История только начинается'}</h2><p>{category || year ? 'По этому фильтру пока нет работ.' : 'Добавьте первый момент из воспоминаний или загрузите новый.'}</p></div> : null}
          {album.kind === 'events' && editable ? <section className="albums-suggestions"><h2>С чего начать</h2><p className="albums-muted">Только идеи — у каждого свой путь</p>{suggestions.filter((title) => !hiddenSuggestions.includes(title) && !entries.some((entry) => entry.title === title)).map((title) => <div key={title}><button onClick={() => newEntry(title)} type="button">+ {title}</button><button aria-label={`Скрыть предложение ${title}`} onClick={() => setHiddenSuggestions((old) => [...old, title])} type="button">×</button></div>)}</section> : null}
          <div ref={sentinel} />{!(album.kind === 'free' && route === 'album') && entryCursor && !loading ? <button className="albums-secondary" disabled={loadingMore || conflict} onClick={() => void more()} type="button">{loadingMore ? 'Загружаем…' : 'Ещё истории'}</button> : null}
          <AlbumWatercolorFooter />
        </> : null}
        {album && (route === 'edit-entry' || route === 'free-add') ? <EntryEditor photosOnly={route === 'free-add'} accountId={accountId} album={album} api={api} canUpload={role === 'full' && album.capabilities.edit} entry={entry} key={`${album.id}:${entry?.id ?? 'new'}:${suggestedTitle}`} onCancel={back} onSaved={saved} onUpload={(attach, attachPhotos, complete, completeBatch) => setUpload({ attach, attachPhotos, complete, completeBatch })} scopeKey={scopeKey} timezone={props.timezone} title={suggestedTitle} transport={transport} /> : null}
        {active && album && (entry?.month || entry?.collection) && route === 'entry' ? <MonthEntryDetail accountId={accountId} albumId={album.id} api={api} busy={busy} childName={albumChild?.name ?? props.familyName} entry={entry} familyId={familyId} hostBridge={hostBridge} key={[scopeKey, entry.id, entry.version, monthRevision].join(':')} membershipEpoch={membershipEpoch} onAdd={() => { photoAddReturn.current = 'entry'; navigate('month-add') }} onBack={back} onClear={askRemoveEntry} onCover={() => navigate('month-cover')} onDiscussionInvalidated={discussionInvalidated} onEdit={() => navigate('edit-entry')} onRefresh={refreshMonth} onRemovePhoto={() => navigate('month-photo-remove')} onViewerOpenChange={onMonthViewerOpenChange} scopeKey={scopeKey} timezone={props.timezone} transport={transport} /> : null}
        {active && album && (entry?.month || entry?.collection) && (route === 'month-cover' || route === 'month-photo-remove') ? <MonthCoverPicker accountId={accountId} albumId={album.id} api={api} busy={busy} conflict={conflict} entry={entry} key={[scopeKey, entry.id, entry.version, monthRevision].join(':')} onCancel={back} onRefresh={refreshMonth} onSave={monthPhotoAction} remove={route === 'month-photo-remove'} scopeKey={scopeKey} transport={transport} /> : null}
        {active && album && (entry?.month || entry?.collection) && route === 'month-add' ? <MonthAddPhotos accountId={accountId} albumId={album.id} api={api} entry={entry} familyId={familyId} hostBridge={hostBridge} onChanged={refreshMonth} onClose={() => navigate(photoAddReturn.current)} scopeKey={scopeKey} transport={transport} /> : null}
        {active && album && route === 'entry' && entry && !entry.month && !entry.collection ? <AlbumEntryDetail albumId={album.id} onDiscussionInvalidated={discussionInvalidated} accountId={accountId} active busy={busy} childName={albumChild?.name ?? props.familyName} entry={entry} familyId={familyId} hostBridge={hostBridge} membershipEpoch={membershipEpoch} onBack={back} onEdit={() => navigate('edit-entry')} onRemove={askRemoveEntry} loadSources={(entryId, cursor, signal) => api.monthSources(album.id, entryId, 'all', cursor, signal)} scopeKey={scopeKey} timezone={props.timezone} transport={transport} /> : null}
      </main>
    </div>
    <AlertDialog onOpenChange={(open) => { if (!open) setDeleteConfirmation(null) }} open={Boolean(deleteConfirmation)}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>{deleteConfirmation?.kind === 'album' ? 'Удалить альбом?' : deleteConfirmation?.kind === 'month' ? 'Очистить эту главу?' : 'Убрать историю из альбома?'}</AlertDialogTitle><AlertDialogDescription>{deleteConfirmation?.kind === 'album' ? 'Исходные материалы сохранятся.' : deleteConfirmation?.kind === 'month' ? 'История, комментарии и реакции этой главы будут сброшены. Номер месяца и оригиналы сохранятся.' : 'Оригиналы сохранятся.'}</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel disabled={busy}>Отмена</AlertDialogCancel><AlertDialogAction className="albums-danger" disabled={busy || conflict} onClick={confirmDeletion} variant="destructive">{deleteConfirmation?.kind === 'album' ? 'Удалить альбом' : deleteConfirmation?.kind === 'month' ? 'Очистить главу' : 'Убрать историю'}</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
    {upload ? <ComposerHost active={active} attach={upload.attach} attachPhotos={upload.attachPhotos} completeAlbumPhotos={upload.completeBatch} onAlbumUploadComplete={upload.complete} childId={albumChild?.id ?? props.child?.id} childOptions={multiChild ? [...childList] : undefined} initialChildIds={multiChild && album?.childId ? [album.childId] : []} familyId={familyId} familyTimezone={props.timezone} hostBridge={hostBridge} onClose={() => setUpload(null)} transport={transport} /> : null}
    {showNav ? <BottomNavigation active="albums" appearance="memoly" onAdd={props.child ? props.onAdd : undefined} onAlbums={() => undefined} onFamily={props.onFamily} onFeed={props.onFeed} onGifts={props.onGifts} role={role} /> : null}
  </div>
}
