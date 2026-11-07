/* eslint-disable typographyPolicy/use-typography-component -- semantic picker controls use the album stylesheet. */
import { useEffect, useRef, useState } from 'react'
import type { AlbumEntryDto } from '@web-app-demo/contracts'
import type { AuthenticatedTransport } from '@/platform/api'
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog'
import type { AlbumsApi } from './api'
import type { AlbumSource } from './model'
import { SourcePreview } from './SourcePreview'
import { useMonthSourcePages } from './useMonthSourcePages'

type PreviewProps = { accountId: string; scopeKey: string; transport: AuthenticatedTransport }

export function MonthCoverPicker({ api, albumId, entry, busy, conflict, onCancel, onSave, onRefresh, remove, ...preview }: PreviewProps & {
  api: AlbumsApi; albumId: string; entry: AlbumEntryDto; busy: boolean; conflict: boolean; remove: boolean
  onCancel: () => void; onSave: (sourceId: string | null) => void; onRefresh: () => void
}) {
  const collection = entry.month ?? entry.collection
  const cover = collection?.cover ?? null
  const [selected, setSelected] = useState<AlbumSource | null>(remove ? null : cover)
  const [automatic, setAutomatic] = useState(!collection?.coverSourceId)
  const [confirm, setConfirm] = useState(false)
  const [pageIndex, setPageIndex] = useState(0)
  const page = useMonthSourcePages(api, albumId, entry.id, 'photo', Boolean(collection && collection.photoCount > Number(Boolean(cover))))
  const sources = (page.pages[pageIndex] ?? []).filter(({ id }) => id !== cover?.id)
  const priorCount = page.pages.slice(0, pageIndex).reduce((count, items) => count + items.filter(({ id }) => id !== cover?.id).length, pageIndex > 0 && cover ? 1 : 0)
  const next = () => {
    if (pageIndex + 1 >= page.pages.length) page.more()
    setPageIndex(pageIndex + 1)
  }
  const disabled = busy || conflict || page.error === 'stale'
  return <section className="month-cover-picker">
    <header className="albums-toolbar">
      <button disabled={busy} onClick={onCancel} type="button">‹ Назад</button>
      <h1>{remove ? 'Убрать фотографию' : 'Обложка месяца'}</h1>
    </header>
    {selected ? <div aria-label="Предпросмотр выбранной фотографии" className="month-cover-preview" role="group"><SourcePreview {...preview} source={selected} /></div> : null}
    {!remove ? <button aria-pressed={automatic} className="albums-secondary" disabled={disabled} onClick={() => { setAutomatic(true); setSelected(null) }} type="button">Выбирать автоматически</button> : null}
    {!cover && !page.loading ? <p className="albums-muted">Фотографий пока нет.</p> : null}
    <div className="albums-picker-grid">
      {[...(cover && pageIndex === 0 ? [cover] : []), ...sources].map((source, index) => (
        <button aria-label={`Фото ${priorCount + index + 1}${source.id === cover?.id ? ', текущая обложка' : ''}`} aria-pressed={(!automatic || remove) && source.id === selected?.id} className="albums-picker-item" data-month-choice={source.id} disabled={disabled} key={source.id} onClick={() => { setSelected(source); setAutomatic(false) }} type="button">
          <SourcePreview {...preview} source={source} />
          {source.id === cover?.id ? <span aria-hidden="true" className="albums-selected-mark">✓</span> : null}
        </button>
      ))}
    </div>
    {page.loading ? <p role="status">Загружаем фотографии…</p> : null}
    {page.error ? <p className="albums-error" role="alert">
      {page.error === 'stale' ? 'Список фотографий изменился.' : 'Не удалось загрузить фотографии.'}{' '}
      <button onClick={page.error === 'stale' ? onRefresh : page.retry} type="button">{page.error === 'stale' ? 'Обновить фотографии' : 'Повторить'}</button>
    </p> : null}
    <div className="albums-form-actions">
      {pageIndex > 0 ? <button onClick={() => setPageIndex(pageIndex - 1)} type="button">Предыдущие фото</button> : null}
      {pageIndex + 1 < page.pages.length || page.nextCursor && pageIndex < page.pages.length ? <button disabled={page.loading || Boolean(page.error)} onClick={next} type="button">Следующие фото</button> : null}
    </div>
    <footer className="albums-form-actions">
      <button className="albums-primary" disabled={disabled || (remove ? !selected : !automatic && !selected)} onClick={() => remove ? setConfirm(true) : onSave(automatic ? null : selected!.id)} type="button">{remove ? entry.kind === 'month' ? 'Убрать из месяца' : 'Убрать из альбома' : 'Сохранить'}</button>
      <button disabled={busy} onClick={onCancel} type="button">Отмена</button>
    </footer>
    {remove ? <AlertDialog onOpenChange={setConfirm} open={confirm}><AlertDialogContent>
      <AlertDialogHeader><AlertDialogTitle>Убрать фотографию из альбома?</AlertDialogTitle><AlertDialogDescription>Оригинал фотографии сохранится.</AlertDialogDescription></AlertDialogHeader>
      <AlertDialogFooter><AlertDialogCancel>Отмена</AlertDialogCancel><AlertDialogAction onClick={() => { if (selected) onSave(selected.id) }} variant="destructive">Убрать фотографию</AlertDialogAction></AlertDialogFooter>
    </AlertDialogContent></AlertDialog> : null}
  </section>
}

type YearPosition = { entryIndex: number; cursor?: string }
type YearPage = { items: AlbumSource[]; next: YearPosition | null }

export function AlbumCoverCandidates({ api, albumId, entries, disabled, onSelect, ...preview }: PreviewProps & {
  api: AlbumsApi; albumId: string; entries: AlbumEntryDto[]; disabled: boolean; onSelect: (sourceId: string) => void
}) {
  const [pages, setPages] = useState<YearPage[]>([])
  const [index, setIndex] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const request = useRef<AbortController | null>(null)
  const loadRef = useRef<() => void>(() => undefined)
  function load(position: YearPosition, pageIndex: number) {
    if (request.current) return
    const controller = new AbortController()
    request.current = controller
    setLoading(true)
    setError(false)
    void (async () => {
      let { entryIndex, cursor } = position
      while (entryIndex < entries.length) {
        const entry = entries[entryIndex]!
        if (entry.sourceCount) {
          const page = await api.monthSources(albumId, entry.id, 'cover-media', cursor, controller.signal)
          if (controller.signal.aborted) return
          const next = page.nextCursor ? { entryIndex, cursor: page.nextCursor } : entryIndex + 1 < entries.length ? { entryIndex: entryIndex + 1 } : null
          if (page.items.length) {
            setPages((old) => [...old.slice(0, pageIndex), { items: page.items, next }])
            setIndex(pageIndex)
            return
          }
          if (page.nextCursor) { cursor = page.nextCursor; continue }
        }
        entryIndex += 1
        cursor = undefined
      }
      if (controller.signal.aborted) return
      setPages((old) => pageIndex ? old.map((page, pageNumber) => pageNumber === pageIndex - 1 ? { ...page, next: null } : page) : [{ items: [], next: null }])
    })().catch(() => { if (!controller.signal.aborted) setError(true) }).finally(() => {
      if (request.current === controller) { request.current = null; setLoading(false) }
    })
  }
  useEffect(() => {
    const start = () => load({ entryIndex: 0 }, 0)
    loadRef.current = start
    const initial = window.setTimeout(start, 0)
    return () => { window.clearTimeout(initial); request.current?.abort(); request.current = null }
    // The caller remounts on album, entries and scope changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const page = pages[index]
  function next() {
    if (pages[index + 1]) { setIndex(index + 1); return }
    if (page?.next) {
      const position = page.next
      loadRef.current = () => load(position, index + 1)
      loadRef.current()
    }
  }
  return <>
    <div className="albums-picker-grid">{page?.items.map((source) => <button aria-label="Выбрать этот кадр обложкой" className="albums-picker-item" disabled={disabled} key={source.id} onClick={() => onSelect(source.id)} type="button"><SourcePreview {...preview} source={source} /></button>)}</div>
    {loading ? <p role="status">Загружаем кадры…</p> : null}
    {error ? <p className="albums-error" role="alert">Не удалось загрузить кадры. <button onClick={() => loadRef.current()} type="button">Повторить</button></p> : null}
    <div className="albums-form-actions">
      {index > 0 ? <button disabled={loading} onClick={() => setIndex(index - 1)} type="button">Предыдущие кадры</button> : null}
      {page?.next ? <button disabled={loading || error} onClick={next} type="button">Ещё кадры</button> : null}
    </div>
  </>
}
